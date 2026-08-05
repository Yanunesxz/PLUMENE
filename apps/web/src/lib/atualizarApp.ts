import { registerSW } from 'virtual:pwa-register';

/**
 * Atualização do app.
 *
 * O problema que isto resolve: instalado na tela inicial, o app quase nunca é
 * "fechado e aberto" de verdade — o representante deixa ele aberto por dias. É
 * só no carregamento da página que o navegador confere se saiu versão nova, e
 * essa hora não chegava nunca. Publicávamos, e no celular continuava o de
 * antes; a saída que sobrava era limpar o cache na mão, aparelho por aparelho.
 *
 * Aqui a conferência passa a acontecer sozinha: de quinze em quinze minutos,
 * toda vez que o app volta para a frente e sempre que a internet volta. Achando
 * versão nova, ela baixa em silêncio, fica pronta, e entra sozinha — sem aviso,
 * sem botão, sem ninguém precisar fazer nada. `cleanupOutdatedCaches`
 * (vite.config.ts) apaga o cache da versão anterior nesse momento; as fotos dos
 * produtos ficam num cache separado e não são apagadas, senão o catálogo
 * inteiro desceria de novo pelo 3G da loja.
 *
 * O que ela NÃO faz é entrar a qualquer hora. Trocar de versão é recarregar a
 * tela, e recarregar em cima do dedo de quem está montando pedido na frente do
 * cliente é o único jeito de isto atrapalhar. Então a troca espera um momento
 * seguro, que num celular chega o tempo todo: o app sair da frente (a pessoa
 * atende, abre o WhatsApp, apaga a tela) ou ficar parado alguns minutos. Login
 * e carrinho ficam no `localStorage` e atravessam a recarga inteiros; o que se
 * perde é o que só estava na tela — e por isso não se recarrega enquanto ela
 * está sendo usada.
 *
 * O estado mora fora do React porque o service worker avisa quando quer,
 * inclusive antes de qualquer tela existir; as telas leem por
 * `useSyncExternalStore` (ver `useAtualizacao`).
 */

/**
 * - `atual`: rodando a versão mais nova que o servidor tem.
 * - `procurando`: conferindo com o servidor (só quando alguém pediu no botão —
 *   as conferências automáticas são silenciosas, senão o app ficaria piscando
 *   "procurando" sozinho no meio da tela).
 * - `disponivel`: versão nova baixada, esperando a hora de entrar.
 */
export type EstadoAtualizacao = 'atual' | 'procurando' | 'disponivel';

/** De quanto em quanto tempo perguntar ao servidor, com o app aberto. */
const INTERVALO_DE_BUSCA = 15 * 60 * 1000;

/**
 * Piso entre duas buscas. Sem ele, alternar entre o app e o WhatsApp — que o
 * representante faz o dia inteiro — viraria uma busca a cada toque.
 */
const ESPERA_MINIMA = 60 * 1000;

/**
 * Quanto tempo sem encostar na tela para considerar que dá para recarregar.
 *
 * Dois minutos é o que separa "parou de mexer" de "está lendo": ninguém fica
 * dois minutos com o mesmo pedido na frente sem tocar em nada. Abaixo disso a
 * recarga apareceria no meio de uma leitura demorada de tabela.
 */
const TEMPO_PARADO = 2 * 60 * 1000;

/** De quanto em quanto tempo conferir se a tela ficou parada. */
const RITMO_DA_ESPREITA = 15 * 1000;

/** Marca de "já recarreguei por causa disto" — evita laço de recarga. */
const CHAVE_RECARGA = 'csb-recarga-versao';

let estado: EstadoAtualizacao = 'atual';
let registro: ServiceWorkerRegistration | null = null;
let liberarVersaoNova: ((recarregar?: boolean) => Promise<void>) | null = null;
let ultimaBusca = 0;
let ultimoToque = Date.now();
let espreita: number | null = null;

/**
 * Uma troca por carregamento de página. Se a troca não pegar (o service worker
 * não assumiu, por exemplo), a próxima abertura tenta de novo — insistir dentro
 * da mesma sessão daria laço de recarga, que é bem pior do que ficar na versão
 * anterior por mais alguns minutos.
 */
let jaTrocou = false;

const ouvintes = new Set<() => void>();

function definirEstado(novo: EstadoAtualizacao): void {
  if (estado === novo) return;
  estado = novo;
  for (const ouvinte of ouvintes) ouvinte();
}

/** Pergunta ao servidor se saiu versão nova. Silenciosa: não mexe no estado. */
async function buscarNoServidor(): Promise<void> {
  if (!registro || !navigator.onLine) return;
  ultimaBusca = Date.now();
  try {
    await registro.update();
  } catch {
    // Sinal ruim no meio da conferência. A próxima tenta de novo — insistir
    // agora só gastaria a franquia do representante.
  }
}

