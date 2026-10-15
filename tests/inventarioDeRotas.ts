import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * O LEITOR dos routers: descobre toda rota registrada em
 * `apps/api/src/modules/**\/*.router.ts` e os papéis que guardam cada uma.
 *
 * Mora fora do arquivo de teste porque duas provas diferentes usam a MESMA
 * lista (Yan, 15/10/2026: "ele pode ver tudo so nao pode alterar nada"):
 *
 *   • tests/visualizador-inventario — lê o TEXTO e exige que nenhuma rota de
 *     escrita cite 'visualizador' e que todas tenham `requireRole`;
 *   • tests/visualizador-rotas — pega essa mesma lista e BATE em cada rota de
 *     escrita com um token de visualizador, exigindo 403.
 *
 * A segunda existe porque a primeira, sozinha, é um leitor de texto: qualquer
 * forma de escrever `requireRole` que ele não entenda era verde silencioso.
 * Agora o leitor nunca "chuta" — ou devolve a lista literal, ou devolve
 * `NAO_LIDO`, e `NAO_LIDO` quebra o teste pedindo a lista literal. O 403 de
 * verdade é a rede embaixo disso.
 */

const RAIZ_MODULOS = path.resolve(__dirname, '../apps/api/src/modules');

/**
 * O leitor não conseguiu dizer quais são os papéis desta rota.
 *
 * É o terceiro estado, e ele é o conserto do furo de 15/10/2026: antes havia
 * só "achei a lista" e "não achei requireRole", então `requireRole([...
 * PAPEIS_QUE_LEEM_O_ESCRITORIO])` — spread, zero literais — devolvia lista
 * VAZIA. Lista vazia não contém 'visualizador', o teste passava, e a rota
 * aceitava o papel em tempo de execução. Com `NAO_LIDO` ninguém mais confunde
 * "não tem papel nenhum" com "não sei ler".
 */
export const NAO_LIDO = 'nao-lido';

/** Os papéis de uma rota: a lista literal, `null` (sem requireRole) ou NAO_LIDO. */
export type Papeis = string[] | null | typeof NAO_LIDO;

export interface Rota {
  arquivo: string;
  metodo: string;
  caminho: string;
  /** A chave de SEM_PAPEL_POR_DESENHO. */
  id: string;
  papeis: Papeis;
}

/**
 * As rotas de escrita que NÃO têm (e não devem ter) `requireRole`, com o
 * porquê. Chave: `<arquivo do router>#<MÉTODO> <caminho>`.
 */
export const SEM_PAPEL_POR_DESENHO: Record<string, string> = {
  // Entrar no sistema é o que ACONTECE ANTES de existir papel. Rate-limit
  // apertado no lugar da guarda (10/min no login, 30/min no refresh).
  'auth/auth.router.ts#POST /auth/login': 'login: não há token ainda, logo não há papel',
  'auth/auth.router.ts#POST /auth/refresh': 'refresh: o token velho é a credencial',

  // Criar a EMPRESA é rota da plataforma (o dono do sistema), não de um
  // usuário de dentro: a credencial é o header x-platform-key.
  'company/company.router.ts#POST /companies/onboard': 'x-platform-key, não JWT',

  // As três públicas: quem abre o link ainda não tem (ou nunca terá) conta.
  // A credencial é o token assinado da URL + rate-limit de 10/min.
  'access/access.router.ts#POST /public/invite/:token': 'convite: cria o login da loja, sem login',
  'access/access.router.ts#POST /public/showcase/:token': 'vitrine: abre sessão de visitante',
};

/**
 * O router do PARCEIRO inteiro fica fora: nenhuma rota dele tem `authenticate`
 * nem `requireRole` — a credencial é o `X-API-Key` do ERP do Fábio
 * (partner.auth.ts), e não existe usuário nem papel do lado de lá.
 *
 * A ação aqui é NEGATIVA e está escrita para quem vier depois: nunca pendurar
 * `authenticate`/`requireRole` nestas rotas para "dar leitura ao
 * visualizador". A regra 3 do pedido ("nada da API de Parceiro") já está
 * satisfeita por não haver papel nenhum nelas.
 */
export const ROUTERS_SEM_PAPEL = new Set(['partner/partner.router.ts']);

/** Todos os `*.router.ts` sob apps/api/src/modules, em caminho relativo. */
export function routers(dir = RAIZ_MODULOS, prefixo = ''): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    const relativo = prefixo ? `${prefixo}/${nome}` : nome;
    if (statSync(cheio).isDirectory()) {
      achados.push(...routers(cheio, relativo));
    } else if (nome.endsWith('.router.ts')) {
      achados.push(relativo);
    }
  }
  return achados;
}

