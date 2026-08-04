/**
 * Instalação do app na tela inicial.
 *
 * O navegador avisa que dá para instalar UMA vez, num evento que costuma
 * disparar antes do React montar. Por isso a escuta é registrada no arranque
 * (`main.tsx`) e o convite fica guardado aqui: quando a tela finalmente
 * pergunta, a resposta já está pronta. Sem isso o botão só apareceria para quem
 * demorasse a navegar — ou nunca.
 */

interface EventoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * - `instalado`: já está rodando como app, não há o que oferecer.
 * - `pronto`: o navegador liberou o convite — um toque instala. É o caso do
 *   Chrome, Edge, Samsung Internet e Opera, no Android e no computador.
 * - `manual-apple`: iPhone/iPad. A Apple **não implementa** a API de instalação
 *   em nenhum navegador do iOS, de propósito — só o menu Compartilhar do Safari
 *   adiciona à tela de início. Não há como automatizar; resta ensinar.
 * - `manual-firefox`: o Firefox instala pelo menu dele, mas também não dispara
 *   o convite programático. Sem este caso o cartão sumia e o usuário de Firefox
 *   nunca ficava sabendo que dá para instalar.
 * - `manual`: o navegador não ofereceu o convite e não é nenhum dos casos
 *   conhecidos. Acontece muito no Chrome quando o app JÁ FOI instalado neste
 *   perfil: ele não oferece de novo. Some ≠ não dá — o caminho pelo menu
 *   continua valendo, e é ele que o cartão ensina.
 */
export type EstadoInstalacao =
  | 'instalado'
  | 'pronto'
  | 'manual-apple'
  | 'manual-firefox'
  | 'manual';

let convite: EventoDeInstalacao | null = null;
let jaInstalado = false;
const ouvintes = new Set<() => void>();

function avisarTodos(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

/** Aberto pela tela inicial do sistema, não pelo navegador. */
function rodandoComoApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari no iOS não implementa display-mode; usa uma flag própria.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * iPhone e iPad. O iPad moderno se declara "Macintosh", então só o nome não
 * basta — Mac de verdade não tem tela sensível ao toque.
 */
function ehApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iphone|ipod|ipad/i.test(ua)) return true;
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/** `fxios` é o Firefox do iOS — lá vale a regra da Apple, não a do Firefox. */
function ehFirefox(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /firefox|fxios/i.test(navigator.userAgent);
}

/** Chamado uma vez, no arranque do app. */
export function observarInstalacao(): void {
  if (typeof window === 'undefined') return;

  jaInstalado = rodandoComoApp();

  window.addEventListener('beforeinstallprompt', (evento) => {
    // Sem isto o Chrome mostra a barrinha dele por cima do app. Preferimos
    // oferecer no lugar certo, dentro da "Minha área".
    evento.preventDefault();
    convite = evento as EventoDeInstalacao;
    avisarTodos();
  });

  window.addEventListener('appinstalled', () => {
    convite = null;
    jaInstalado = true;
    avisarTodos();
  });
}

export function assinarInstalacao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * Devolve string (não objeto) de propósito: `useSyncExternalStore` compara por
 * identidade, e um objeto novo a cada leitura renderizaria para sempre.
 */
export function estadoDaInstalacao(): EstadoInstalacao {
  if (jaInstalado) return 'instalado';
  if (convite) return 'pronto';
  // A regra da Apple vale para QUALQUER navegador no iPhone: Chrome e Firefox
  // no iOS são o Safari por baixo e seguem a mesma limitação.
  if (ehApple()) return 'manual-apple';
  if (ehFirefox()) return 'manual-firefox';
  return 'manual';
}

/**
 * Abre o convite do navegador. Devolve se a pessoa aceitou.
 *
 * O convite vale UMA vez: depois de usado o navegador não devolve outro nesta
 * sessão, então ele é descartado tenha dado certo ou não — deixá-lo à mão faria
 * o segundo toque não abrir nada, que parece defeito.
 */
export async function pedirInstalacao(): Promise<boolean> {
  if (!convite) return false;
  const evento = convite;
  convite = null;
  avisarTodos();

  try {
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}
