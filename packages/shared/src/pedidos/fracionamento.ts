import type { AuthRole } from '../constants/userRole.js';
import type { OrderStatus } from '../constants/orderStatus.js';
import { podeMexerNoPedido, type PedidoParaMexer } from './mexerNoPedido.js';
import { apenasLinhasDeCor, juntarObservacao, semLinhasDeCor } from './observacaoCores.js';

/**
 * FRACIONAMENTO DE PEDIDOS (migração 057) — um pedido, várias ENTREGAS.
 *
 * Yan (05/11/2026), com o exemplo do pedido #57 da S H J Moda Íntima: no app
 * era um pedido só (R$ 21.227,70) e no Control saiu em três — PL02727, PL02728
 * e PL02729 —, cada um com a sua data de saída e a sua nota. "Quando ele for
 * clicado em fracionado vai ser quando ele vai ter 3 datas de envios."
 *
 * O que ficou combinado:
 *   - cada entrega vira um PEDIDO próprio (número do app, número do Control,
 *     status e faturamento próprios), todos ligados pelo mesmo grupo — a tela
 *     avisa que é fracionado e dá os botões para ir de uma entrega à outra;
 *   - a separação das peças tem a opção automática: quantidades em partes
 *     iguais (`dividirEmPartesIguais`); quem fraciona ajusta à mão se quiser;
 *   - todos podem fracionar, com a MESMA trava de mexer no pedido
 *     (`podeMexerNoPedido`): passou para frente, não mexe; faturou, ninguém;
 *   - quem acompanha o pedido é avisado (push) quando ele é fracionado.
 *
 * Preço, tabela, desconto, condição e cliente NÃO mudam: cada entrega herda os
 * do pedido, e a soma das entregas é o pedido de antes (a menos do centavo do
 * arredondamento do desconto).
 *
 * Mora no shared porque a tela monta e valida a distribuição com a MESMA
 * conta que a API usa para aceitar ou recusar.
 */

export const MINIMO_DE_ENTREGAS = 2;
export const MAXIMO_DE_ENTREGAS = 6;

// ─── Quem pode ───────────────────────────────────────────────────────────────

export type PodeFracionar = 'ok' | 'forbidden' | 'tarde_demais' | 'ja_fracionado';

export interface PedidoParaFracionar extends PedidoParaMexer {
  split_group_id?: string | null | undefined;
}

export function podeFracionarPedido(
  pedido: PedidoParaFracionar,
  papel: AuthRole | null | undefined,
  user_id: string | null | undefined,
  vendaInterna = false,
): PodeFracionar {
  const base = podeMexerNoPedido(pedido, papel, user_id, vendaInterna);
  if (base !== 'ok') return base;
  // Entrega não se fraciona de novo: o ajuste entre entregas é no "editar peças".
  return pedido.split_group_id ? 'ja_fracionado' : 'ok';
}

export type PodeMudarDataDeEnvio = 'ok' | 'forbidden' | 'tarde_demais' | 'nao_fracionado';

/** A data de envio de uma entrega muda pelo mesmo portão — e só em pedido fracionado. */
export function podeMudarDataDeEnvio(
  pedido: PedidoParaFracionar,
  papel: AuthRole | null | undefined,
  user_id: string | null | undefined,
  vendaInterna = false,
): PodeMudarDataDeEnvio {
  const base = podeMexerNoPedido(pedido, papel, user_id, vendaInterna);
  if (base !== 'ok') return base;
  return pedido.split_group_id ? 'ok' : 'nao_fracionado';
}

// ─── O que vai e volta pela API ──────────────────────────────────────────────

/** Quanto de um item do pedido vai numa entrega. */
export interface ParteDoItem {
  /** `order_items.id` do pedido que está sendo fracionado. */
  item_id: string;
  quantity: number;
}

export interface EntregaPedida {
  /** A data de envio da entrega, "AAAA-MM-DD". */
  ship_date: string;
  itens: ParteDoItem[];
}

/** POST /orders/:id/fracionar */
export interface FracionarPedidoRequest {
  entregas: EntregaPedida[];
}

/** PATCH /orders/:id/data-de-envio */
export interface MudarDataDeEnvioRequest {
  ship_date: string;
}

/** Uma entrega do grupo, como o GET /orders/:id devolve em `fracionamento`. */
export interface EntregaDoGrupo {
  id: string;
  order_number: number | null;
  /** 1 = a primeira entrega (o pedido que foi fracionado). */
  indice: number;
  ship_date: string | null;
  status: OrderStatus;
  invoiced: boolean;
  total: number | null;
  erp_order_id: string | null;
}