/** Chamado uma vez, no arranque do app. */
export function observarAtualizacao(): void {
  if (typeof window === 'undefined') return;

  liberarVersaoNova = registerSW({
    immediate: true,
    onNeedRefresh() {
      versaoNovaPronta();
    },
    onRegisteredSW(_url, registration) {
      registro = registration ?? null;
      if (!registro) return;

      // Já havia uma versão pronta quando o app abriu — acontece quando a
      // pessoa fechou o app antes de a troca acontecer.
      if (registro.waiting) versaoNovaPronta();

      window.setInterval(() => void buscarNoServidor(), INTERVALO_DE_BUSCA);
    },
  });

  // Qualquer sinal de que a pessoa está usando a tela AGORA. Só serve para
  // adiar a recarga; nada mais depende disto, então é de graça.
  for (const evento of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(evento, () => (ultimoToque = Date.now()), { passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    // O app saiu da frente: atendeu uma ligação, foi ao WhatsApp, apagou a
    // tela. É a hora perfeita para trocar de versão — recarregar aqui não é
    // visto por ninguém, e quando ele voltar já estará na versão nova.
    if (document.visibilityState === 'hidden') {
      if (estado === 'disponivel') void trocarDeVersao();
      return;
    }

    // Voltou para a frente. É o gatilho que mais pega atualização na prática: o
    // representante abre o app dezenas de vezes por dia e quase nunca o fecha,
    // então este é o "carregamento de página" que ele não faz.
    ultimoToque = Date.now();
    if (Date.now() - ultimaBusca < ESPERA_MINIMA) return;
    void buscarNoServidor();
  });

  // Voltou o sinal. Enquanto estava offline não adiantava perguntar, e é
  // justamente quando ele sai da loja que dá para baixar a versão nova.
  window.addEventListener('online', () => {
    void buscarNoServidor();
  });

  // Rede de segurança: pedaço de tela que não baixa.
  //
  // Painel, comissões e importar só descem quando são abertos. Se a publicação
  // trocou os arquivos com o app aberto, o endereço que esta aba conhece já não
  // existe no servidor — e o que a pessoa vê é uma tela branca. Recarregar
  // resolve, porque na recarga vem o índice novo. Uma vez por sessão: se
  // recarregar não resolveu, o problema é outro e ficar recarregando esconde.
  window.addEventListener('vite:preloadError', ((evento: Event) => {
    evento.preventDefault();
    if (sessionStorage.getItem(CHAVE_RECARGA)) return;
    sessionStorage.setItem(CHAVE_RECARGA, '1');
    window.location.reload();
  }) as EventListener);
}

/**
 * Versão nova terminou de baixar e está pronta para entrar.
 *
 * Se o app não está na frente da tela, entra agora — ninguém vê. Se está,
 * espera a tela ficar parada: enquanto a pessoa mexe, o relógio não corre.
 */
function versaoNovaPronta(): void {
  definirEstado('disponivel');

  if (document.visibilityState !== 'visible') {
    void trocarDeVersao();
    return;
  }

  if (espreita !== null) return;
  espreita = window.setInterval(() => {
    if (Date.now() - ultimoToque < TEMPO_PARADO) return;
    void trocarDeVersao();
  }, RITMO_DA_ESPREITA);
}

/**
 * Libera a versão que está esperando e recarrega já com ela no ar.
 *
 * A recarga por conta própria, no fim, é rede de segurança: se não havia versão
 * em espera (ou o navegador não tem service worker), o `updateSW` volta sem
 * fazer nada e a página precisa recarregar do mesmo jeito. Quando a troca
 * funciona, a página some antes deste prazo.
 */
async function trocarDeVersao(pedidoDaPessoa = false): Promise<void> {
  if (jaTrocou && !pedidoDaPessoa) return;
  jaTrocou = true;

  if (espreita !== null) {
    window.clearInterval(espreita);
    espreita = null;
  }

  // A recarga que vem aí é a boa: não pode gastar a chance da rede de
  // segurança de quem abrir uma tela cujo pedaço sumiu do servidor.
  sessionStorage.removeItem(CHAVE_RECARGA);

  try {
    await liberarVersaoNova?.(true);
  } catch {
    // Ignorado de propósito: a recarga abaixo é o que importa.
  }
  window.setTimeout(() => window.location.reload(), 1500);
}

export function assinarAtualizacao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function estadoDaAtualizacao(): EstadoAtualizacao {
  return estado;
}

/**
 * Confere agora, a pedido da pessoa. Devolve se encontrou versão nova.
 *
 * Diferente da busca automática, esta mostra que está trabalhando e responde —
 * um botão que não diz nada quando já está tudo certo parece quebrado.
 */
export async function procurarAtualizacao(): Promise<boolean> {
  if (estado === 'disponivel') return true;
  if (!registro) return false;

  definirEstado('procurando');
  await buscarNoServidor();

  // `update()` só dispara a conferência; a versão encontrada ainda precisa
  // terminar de baixar. Sem esperar, o botão responderia "já está atualizado"
  // um segundo antes de o aviso de versão nova aparecer sozinho na tela.
  if (registro.installing) await esperarInstalar(registro.installing);

  const temVersaoNova = registro.waiting !== null;
  definirEstado(temVersaoNova ? 'disponivel' : 'atual');
  return temVersaoNova;
}

/** Espera o download terminar, com prazo — sinal ruim não trava o botão. */
function esperarInstalar(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const prazo = window.setTimeout(terminar, 20_000);

    function terminar(): void {
      window.clearTimeout(prazo);
      worker.removeEventListener('statechange', aoMudar);
      resolve();
    }

    function aoMudar(): void {
      if (worker.state === 'installing') return;
      terminar();
    }

    worker.addEventListener('statechange', aoMudar);
  });
}

/**
 * Troca agora, a pedido de quem tocou no botão.
 *
 * Vale mesmo que a troca automática já tenha sido tentada nesta sessão: quem
 * pediu na mão está justamente tentando resolver o caso em que ela não pegou.
 */
export async function aplicarAtualizacao(): Promise<void> {
  await trocarDeVersao(true);
}

/**
 * Versão que está rodando neste aparelho, em data e hora de Brasília.
 *
 * É o que o suporte pede no WhatsApp. Número de versão não diria nada a
 * ninguém aqui; "de 04/08 às 14:32" o gerente compara com a data em que
 * publicou e já sabe se o aparelho está atrasado.
 */
export function versaoDoApp(): string {
  const build = new Date(__VERSAO_BUILD__);
  if (Number.isNaN(build.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
    .format(build)
    .replace(', ', ' às ');
}
