/**
 * Observação automática com as cores escolhidas.
 *
 * O ERP da Corpo Sensual só trabalha com SORTIDO: o item do pedido vai
 * agregado por (produto × tamanho), e a coluna COR do Firebird recebe sempre
 * '00001'. A cor que o lojista escolheu existe só aqui — então ela viaja na
 * observação, no formato que a fábrica lê na separação:
 *
 *   0015 3M 02 azul
 *   0015 2G 01 rosa
 *
 * Peça sem cor cadastrada não gera linha: escrever "0015 3M" sozinho não
 * informa nada que o item do pedido já não diga.
 */

export interface LinhaComCor {
  sku: string;
  size: string;
  /** A vitrine chama de `quantidade`; o carrinho do app, de `quantity`. */
  quantidade?: number | undefined;
  quantity?: number | undefined;
  color_code?: string | null | undefined;
  color_name?: string | null | undefined;
}

export function observacaoDeCores(linhas: LinhaComCor[]): string {
  // Junta o que for da mesma (peça, tamanho, cor): o lojista pode ter voltado
  // na mesma cor duas vezes, e "3M azul" duas vezes confunde quem separa.
  const qtd = (l: LinhaComCor) => l.quantidade ?? l.quantity ?? 0;

  const somado = new Map<string, { linha: LinhaComCor; total: number }>();
  for (const l of linhas) {
    if (!l.color_code) continue;
    const k = `${l.sku}|${l.size}|${l.color_code}`;
    const atual = somado.get(k);
    if (atual) atual.total += qtd(l);
    else somado.set(k, { linha: l, total: qtd(l) });
  }

  // Só o nome, sem o número da bolinha: o Yan pediu que o número não apareça
  // em lugar nenhum, nem aqui.
  return [...somado.values()]
    .map(({ linha: l, total }) => `${l.sku} ${total}${l.size} ${l.color_name ?? ''}`.trimEnd())
    .join('\n');
}

/** Junta a observação digitada com as cores, sem perder o que a pessoa escreveu. */
export function juntarObservacao(digitada: string | undefined, cores: string): string | undefined {
  const texto = (digitada ?? '').trim();
  if (!cores) return texto || undefined;
  return texto ? `${texto}\n\n${cores}` : cores;
}

/**
 * O inverso da `observacaoDeCores`: tira do texto as linhas de cor que ela
 * gerou, deixando só o que o representante DIGITOU.
 *
 * Existe por causa da planilha do Control: desde 14/08/2026 a cor sai na
 * coluna OBSERVAÇÃO de cada linha do formulário, e o bloco geral do rodapé
 * fica para os recados do rep (remessas, boletos). Sem esta limpeza a cor
 * sairia dobrada — na linha e no rodapé.
 *
 * Uma linha é "de cor" quando começa com um SKU do pedido seguido de
 * quantidade+tamanho ("0015 3M azul") — o formato exato que
 * `observacaoDeCores` escreve. Texto do rep que apenas MENCIONA uma
 * referência no meio da frase não casa com esse formato e fica.
 *
 * `skusDoPedido = null` aceita qualquer token com cara de referência (3–4
 * dígitos): é para quem só tem o pedido SEM os itens em mãos, como o cartão
 * de decisão da triagem. Um pouco mais permissivo, mas a linha ainda precisa
 * do formato completo "ref qtd+tamanho texto" para ser tirada.
 */
export function semLinhasDeCor(
  texto: string | null | undefined,
  skusDoPedido: ReadonlySet<string> | null,
): string {
  if (!texto) return '';
  const ehRef = (sku: string) =>
    skusDoPedido ? skusDoPedido.has(sku) : /^\d{3,4}$/.test(sku);
  return texto
    .split('\n')
    .filter((linha) => {
      const [sku, qtdTam, ...resto] = linha.trim().split(/\s+/);
      // No modo genérico a linha precisa do texto da cor no fim — com o
      // conjunto de SKUs em mãos, o critério é o MESMO de sempre (planilha).
      const formatoOk = skusDoPedido ? true : resto.length > 0;
      return !(sku && qtdTam && formatoOk && ehRef(sku) && /^\d+\S*$/.test(qtdTam));
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Lê de volta as cores que `observacaoDeCores` escreveu nas notas do pedido e
 * resume UMA observação por referência, para a coluna B da planilha.
 *
 * Por que ler das notas: nas peças com as bolinhas de cor do catálogo, a cor
 * escolhida NÃO muda o produto — o item do pedido vai sortido e a escolha só
 * existe nessas linhas de texto. É a única memória que o pedido guarda dela
 * (o ERP recebe tudo como sortido, ver o topo deste arquivo).
 *
 * Uma cor só → o nome dela ("azul"). Cores diferentes por tamanho → o detalhe
 * inteiro ("3M azul / 2G rosa"), porque é isso que a separação precisa saber.
 */
export function coresPorSku(
  texto: string | null | undefined,
  skusDoPedido: ReadonlySet<string>,
): Map<string, string> {
  const porSku = new Map<string, Array<{ qtdTam: string; cor: string }>>();
  for (const linha of (texto ?? '').split('\n')) {
    const [sku, qtdTam, ...resto] = linha.trim().split(/\s+/);
    if (!sku || !qtdTam || !skusDoPedido.has(sku)) continue;
    if (!/^\d+\S*$/.test(qtdTam) || resto.length === 0) continue;
    const lista = porSku.get(sku) ?? [];
    lista.push({ qtdTam, cor: resto.join(' ') });
    porSku.set(sku, lista);
  }

  const resumo = new Map<string, string>();
  for (const [sku, linhas] of porSku) {
    const cores = [...new Set(linhas.map((l) => l.cor))];
    resumo.set(
      sku,
      cores.length === 1
        ? cores[0]!
        : linhas.map((l) => `${l.qtdTam} ${l.cor}`).join(' / '),
    );
  }
  return resumo;
}
