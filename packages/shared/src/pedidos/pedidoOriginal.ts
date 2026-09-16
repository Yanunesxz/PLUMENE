import type { ItemDaNota, NotaDoPedido, Order, OrderItem } from '../types/order.js';
import { codigoMiolo } from '../cadastro/codigoErp.js';

/**
 * O PEDIDO ORIGINAL × COMO ELE FOI FATURADO (migração 044).
 *
 * "Hoje o pedido original vem montado mas depois que a gente fatura pode tirar
 * algumas peças que não temos e o pedido vem com menos" (Yan, 11/09/2026).
 *
 * A comparação mora aqui, em `shared`, porque a mesma conta serve à tela do
 * pedido e a qualquer relatório que venha depois — e porque ela é pura: entram
 * duas listas de peças, sai o que mudou entre elas.
 */

/**
 * Uma peça na foto: com a referência e o tamanho resolvidos.
 *
 * `product.erp_id` é o código do produto NO CONTROL — é ele que volta nos itens
 * da nota. Hoje o catálogo entra com `erp_id` igual ao `sku`, mas produto
 * cadastrado à mão pode ter os dois diferentes, e aí só o `erp_id` casa. Fotos
 * antigas (044) não têm o campo: por isso é opcional.
 */
export interface ItemDaFoto extends OrderItem {
  product?: { sku: string; name: string; erp_id?: string | null } | null;
  variant?: { size: string } | null;
}

export interface PedidoOriginal {
  order_id: string;
  /** O total na hora da foto. */
  total: number | null;
  /** Quantas peças o pedido tinha na hora da foto. */
  pecas: number;
  /** O que provocou a foto: alguém trocou as peças, ou veio o carimbo. */
  motivo: 'edicao' | 'faturamento';
  guardado_em: string;
  snapshot: Order & { items: ItemDaFoto[] };
}

/** Uma referência+tamanho que mudou entre o original e o pedido de hoje. */
export interface LinhaDaDiferenca {
  chave: string;
  /** Referência do Control (SKU). Vazio quando a foto é de um banco antigo. */
  ref: string;
  nome: string;
  tamanho: string | null;
  /** Quantas peças tinham no original. */
  antes: number;
  /** Quantas restaram. 0 = a referência saiu inteira. */
  depois: number;
  unit_price: number;
  /** O que essa linha deixou de faturar (negativo quando ENTROU peça). */
  valor: number;
}

export interface DiferencaDoPedido {
  linhas: LinhaDaDiferenca[];
  pecasAntes: number;
  pecasDepois: number;
  /** Soma do que saiu menos o que entrou, A PREÇO ORIGINAL. Positivo = o pedido encolheu. */
  valorQueSaiu: number;
  /**
   * Quanto o total mudou só por TROCA DE PREÇO das peças que ficaram: ao
   * editar, o servidor reprecifica todas as linhas pela tabela de hoje. Sem
   * separar isto do corte, a manchete "R$ X a menos" somava as duas coisas —
   * e um pedido que só ganhou peça aparecia como "saíram −2 peças". Positivo =
   * as peças ficaram mais caras que no original.
   */
  valorReprecificado: number;
  /** `false` quando nada mudou — a tela não mostra bloco nenhum. */
  mudou: boolean;
}

function chaveDoItem(i: ItemDaFoto): string {
  return `${i.product_id}|${i.variant_id ?? ''}`;
}

function somar(itens: ItemDaFoto[]): number {
  return itens.reduce((s, i) => s + Number(i.quantity ?? 0), 0);
}

/**
 * O que mudou entre a foto e o pedido de hoje, referência por referência.
 *
 * Peça que ENTROU também aparece (com `antes` menor que `depois`): o corte do
 * financeiro costuma ser só para menos, mas o gerente pode ter acrescentado
 * algo na fila dele — e um comparativo que só mostra metade da história é
 * pior do que nenhum.
 */