/**
 * A fonte sem comentário nenhum, com as aspas preservadas.
 *
 * Precisa ser feito antes de qualquer leitura: estes routers são MUITO
 * comentados, e um `// o visualizador não entra aqui` ou um pedaço de rota
 * comentada mudaria a resposta do teste. Troca cada comentário por espaço do
 * mesmo tamanho para as posições não andarem.
 */
export function semComentarios(fonte: string): string {
  let fora = '';
  let i = 0;
  let aspa: string | null = null;
  while (i < fonte.length) {
    const c = fonte[i]!;
    if (aspa) {
      fora += c;
      if (c === '\\') {
        fora += fonte[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === aspa) aspa = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      aspa = c;
      fora += c;
      i++;
      continue;
    }
    if (c === '/' && fonte[i + 1] === '/') {
      while (i < fonte.length && fonte[i] !== '\n') {
        fora += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && fonte[i + 1] === '*') {
      const fim = fonte.indexOf('*/', i + 2);
      const ate = fim === -1 ? fonte.length : fim + 2;
      for (let j = i; j < ate; j++) fora += fonte[j] === '\n' ? '\n' : ' ';
      i = ate;
      continue;
    }
    fora += c;
    i++;
  }
  return fora;
}

/**
 * O trecho entre o delimitador que abre na posição `abre` e o que o fecha.
 *
 * Contar os delimitadores em vez de procurar `\n  );` ou `\n  };`: o mesmo
 * arquivo tem registro de uma linha (`fastify.post('/orders', montaPedido,
 * handler);`) e de quinze, e um objeto de opções pode trazer array dentro de
 * array. Casar por texto dava emendas monstruosas — um `const logado = {…};`
 * de uma linha engolia as duas consts seguintes e herdava o papel errado.
 */
export function entreDelimitadores(fonte: string, abre: number, par: '()' | '{}'): string {
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === par[0]) nivel++;
    else if (fonte[i] === par[1]) {
      nivel--;
      if (nivel === 0) return fonte.slice(abre + 1, i);
    }
  }
  return fonte.slice(abre + 1);
}

/** Separa por vírgula no nível de cima (não entra em `[...]`, `(...)` nem aspas). */
function pedacosDaLista(dentro: string): string[] {
  const pedacos: string[] = [];
  let atual = '';
  let nivel = 0;
  let aspa: string | null = null;
  for (let i = 0; i < dentro.length; i++) {
    const c = dentro[i]!;
    if (aspa) {
      atual += c;
      if (c === '\\') {
        atual += dentro[i + 1] ?? '';
        i++;
        continue;
      }
      if (c === aspa) aspa = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      aspa = c;
      atual += c;
      continue;
    }
    if (c === '[' || c === '(' || c === '{') nivel++;
    if (c === ']' || c === ')' || c === '}') nivel--;
    if (c === ',' && nivel === 0) {
      pedacos.push(atual);
      atual = '';
      continue;
    }
    atual += c;
  }
  pedacos.push(atual);
  // Vírgula sobrando no fim (`['admin',]`) deixa um pedaço vazio: não é falta
  // de literal, é formatação. Pedaço vazio NO MEIO não existe em JS válido.
  return pedacos.filter((p) => p.trim() !== '');
}

/**
 * Os papéis do PRIMEIRO `requireRole(...)` do trecho.
 *
 * Três respostas, e a diferença entre as duas últimas é o conserto de
 * 15/10/2026:
 *
 *   • `['admin', "financeiro"]` → `['admin', 'financeiro']` — lista literal,
 *     com aspas simples OU duplas (antes só simples: `requireRole(["admin",
 *     "visualizador"])` era lido como lista vazia e passava).
 *   • nenhum `requireRole` no trecho → `null`.
 *   • qualquer outra forma — `requireRole(CONST)`, `requireRole([...LISTA])`,
 *     `requireRole([papel])`, `requireRole(montar())` → `NAO_LIDO`. O leitor
 *     NÃO chuta: quem chuta aprova rota de escrita que aceita o visualizador.
 */
