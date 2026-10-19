import { describe, it, expect } from 'vitest';
import {
  ESCRITAS,
  ESCRITAS_COM_GUARDA,
  ILEGIVEIS,
  NAO_LIDO,
  ROUTERS_SEM_PAPEL,
  SEM_PAPEL_POR_DESENHO,
  TODAS,
  lerRotas,
  papeisDe,
  routers,
} from './inventarioDeRotas.js';

/**
 * INVENTÁRIO das rotas — o teste que quebra sozinho.
 *
 * Pedido do Yan (15/10/2026): o visualizador "pode ver tudo so nao pode
 * alterar nada". A garantia disso não pode ser uma lista que alguém mantém à
 * mão: daqui a seis meses nasce uma rota nova de escrita e ninguém se lembra
 * do papel. Então este teste LÊ todos os `apps/api/src/modules/**\/*.router.ts`
 * (pelo leitor de tests/inventarioDeRotas.ts) e exige, de cada registro de
 * POST/PATCH/PUT/DELETE:
 *
 *   1. que exista um `requireRole([...])` ligado a ele — direto no objeto de
 *      opções, ou numa const do mesmo arquivo que o registro use;
 *   2. que a lista de papéis seja LEGÍVEL (lista literal, não constante nem
 *      spread); e
 *   3. que ela NÃO contenha 'visualizador'.
 *
 * O item 1 é tão importante quanto o 3: os dois furos que existiam em
 * 15/10/2026 — `POST /orders` e `POST /push/assinar|desassinar|teste` — eram
 * exatamente rotas de escrita SEM `requireRole`, onde qualquer papel
 * autenticado passava. Procurar só pela string 'visualizador' dentro dos
 * `requireRole` daria verde com os dois furos abertos.
 *
 * O item 2 é o conserto do furo DESTE teste: `requireRole([...PAPEIS_QUE_LEEM
 * _O_ESCRITORIO])` não tem literal nenhum, era lido como lista VAZIA, e lista
 * vazia não contém 'visualizador' — rota de escrita aceitando o papel, teste
 * verde. Agora o leitor devolve NAO_LIDO e o teste PEDE a lista literal.
 *
 * E, por baixo de tudo isto, que é leitura de texto, tests/visualizador-rotas
 * bate em cada uma destas mesmas rotas com um token de visualizador e exige
 * 403 de verdade. Texto erra; 403 não.
 *
 * Rota de escrita que de propósito não tem papel precisa estar nomeada em
 * SEM_PAPEL_POR_DESENHO, uma a uma, com o motivo escrito. Nunca por regex
 * solta: um `/public/.*` ali deixaria passar a próxima rota pública que
 * gravasse algo sem ninguém reparar.
 */

const PAPEL = 'visualizador';

// Os números de HOJE (15/10/2026). São exatos de propósito: com
// `>= 35` um erro no leitor podia engolir quinze rotas e ninguém notava. Rota
// nova derruba estes três — e é esse o momento de conferir se ela tem
// `requireRole` e se o papel ficou de fora. Ao acrescentar, suba o número.
const QUANTOS_ROUTERS = 14;
// 055 (pedido inativo): +1 rota, +1 escrita — PATCH /orders/:id/inativo.
// Parceiro: +1 rota de leitura — GET /partner/v1/pedidos/cancelados.
// Dashboard: +1 rota de leitura — GET /reps/metas (metas da equipe, 19/10/2026).
const QUANTAS_ROTAS = 109;
const QUANTAS_ESCRITAS = 57;