/** O bloco `fracionamento` do pedido: em que entrega ele está e quais são as outras. */
export interface FracionamentoDoPedido {
  grupo: string;
  indice: number;
  /** Em quantas entregas o pedido foi fracionado (a conta da hora do clique). */
  total_de_entregas: number;
  ship_date: string | null;
  fracionado_em: string | null;
  fracionado_por_nome: string | null;
  /** As entregas que existem hoje, na ordem — esta inclusive. */
  entregas: EntregaDoGrupo[];
}

// ─── Rótulos ─────────────────────────────────────────────────────────────────

/** "Entrega 1/3" (selo) ou "Entrega 1 de 3" (frase). */
export function rotuloDaEntrega(
  indice: number | null | undefined,
  total: number | null | undefined,
  formato: 'curto' | 'longo' = 'curto',
): string {
  if (!indice || !total) return 'Entrega';
  return formato === 'curto' ? `Entrega ${indice}/${total}` : `Entrega ${indice} de ${total}`;
}

/** "AAAA-MM-DD" é uma data de calendário que existe? */
export function dataDeEnvioValida(v: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (ano < 2000 || ano > 2100) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * "2026-10-21" → "21/10/2026". Só troca a ordem do texto, de propósito: passar
 * por `new Date()` jogaria a data para o dia anterior no fuso de Brasília.
 */
export function dataDeEnvioPorExtenso(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// ─── A separação automática ──────────────────────────────────────────────────

export interface ItemParaFracionar {
  id: string;
  quantity: number;
}

/**
 * QUANTIDADES EM PARTES IGUAIS — a opção automática.
 *
 * Cada linha (peça × tamanho) é dividida pelo número de entregas. A sobra da
 * divisão não fica sempre na primeira: ela é distribuída em RODÍZIO, e o
 * rodízio continua de uma linha para a outra. Grade de moda é quantidade
 * pequena por tamanho (1 P, 2 M, 2 G, 1 GG); com a sobra sempre na primeira, um
 * pedido desses iria inteiro para a entrega 1 e as outras nasceriam vazias. Com
 * o rodízio, as entregas terminam com o mesmo número de peças — a diferença
 * entre a maior e a menor é de, no máximo, uma peça.
 *
 * A ordem dos itens decide quem leva a sobra de cada linha; a tela manda na
 * ordem em que mostra (referência crescente, grade em ordem).
 */
export function dividirEmPartesIguais(
  itens: readonly ItemParaFracionar[],
  entregas: number,
): ParteDoItem[][] {
  const n = Math.max(1, Math.floor(entregas));
  const saida: ParteDoItem[][] = Array.from({ length: n }, () => []);
  let vez = 0;
  for (const item of itens) {
    const q = Math.max(0, Math.floor(item.quantity));
    const porEntrega = new Array<number>(n).fill(Math.floor(q / n));
    for (let sobra = q % n; sobra > 0; sobra--) {
      porEntrega[vez] = (porEntrega[vez] ?? 0) + 1;
      vez = (vez + 1) % n;
    }
    porEntrega.forEach((quantity, i) => {
      if (quantity > 0) saida[i]!.push({ item_id: item.id, quantity });
    });
  }
  return saida;
}

// ─── A conferência da distribuição ───────────────────────────────────────────

export type ErroDaDistribuicao =
  | 'quantidade_de_entregas'
  | 'data_invalida'
  | 'item_desconhecido'
  | 'item_repetido'
  | 'quantidade_invalida'
  | 'soma_diferente'
  | 'entrega_vazia';

export type ConferenciaDaDistribuicao =
  | { ok: true; pecasPorEntrega: number[] }
  | { ok: false; erro: ErroDaDistribuicao; entrega?: number; item_id?: string };

/**
 * A distribuição fecha? Toda peça do pedido tem de estar em exatamente uma
 * entrega — nenhuma some, nenhuma dobra —, toda entrega leva pelo menos uma
 * peça e tem data. É a mesma conta na tela (habilita o botão) e na API
 * (aceita ou recusa).
 */
export function conferirDistribuicao(
  itens: readonly ItemParaFracionar[],
  entregas: readonly EntregaPedida[],
): ConferenciaDaDistribuicao {
  if (entregas.length < MINIMO_DE_ENTREGAS || entregas.length > MAXIMO_DE_ENTREGAS) {
    return { ok: false, erro: 'quantidade_de_entregas' };
  }
  const doPedido = new Map(itens.map((i) => [i.id, i.quantity]));
  const somado = new Map<string, number>();
  const pecasPorEntrega: number[] = [];

  for (const [indice, entrega] of entregas.entries()) {
    if (!dataDeEnvioValida(entrega.ship_date)) return { ok: false, erro: 'data_invalida', entrega: indice + 1 };
    const vistos = new Set<string>();
    let pecas = 0;
    for (const parte of entrega.itens) {
      if (!doPedido.has(parte.item_id)) {
        return { ok: false, erro: 'item_desconhecido', entrega: indice + 1, item_id: parte.item_id };
      }
      if (vistos.has(parte.item_id)) {
        return { ok: false, erro: 'item_repetido', entrega: indice + 1, item_id: parte.item_id };
      }
      vistos.add(parte.item_id);
      if (!Number.isInteger(parte.quantity) || parte.quantity <= 0) {
        return { ok: false, erro: 'quantidade_invalida', entrega: indice + 1, item_id: parte.item_id };
      }
      pecas += parte.quantity;
      somado.set(parte.item_id, (somado.get(parte.item_id) ?? 0) + parte.quantity);
    }
    if (pecas === 0) return { ok: false, erro: 'entrega_vazia', entrega: indice + 1 };
    pecasPorEntrega.push(pecas);
  }

  for (const [id, quantidade] of doPedido) {
    if ((somado.get(id) ?? 0) !== quantidade) return { ok: false, erro: 'soma_diferente', item_id: id };
  }
  return { ok: true, pecasPorEntrega };
}

/** A frase de cada recusa — a mesma na tela e na resposta da API. */
export function mensagemDoErroDaDistribuicao(erro: ErroDaDistribuicao, entrega?: number): string {
  const qual = entrega ? `A entrega ${entrega}` : 'Uma entrega';
  switch (erro) {
    case 'quantidade_de_entregas':
      return `O pedido é fracionado em ${MINIMO_DE_ENTREGAS} a ${MAXIMO_DE_ENTREGAS} entregas.`;
    case 'data_invalida':
      return `${qual} está sem a data de envio.`;
    case 'entrega_vazia':
      return `${qual} ficou sem nenhuma peça.`;
    case 'soma_diferente':
      return 'A soma das entregas não bate com as peças do pedido. Confira as quantidades.';
    case 'item_desconhecido':
      return 'O pedido mudou enquanto você fracionava. Feche e abra de novo.';
    case 'item_repetido':
    case 'quantidade_invalida':
      return 'Há uma quantidade inválida na distribuição das peças.';
  }
}

// ─── As cores anotadas, entrega por entrega ──────────────────────────────────

export interface ItemComReferencia extends ItemParaFracionar {
  /** Referência (SKU) da peça. `null` quando o produto saiu do catálogo. */
  sku: string | null;
  /** Tamanho da variante ("M", "48"). `null` em item antigo sem variante. */
  size: string | null;
}

interface CorNaEntrega {
  /** Linha que não deu para ler vai como veio. */
  crua?: string;
  sku?: string;
  size?: string;
  cor?: string;
  quantidade?: number;
}

/**
 * "3M" → 3 peças do M; "248" → 2 peças do 48. A quantidade vem colada no
 * tamanho (`observacaoDeCores` escreve `${total}${size}`), então só os
 * tamanhos que a peça TEM no pedido desfazem a ambiguidade. O tamanho mais
 * comprido vence ("48" antes de "8").
 */
function lerQuantidadeETamanho(
  qtdTam: string,
  tamanhos: ReadonlySet<string> | undefined,
): { quantidade: number; size: string } | null {
  const candidatos = [...(tamanhos ?? [])].sort((a, b) => b.length - a.length);
  for (const size of candidatos) {
    if (!size || !qtdTam.endsWith(size)) continue;
    const antes = qtdTam.slice(0, qtdTam.length - size.length);
    if (/^\d+$/.test(antes) && Number(antes) > 0) return { quantidade: Number(antes), size };
  }
  return null;
}

/**
 * A observação de CADA entrega.
 *
 * O texto que a pessoa digitou (remessas, boletos) vai inteiro em todas: cada
 * entrega é um formulário completo. As linhas de cor ("0015 3M azul") não
 * podem ir inteiras — elas trazem QUANTIDADE, e "6M azul" em três entregas de
 * 2 peças mandaria a separação errar. Cada linha é repartida seguindo a
 * distribuição do tamanho dela, na ordem das entregas: a entrega 1 leva o que
 * cabe nela, a 2 o que cabe nela, e assim por diante.
 *
 * Linha que não dá para ler (tamanho com espaço, peça que não está mais no
 * pedido) vai como veio para cada entrega que tem a referência — melhor a cor
 * repetida do que a cor perdida. Devolve `null` para a entrega sem observação.
 */
export function repartirObservacao(
  notes: string | null | undefined,
  itens: readonly ItemComReferencia[],
  entregas: ReadonlyArray<readonly ParteDoItem[]>,
): Array<string | null> {
  const n = entregas.length;
  const texto = notes ?? '';
  if (!texto.trim()) return entregas.map(() => null);

  const skus = new Set(itens.map((i) => i.sku).filter((s): s is string => !!s));
  const livre = semLinhasDeCor(texto, skus);
  const linhasDeCor = apenasLinhasDeCor(texto, skus)
    .split('\n')
    .filter((l) => l.trim());

  const itemPorId = new Map(itens.map((i) => [i.id, i]));
  /** (sku|tamanho) → quanto cabe em cada entrega. */
  const cabe = new Map<string, number[]>();
  const tamanhosDoSku = new Map<string, Set<string>>();
  const entregasComOSku = new Map<string, boolean[]>();
  entregas.forEach((partes, e) => {
    for (const parte of partes) {
      const item = itemPorId.get(parte.item_id);
      if (!item?.sku) continue;
      const size = item.size ?? '';
      const chave = `${item.sku}|${size}`;
      const lista = cabe.get(chave) ?? new Array<number>(n).fill(0);
      lista[e] = (lista[e] ?? 0) + parte.quantity;
      cabe.set(chave, lista);
      if (size) tamanhosDoSku.set(item.sku, (tamanhosDoSku.get(item.sku) ?? new Set<string>()).add(size));
      const tem = entregasComOSku.get(item.sku) ?? new Array<boolean>(n).fill(false);
      tem[e] = true;
      entregasComOSku.set(item.sku, tem);
    }
  });

  const cores: CorNaEntrega[][] = entregas.map(() => []);
  const somar = (e: number, sku: string, size: string, cor: string, quantidade: number) => {
    const lista = cores[e]!;
    const igual = lista.find((c) => c.sku === sku && c.size === size && c.cor === cor);
    if (igual) igual.quantidade = (igual.quantidade ?? 0) + quantidade;
    else lista.push({ sku, size, cor, quantidade });
  };
  const inteira = (sku: string, linha: string) => {
    const tem = entregasComOSku.get(sku);
    const destinos = tem ? tem.flatMap((v, e) => (v ? [e] : [])) : [];
    for (const e of destinos.length > 0 ? destinos : [0]) cores[e]!.push({ crua: linha.trim() });
  };

  for (const linha of linhasDeCor) {
    const [sku = '', qtdTam = '', ...resto] = linha.trim().split(/\s+/);
    const cor = resto.join(' ');
    const lido = lerQuantidadeETamanho(qtdTam, tamanhosDoSku.get(sku));
    const capacidade = lido ? cabe.get(`${sku}|${lido.size}`) : undefined;
    if (!lido || !capacidade) {
      inteira(sku, linha);
      continue;
    }
    let falta = lido.quantidade;
    for (let e = 0; e < n && falta > 0; e++) {
      const leva = Math.min(falta, capacidade[e] ?? 0);
      if (leva <= 0) continue;
      somar(e, sku, lido.size, cor, leva);
      capacidade[e] = (capacidade[e] ?? 0) - leva;
      falta -= leva;
    }
    // A anotação dizia mais peças do que o item tem (o pedido encolheu depois):
    // o excedente fica na primeira entrega que tem a referência, para não sumir.
    if (falta > 0) {
      const tem = entregasComOSku.get(sku);
      const primeira = tem ? tem.indexOf(true) : -1;
      somar(primeira >= 0 ? primeira : 0, sku, lido.size, cor, falta);
    }
  }

  return cores.map((lista) => {
    const linhas = lista
      .map((c) => c.crua ?? `${c.sku ?? ''} ${c.quantidade ?? 0}${c.size ?? ''} ${c.cor ?? ''}`.trimEnd())
      .join('\n');
    return juntarObservacao(livre, linhas) ?? null;
  });
}