export function papeisDe(trecho: string): Papeis {
  const achou = trecho.indexOf('requireRole(');
  if (achou === -1) return null;

  const abre = achou + 'requireRole('.length - 1;
  const argumento = entreDelimitadores(trecho, abre, '()').trim();
  // Sem colchete é constante, variável ou chamada — nada para ler aqui.
  if (!argumento.startsWith('[') || !argumento.endsWith(']')) return NAO_LIDO;

  const dentro = argumento.slice(1, -1).trim();
  if (dentro === '') return [];

  const papeis: string[] = [];
  for (const pedaco of pedacosDaLista(dentro)) {
    const literal = pedaco.trim().match(/^(['"])([^'"]*)\1$/);
    if (!literal) return NAO_LIDO;
    papeis.push(literal[2]!);
  }
  return papeis;
}

/**
 * As consts de opções do arquivo (`const decideOPedido = { preHandler: [...] }`)
 * e os papéis de cada uma. É assim que uma rota herda o `requireRole` de um
 * `daFabricaOuLoja` declarado no alto do router.
 */
export function constantesDeOpcoes(fonte: string): Map<string, Papeis> {
  const mapa = new Map<string, Papeis>();
  for (const m of fonte.matchAll(/const\s+(\w+)\s*=\s*(\{)/g)) {
    const corpo = entreDelimitadores(fonte, m.index! + m[0]!.length - 1, '{}');
    if (!corpo.includes('preHandler')) continue;
    mapa.set(m[1]!, papeisDe(corpo));
  }
  return mapa;
}

/** O que `rotasDe` achou num router: as rotas e os registros que não deu para ler. */
export interface LeituraDoRouter {
  rotas: Rota[];
  /** Registros `fastify.<metodo>(` sem caminho legível — rota INVISÍVEL ao teste. */
  ilegiveis: number;
}

/** Todo `fastify.<metodo>(...)` de um router, com os papéis que o guardam. */
export function rotasDe(arquivo: string): LeituraDoRouter {
  return lerRotas(arquivo, readFileSync(path.join(RAIZ_MODULOS, arquivo), 'utf8'));
}

/**
 * O leitor propriamente dito, separado do disco para poder ser TESTADO com
 * fonte sintética — é como se prova que ele enxerga `requireRole(["a"])`,
 * `fastify.post(`/x`, …)` e devolve NAO_LIDO no spread, sem precisar mutar um
 * router de produção.
 */
export function lerRotas(arquivo: string, fonteCrua: string): LeituraDoRouter {
  const fonte = semComentarios(fonteCrua);
  const consts = constantesDeOpcoes(fonte);
  const rotas: Rota[] = [];
  let ilegiveis = 0;

  for (const m of fonte.matchAll(/fastify\.(get|post|patch|put|delete)\(/g)) {
    const metodo = m[1]!.toUpperCase();
    const argumentos = entreDelimitadores(fonte, m.index! + m[0]!.length - 1, '()');
    // Aspas simples, duplas OU crase: `fastify.post(`/x`, …)` deixava a rota
    // invisível ao leitor, que é a pior falha possível num teste de inventário.
    const aspas = argumentos.match(/^\s*(['"`])([^'"`]*)\1/);
    const caminho = aspas?.[2];
    if (!caminho) {
      // Caminho montado em variável/concatenação: o teste de âncora precisa
      // saber, senão a rota desaparece em silêncio.
      ilegiveis++;
      continue;
    }
    const resto = argumentos.slice(argumentos.indexOf(caminho) + caminho.length);

    let papeis = papeisDe(resto);
    if (papeis === null) {
      // Opções vindas de uma const do arquivo: pega a primeira que o trecho
      // mencione (um registro referencia uma só).
      for (const [nome, lista] of consts) {
        if (new RegExp(`\\b${nome}\\b`).test(resto)) {
          papeis = lista;
          break;
        }
      }
    }
    rotas.push({ arquivo, metodo, caminho, id: `${arquivo}#${metodo} ${caminho}`, papeis });
  }
  return { rotas, ilegiveis };
}

const LEITURAS = routers().map((arquivo) => rotasDe(arquivo));

/** Toda rota de todo router. */
export const TODAS: Rota[] = LEITURAS.flatMap((l) => l.rotas);

/** Quantos registros o leitor viu e não conseguiu ler. Tem de ser 0. */
export const ILEGIVEIS: number = LEITURAS.reduce((s, l) => s + l.ilegiveis, 0);

/** As rotas que GRAVAM (fora o router do Parceiro, que não tem papel). */
export const ESCRITAS: Rota[] = TODAS.filter(
  (r) => r.metodo !== 'GET' && !ROUTERS_SEM_PAPEL.has(r.arquivo),
);

/**
 * As escritas que TÊM guarda de papel — as que precisam responder 403 a um
 * token de visualizador. Inclui as `NAO_LIDO`: é justamente nelas que o texto
 * não prova nada e só o 403 de verdade resolve.
 */
export const ESCRITAS_COM_GUARDA: Rota[] = ESCRITAS.filter((r) => r.papeis !== null);