describe('inventário: o leitor de routers está funcionando', () => {
  // Sem estas âncoras, um erro na expressão regular esvaziaria a lista e o
  // teste de baixo passaria sem olhar rota nenhuma — verde por nada.
  it('acha todos os routers', () => {
    const lista = routers();
    expect(lista).toContain('orders/orders.router.ts');
    expect(lista).toContain('push/push.router.ts');
    expect(lista).toContain('partner/partner.router.ts');
    expect(lista.length, 'router novo (ou apagado): confira a lista e ajuste o número').toBe(
      QUANTOS_ROUTERS,
    );
  });

  it('acha a quantidade exata de rotas de hoje', () => {
    expect(TODAS.length, 'rota nova (ou apagada): ajuste QUANTAS_ROTAS').toBe(QUANTAS_ROTAS);
    expect(ESCRITAS.length, 'escrita nova (ou apagada): ajuste QUANTAS_ESCRITAS').toBe(
      QUANTAS_ESCRITAS,
    );
  });

  it('nenhum registro de rota ficou ilegível', () => {
    // Caminho montado em variável ou concatenação deixaria a rota INVISÍVEL
    // para o inventário — o pior defeito que um teste destes pode ter.
    expect(
      ILEGIVEIS,
      'há registro de rota com caminho que o leitor não lê. Escreva o caminho como texto ' +
        "('/x', \"/x\" ou `/x`) ou ensine o leitor em tests/inventarioDeRotas.ts.",
    ).toBe(0);
  });

  it('a conta fecha: escrita ou tem guarda, ou está na lista de exceções', () => {
    const semGuarda = ESCRITAS.filter((r) => r.papeis === null);
    expect(ESCRITAS_COM_GUARDA.length + semGuarda.length).toBe(ESCRITAS.length);
    expect(semGuarda.length).toBe(Object.keys(SEM_PAPEL_POR_DESENHO).length);
    expect(ESCRITAS_COM_GUARDA.length).toBeGreaterThan(0);
  });

  it('lê os papéis de uma const de opções do próprio arquivo', () => {
    // `decideOPedido` é declarado no alto do orders.router e usado em 7 rotas.
    const status = TODAS.find((r) => r.id === 'orders/orders.router.ts#PATCH /orders/:id/status');
    expect(status?.papeis).toEqual(['rep', 'manager', 'admin', 'financeiro']);
  });

  it('lê os papéis escritos no próprio registro', () => {
    const numero = TODAS.find(
      (r) => r.id === 'orders/orders.router.ts#PATCH /orders/:id/numero-erp',
    );
    expect(numero?.papeis).toEqual(['financeiro', 'admin']);
  });
});

// ─── O leitor, provado nas formas que ele precisa entender ───────────────────

/**
 * `papeisDe` tem TRÊS respostas, e a diferença entre as duas últimas é o
 * conserto de 15/10/2026. Até aqui ele tinha duas — "achei a lista" e "não
 * achei requireRole" — e tudo o que não casava no regex caía na primeira como
 * lista VAZIA:
 *
 *   requireRole([...PAPEIS_QUE_LEEM_O_ESCRITORIO])  → []  → passava
 *   requireRole(["admin", "visualizador"])          → []  → passava
 *
 * As duas são rotas que ACEITAM o visualizador em tempo de execução, e o teste
 * de inventário — que existe exatamente para isso — dava verde. Esta entrega
 * criou `PAPEIS_QUE_LEEM_O_ESCRITORIO`, então a primeira forma é a que a
 * próxima pessoa vai escrever ao "tirar a repetição" dos routers.
 */
describe('papeisDe: lista literal, nada, ou NAO_LIDO', () => {
  it('lista literal com aspas simples', () => {
    expect(papeisDe("requireRole(['admin', 'manager'])")).toEqual(['admin', 'manager']);
  });

  it('lista literal com aspas DUPLAS — o prettier do dia troca as aspas', () => {
    expect(papeisDe('requireRole(["admin", "visualizador"])')).toEqual(['admin', 'visualizador']);
  });

  it('vírgula sobrando no fim não atrapalha', () => {
    expect(papeisDe("requireRole([\n  'admin',\n  'financeiro',\n])")).toEqual([
      'admin',
      'financeiro',
    ]);
  });

  it('sem requireRole: null — é o outro describe que cobra a guarda', () => {
    expect(papeisDe('{ preHandler: [authenticate] }')).toBeNull();
  });

  it.each([
    ['spread de constante', 'requireRole([...PAPEIS_QUE_LEEM_O_ESCRITORIO])'],
    ['spread misturado com literal', "requireRole(['admin', ...SO_LEITURA])"],
    ['constante sem colchete', 'requireRole(PAPEIS_QUE_LEEM_O_ESCRITORIO)'],
    ['variável dentro da lista', 'requireRole([papelDoEscritorio])'],
    ['chamada dentro da lista', 'requireRole([papeis()])'],
  ])('%s: NAO_LIDO — o leitor não chuta', (_nome, trecho) => {
    expect(papeisDe(trecho)).toBe(NAO_LIDO);
  });

  it('lista literalmente vazia continua sendo lista vazia', () => {
    expect(papeisDe('requireRole([])')).toEqual([]);
  });
});