export function compararComOOriginal(
  original: ItemDaFoto[],
  atual: ItemDaFoto[],
): DiferencaDoPedido {
  const antes = new Map<string, ItemDaFoto>();
  for (const i of original) {
    const k = chaveDoItem(i);
    const acumulado = antes.get(k);
    antes.set(k, acumulado ? { ...acumulado, quantity: acumulado.quantity + i.quantity } : i);
  }
  const depois = new Map<string, ItemDaFoto>();
  for (const i of atual) {
    const k = chaveDoItem(i);
    const acumulado = depois.get(k);
    depois.set(k, acumulado ? { ...acumulado, quantity: acumulado.quantity + i.quantity } : i);
  }

  const linhas: LinhaDaDiferenca[] = [];
  for (const chave of new Set([...antes.keys(), ...depois.keys()])) {
    const a = antes.get(chave);
    const d = depois.get(chave);
    const qtdAntes = a?.quantity ?? 0;
    const qtdDepois = d?.quantity ?? 0;
    if (qtdAntes === qtdDepois) continue;
    const referencia = a ?? d!;
    const unit_price = Number(a?.unit_price ?? d?.unit_price ?? 0);
    linhas.push({
      chave,
      ref: referencia.product?.sku ?? '',
      nome: referencia.product?.name ?? '',
      tamanho: referencia.variant?.size ?? null,
      antes: qtdAntes,
      depois: qtdDepois,
      unit_price,
      valor: Number(((qtdAntes - qtdDepois) * unit_price).toFixed(2)),
    });
  }

  // O que mais saiu primeiro: é a linha que explica o pedido ter encolhido.
  linhas.sort((x, y) => y.valor - x.valor || x.ref.localeCompare(y.ref));

  // A troca de preço das peças que continuam no pedido: só entre linhas que
  // existem nos dois lados, pela quantidade de HOJE. É o que sobra do total
  // depois de tirar o corte — e não pode ser vendido como corte.
  let valorReprecificado = 0;
  for (const [chave, d] of depois) {
    const a = antes.get(chave);
    if (!a) continue;
    const precoAntes = Number(a.unit_price ?? 0);
    const precoDepois = Number(d.unit_price ?? 0);
    if (precoAntes !== precoDepois) valorReprecificado += (precoDepois - precoAntes) * d.quantity;
  }

  const pecasAntes = somar(original);
  const pecasDepois = somar(atual);
  return {
    linhas,
    pecasAntes,
    pecasDepois,
    valorQueSaiu: Number(linhas.reduce((s, l) => s + l.valor, 0).toFixed(2)),
    valorReprecificado: Number(valorReprecificado.toFixed(2)),
    mudou: linhas.length > 0,
  };
}

// ─── O que as NOTAS levaram (migração 048) ───────────────────────────────────
//
// Até a 048, o "Faturado" do cartão era o pedido como está no app. Só que o
// corte de estoque acontece DENTRO do Control, na hora da nota: os itens do app
// não mudam e o cartão afirmava "nenhuma peça foi cortada" sem saber. Quando o
// Control manda os itens de cada nota, a coluna "Faturado" passa a ser o que as
// notas ativas levaram — e o corte aparece peça por peça.

/** As peças das notas que valem: nota cancelada não conta. */
export function itensDasNotasAtivas(notas: NotaDoPedido[] | null | undefined): ItemDaNota[] {
  return (notas ?? []).filter((n) => !n.cancelada_em).flatMap((n) => n.itens ?? []);
}

/**
 * Soma do valor das notas ativas. `null` quando nenhuma nota ativa tem valor —
 * "o Control não disse" não é zero.
 */
export function valorDasNotasAtivas(notas: NotaDoPedido[] | null | undefined): number | null {
  const comValor = (notas ?? []).filter((n) => !n.cancelada_em && n.valor != null);
  if (comValor.length === 0) return null;
  return Number(comValor.reduce((s, n) => s + Number(n.valor), 0).toFixed(2));
}

