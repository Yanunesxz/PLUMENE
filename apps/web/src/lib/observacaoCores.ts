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

  return [...somado.values()]
    .map(({ linha: l, total }) => {
      const nome = l.color_name && l.color_name !== l.color_code ? ` ${l.color_name}` : '';
      return `${l.sku} ${total}${l.size} ${l.color_code}${nome}`;
    })
    .join('\n');
}

/** Junta a observação digitada com as cores, sem perder o que a pessoa escreveu. */
export function juntarObservacao(digitada: string | undefined, cores: string): string | undefined {
  const texto = (digitada ?? '').trim();
  if (!cores) return texto || undefined;
  return texto ? `${texto}\n\n${cores}` : cores;
}