describe('o leitor enxerga a rota em qualquer aspas', () => {
  const comCaminho = (abre: string, fecha: string) =>
    `export async function r(fastify) {\n` +
    `  fastify.post(${abre}/x${fecha}, { preHandler: [authenticate, requireRole(['admin'])] }, h);\n` +
    `}\n`;

  it.each([
    ['aspas simples', "'", "'"],
    ['aspas duplas', '"', '"'],
    ['crase', '`', '`'],
  ])('%s', (_nome, abre, fecha) => {
    const { rotas, ilegiveis } = lerRotas('x/x.router.ts', comCaminho(abre, fecha));
    expect(ilegiveis).toBe(0);
    expect(rotas).toHaveLength(1);
    expect(rotas[0]!.caminho).toBe('/x');
    expect(rotas[0]!.papeis).toEqual(['admin']);
  });

  it('caminho montado em variável é contado como ILEGÍVEL, não ignorado', () => {
    const fonte = 'fastify.post(CAMINHO, { preHandler: [authenticate] }, h);';
    const { rotas, ilegiveis } = lerRotas('x/x.router.ts', fonte);
    expect(rotas).toHaveLength(0);
    expect(ilegiveis).toBe(1);
  });

  it('e a escrita com spread chega ao inventário como NAO_LIDO', () => {
    // A prova de ponta a ponta do furo: um router inteiro, do jeito que a
    // pessoa escreveria, e o leitor dizendo "não sei" em vez de "lista vazia".
    const fonte =
      "export async function r(fastify) {\n" +
      "  fastify.post('/erp/integracao/furo', { preHandler: [authenticate, requireRole([...PAPEIS_QUE_LEEM_O_ESCRITORIO])] }, h);\n" +
      '}\n';
    const { rotas } = lerRotas('integracao/integracao.router.ts', fonte);
    expect(rotas[0]!.papeis).toBe(NAO_LIDO);
  });
});

describe(`nenhuma rota de escrita aceita '${PAPEL}'`, () => {
  it.each(ESCRITAS.map((r) => [r.id, r] as const))('%s', (_id, rota) => {
    expect(
      rota.papeis,
      `não sei dizer os papéis de ${rota.id}: escreva a lista de papéis literal nesta rota ` +
        '(sem constante, sem spread), ou ensine o leitor em tests/inventarioDeRotas.ts a ' +
        'resolver a constante.',
    ).not.toBe(NAO_LIDO);

    // `?? []` porque a rota sem `requireRole` é assunto do outro describe —
    // aqui, sem lista de papéis, não há papel para recusar.
    expect(rota.papeis ?? [], `${rota.id} aceita '${PAPEL}' — nenhuma escrita pode`).not.toContain(
      PAPEL,
    );
  });
});

describe('toda rota de escrita tem requireRole', () => {
  // O outro lado da moeda. `POST /orders` e as três de push viviam com só
  // `authenticate` — e é essa a forma do furo: sem lista de papéis, TODO papel
  // autenticado entra, o visualizador junto.
  it.each(ESCRITAS.map((r) => [r.id, r] as const))('%s', (_id, rota) => {
    if (rota.papeis !== null) return;
    expect(
      SEM_PAPEL_POR_DESENHO[rota.id],
      `${rota.id} grava e não tem requireRole. Dê um à rota, ou nomeie-a em ` +
        'SEM_PAPEL_POR_DESENHO com o motivo (credencial que não é JWT, rota pública).',
    ).toBeTruthy();
  });

  it('a lista de exceções não guarda rota que já morreu', () => {
    const ids = new Set(TODAS.map((r) => r.id));
    for (const id of Object.keys(SEM_PAPEL_POR_DESENHO)) {
      expect(ids.has(id), `${id} está na lista de exceções e não existe mais`).toBe(true);
    }
  });

  it('as duas escritas que eram furo agora têm papel', () => {
    const pedido = TODAS.find((r) => r.id === 'orders/orders.router.ts#POST /orders');
    expect(pedido?.papeis).toEqual(['rep', 'manager', 'admin', 'financeiro', 'store', 'guest']);

    for (const rota of ['assinar', 'desassinar', 'teste']) {
      const push = TODAS.find((r) => r.id === `push/push.router.ts#POST /push/${rota}`);
      expect(push?.papeis, `/push/${rota} sem papel`).not.toBeNull();
      expect(push?.papeis).not.toContain(PAPEL);
    }
  });
});

describe('API de Parceiro: nada de papel ali', () => {
  it('nenhuma rota do partner.router cita requireRole', () => {
    const doParceiro = TODAS.filter((r) => ROUTERS_SEM_PAPEL.has(r.arquivo));
    expect(doParceiro.length).toBeGreaterThanOrEqual(15);
    for (const rota of doParceiro) {
      expect(rota.papeis, `${rota.id} ganhou papel — a credencial dali é X-API-Key`).toBeNull();
    }
  });
});