function tamanhoNormal(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

/** Produto + tamanho, na grafia que casa o código do Control com a referência do app. */
function parProdutoTamanho(produto: unknown, tamanho: unknown): string | null {
  const miolo = codigoMiolo(produto);
  const t = tamanhoNormal(tamanho);
  return miolo && t ? `${miolo}|${t}` : null;
}

interface LinhaAcumulada {
  ref: string;
  nome: string;
  tamanho: string | null;
  quantidade: number;
  unit_price: number;
}

/**
 * O original × o que as notas ativas levaram, referência por referência.
 *
 * Cada item da nota procura a sua linha no original primeiro pela VARIANTE
 * (quando o app achou a variante do item) e depois pelo par produto/tamanho —
 * o código do Control casado pelo miolo com a referência da foto ("124" e
 * "0124" são a mesma), tanto com o `sku` quanto com o `erp_id` do produto. O
 * que a nota levou e o original não tinha entra como peça que ENTROU, com o
 * código que o Control mandou.
 *
 * `valorReprecificado` compara o preço da nota com o do original nas peças que
 * ficaram; item de nota sem `preco_unitario` não conta como troca de preço.
 */
export function compararOriginalComNotas(
  original: ItemDaFoto[],
  itensFaturados: ItemDaNota[],
): DiferencaDoPedido {
  const antes = new Map<string, LinhaAcumulada>();
  const porVariante = new Map<string, string>();
  const porPar = new Map<string, string>();
  for (const i of original) {
    const chave = chaveDoItem(i);
    const acumulado = antes.get(chave);
    if (acumulado) {
      acumulado.quantidade += Number(i.quantity ?? 0);
    } else {
      antes.set(chave, {
        ref: i.product?.sku ?? '',
        nome: i.product?.name ?? '',
        tamanho: i.variant?.size ?? null,
        quantidade: Number(i.quantity ?? 0),
        unit_price: Number(i.unit_price ?? 0),
      });
    }
    if (i.variant_id && !porVariante.has(i.variant_id)) porVariante.set(i.variant_id, chave);
    // As DUAS grafias da referência: o `sku` do app e o `erp_id` do Control. O
    // item da nota vem com o código do Control, e os dois só coincidem porque
    // as cargas de catálogo gravam um igual ao outro — produto cadastrado à mão
    // pode divergir, e aí casar só pelo `sku` inventaria um corte que não houve.
    for (const codigo of [i.product?.sku, i.product?.erp_id]) {
      const par = parProdutoTamanho(codigo, i.variant?.size);
      if (par && !porPar.has(par)) porPar.set(par, chave);
    }
  }

  const depois = new Map<string, LinhaAcumulada>();
  let valorReprecificado = 0;
  for (const item of itensFaturados) {
    const quantidade = Number(item.quantidade ?? 0);
    const par = parProdutoTamanho(item.produto, item.tamanho);
    const casada =
      (item.variant_id ? porVariante.get(item.variant_id) : undefined) ?? (par ? porPar.get(par) : undefined);
    const chave = casada ?? `nota|${par ?? `${String(item.produto)}|${String(item.tamanho)}`}`;
    const doOriginal = casada ? antes.get(casada) : undefined;

    const acumulado = depois.get(chave);
    if (acumulado) {
      acumulado.quantidade += quantidade;
    } else {
      depois.set(chave, {
        ref: doOriginal?.ref || String(item.produto ?? ''),
        nome: doOriginal?.nome ?? '',
        tamanho: doOriginal?.tamanho ?? (tamanhoNormal(item.tamanho) || null),
        quantidade,
        unit_price: Number(item.preco_unitario ?? doOriginal?.unit_price ?? 0),
      });
    }
    if (doOriginal && item.preco_unitario != null) {
      valorReprecificado += (Number(item.preco_unitario) - doOriginal.unit_price) * quantidade;
    }
  }

  const linhas: LinhaDaDiferenca[] = [];
  for (const chave of new Set([...antes.keys(), ...depois.keys()])) {
    const a = antes.get(chave);
    const d = depois.get(chave);
    const qtdAntes = a?.quantidade ?? 0;
    const qtdDepois = d?.quantidade ?? 0;
    if (qtdAntes === qtdDepois) continue;
    const referencia = a ?? d;
    if (!referencia) continue;
    // O corte vale o preço do ORIGINAL (o que o lojista deixou de receber);
    // peça que só a nota tem vale o preço da nota.
    const unit_price = a ? a.unit_price : referencia.unit_price;
    linhas.push({
      chave,
      ref: referencia.ref,
      nome: referencia.nome,
      tamanho: referencia.tamanho,
      antes: qtdAntes,
      depois: qtdDepois,
      unit_price,
      valor: Number(((qtdAntes - qtdDepois) * unit_price).toFixed(2)),
    });
  }
  linhas.sort((x, y) => y.valor - x.valor || x.ref.localeCompare(y.ref));

  const pecasAntes = somar(original);
  const pecasDepois = itensFaturados.reduce((s, i) => s + Number(i.quantidade ?? 0), 0);
  return {
    linhas,
    pecasAntes,
    pecasDepois,
    valorQueSaiu: Number(linhas.reduce((s, l) => s + l.valor, 0).toFixed(2)),
    valorReprecificado: Number(valorReprecificado.toFixed(2)),
    mudou: linhas.length > 0,
  };
}

/** Como o cartão "Pedido original" deve ler um pedido. */
export interface LeituraDoFaturamento {
  diferenca: DiferencaDoPedido;
  /**
   * De onde vem a coluna da direita: dos itens das notas ativas (o que o
   * Control faturou) ou das peças do pedido no app.
   */
  fonte: 'notas' | 'pedido';
  /** O título da coluna da direita. */
  rotuloDaDireita: 'Faturado' | 'Hoje' | 'Pedido no app' | 'Faturado até agora';
  /** O valor que a coluna da direita mostra. */
  valorDaDireita: number | null;
  /** O valor que a nota fechou: `invoiced_total` ou a soma das notas ativas. */
  valorDaNota: number | null;
  /** Pedido de hoje menos a nota. Positivo = a nota fechou abaixo. */
  diferencaDaNota: number | null;
  reprecificou: boolean;
  notaDiferente: boolean;
  /**
   * Faturado sem itens de nota e sem valor da nota: o app NÃO sabe o que o
   * Control cortou. Nesse caso o cartão nunca diz que nada foi cortado.
   */
  semDetalheDoControl: boolean;
  /**
   * As notas que chegaram levaram MENOS peças que o original e o Control ainda
   * não fechou o valor do pedido (`invoiced_total` vazio). Um pedido pode sair
   * em mais de uma nota: até o fechamento, a diferença é "o resto ainda não
   * veio", não "foi cortado".
   */
  faturamentoParcial: boolean;
  /** Quantas peças as notas ativas já levaram (só quando a fonte é `notas`). */
  pecasFaturadas: number | null;
  /** `false` = nada a comparar, o cartão não aparece. */
  mostrar: boolean;
  /**
   * A frase principal:
   *   mudou       → o que saiu, entrou, mudou de preço, ou a nota diferente;
   *   igual       → faturado igual ao original (há nota para dizer isso);
   *   parcial     → as notas de até agora levaram parte das peças;
   *   sem_detalhe → o detalhe do faturamento ainda não chegou do Control.
   */
  situacao: 'mudou' | 'igual' | 'parcial' | 'sem_detalhe';
}

/**
 * A leitura inteira do cartão, pura, para a tela e os testes usarem a mesma
 * conta.
 */
export function lerFaturamentoDoPedido(entrada: {
  original: ItemDaFoto[];
  itensAtuais: ItemDaFoto[];
  totalAtual: number | null;
  invoicedTotal?: number | null | undefined;
  faturado: boolean;
  notas?: NotaDoPedido[] | null | undefined;
}): LeituraDoFaturamento {
  const { original, itensAtuais, totalAtual, faturado } = entrada;
  const itensDasNotas = faturado ? itensDasNotasAtivas(entrada.notas) : [];
  const fonte: LeituraDoFaturamento['fonte'] = itensDasNotas.length > 0 ? 'notas' : 'pedido';

  const diferenca =
    fonte === 'notas'
      ? compararOriginalComNotas(original, itensDasNotas)
      : compararComOOriginal(original, itensAtuais);

  const valorDaNota = faturado ? (entrada.invoicedTotal ?? valorDasNotasAtivas(entrada.notas)) : null;

  // FATURAMENTO EM PARTES. Um pedido pode sair em mais de uma nota (é um
  // registro por nota, e a segunda pode chegar no dia seguinte). Enquanto as
  // notas somam MENOS peças que o original e o Control não fechou o valor do
  // pedido (`invoiced_total` vazio), a diferença é "o resto ainda não veio" —
  // e o cartão não pode anunciar um corte que talvez não tenha havido.
  const faturamentoParcial =
    fonte === 'notas' && entrada.invoicedTotal == null && diferenca.pecasDepois < diferenca.pecasAntes;

  const diferencaDaNota =
    faturado && !faturamentoParcial && valorDaNota != null && totalAtual != null
      ? Number((totalAtual - valorDaNota).toFixed(2))
      : null;
  const notaDiferente = diferencaDaNota != null && Math.abs(diferencaDaNota) >= 0.01;
  const reprecificou = Math.abs(diferenca.valorReprecificado) >= 0.01;
  const semDetalheDoControl = faturado && fonte === 'pedido' && valorDaNota == null;

  const situacao: LeituraDoFaturamento['situacao'] = faturamentoParcial
    ? 'parcial'
    : diferenca.mudou || reprecificou || notaDiferente
      ? 'mudou'
      : semDetalheDoControl
        ? 'sem_detalhe'
        : 'igual';

  return {
    diferenca,
    fonte,
    rotuloDaDireita: !faturado
      ? 'Hoje'
      : faturamentoParcial
        ? 'Faturado até agora'
        : semDetalheDoControl
          ? 'Pedido no app'
          : 'Faturado',
    valorDaDireita: valorDaNota ?? totalAtual ?? null,
    valorDaNota,
    diferencaDaNota,
    reprecificou,
    notaDiferente,
    semDetalheDoControl,
    faturamentoParcial,
    pecasFaturadas: fonte === 'notas' ? diferenca.pecasDepois : null,
    mostrar: diferenca.mudou || reprecificou || notaDiferente || faturado,
    situacao,
  };
}
