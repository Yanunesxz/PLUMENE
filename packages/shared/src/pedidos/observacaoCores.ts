/**
 * Observação automática com as cores escolhidas.
 *
 * O ERP da Corpo Sensual só trabalha com SORTIDO: o item do pedido vai
 * agregado por (produto × tamanho), e a coluna COR do Firebird recebe sempre
 * '00001'. A cor que o lojista escolheu existe só aqui — então ela viaja nas
 * notas do pedido, uma linha por peça/tamanho, com o NOME da cor:
 *
 *   0015 3M azul
 *   0015 2G rosa
 *
 * Peça sem cor cadastrada não gera linha: escrever "0015 3M" sozinho não
 * informa nada que o item do pedido já não diga.
 *
 * NOME no app, NÚMERO no Control (22/09/2026). O Yan, com os prints do
 * catálogo: no app a cor aparece pelo nome ("CORES / ESTAMPAS: PINK") — "está
 * ótimo", continua assim; mas "na hora de subir pro Control tem que ser Cor 1,
 * Cor 2, do jeito que está no catálogo" — é o número da bolinha que o pessoal
 * do estoque confere no catálogo impresso. Então as notas continuam gravando
 * o nome (pedido antigo e novo no mesmo formato) e só o que SAI para o Control
 * (planilha oficial e API de Parceiro) troca o nome pelo número, na leitura —
 * ver `coresPorSkuParaOControl`, no fim deste arquivo.
 */

import type { CatalogColor } from '../types/product.js';

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
  // em lugar nenhum, nem aqui. Desde 22/09/2026 isso vale para o APP — o que
  // vai para o Control sai com o número ("Cor 2"), traduzido na leitura por
  // `coresPorSkuParaOControl`. As notas continuam só com o nome.
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
  return texto
    .split('\n')
    .filter((linha) => !ehLinhaDeCor(linha, skusDoPedido))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** O critério único de "linha de cor" — o formato exato que `observacaoDeCores` escreve. */
function ehLinhaDeCor(linha: string, skusDoPedido: ReadonlySet<string> | null): boolean {
  const [sku, qtdTam, ...resto] = linha.trim().split(/\s+/);
  const ehRef = (s: string) => (skusDoPedido ? skusDoPedido.has(s) : /^\d{3,4}$/.test(s));
  // No modo genérico a linha precisa do texto da cor no fim — com o
  // conjunto de SKUs em mãos, o critério é o MESMO de sempre (planilha).
  const formatoOk = skusDoPedido ? true : resto.length > 0;
  return !!(sku && qtdTam && formatoOk && ehRef(sku) && /^\d+\S*$/.test(qtdTam));
}

/**
 * O complemento de `semLinhasDeCor`: SÓ as linhas de cor.
 *
 * É o que sobrevive quando alguém edita a observação do pedido depois de
 * criado: o texto livre é trocado, as cores escolhidas no catálogo ficam —
 * elas são a única memória que o pedido guarda da cor (ver o topo).
 */
export function apenasLinhasDeCor(
  texto: string | null | undefined,
  skusDoPedido: ReadonlySet<string> | null,
): string {
  if (!texto) return '';
  return texto
    .split('\n')
    .filter((linha) => ehLinhaDeCor(linha, skusDoPedido))
    .join('\n')
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
  return resumirPorSku(linhasDeCorPorSku(texto, skusDoPedido), (_sku, nome) => nome);
}

/** As linhas de cor das notas, por referência: "0015 3M azul" → 0015 → [{ 3M, azul }]. */
function linhasDeCorPorSku(
  texto: string | null | undefined,
  skusDoPedido: ReadonlySet<string>,
): Map<string, Array<{ qtdTam: string; cor: string }>> {
  const porSku = new Map<string, Array<{ qtdTam: string; cor: string }>>();
  for (const linha of (texto ?? '').split('\n')) {
    const [sku, qtdTam, ...resto] = linha.trim().split(/\s+/);
    if (!sku || !qtdTam || !skusDoPedido.has(sku)) continue;
    if (!/^\d+\S*$/.test(qtdTam) || resto.length === 0) continue;
    const lista = porSku.get(sku) ?? [];
    lista.push({ qtdTam, cor: resto.join(' ') });
    porSku.set(sku, lista);
  }
  return porSku;
}

/**
 * UMA observação por referência. `rotulo` decide como cada cor é escrita —
 * o nome (app) ou o número do catálogo (Control); o resumo é o mesmo nos dois.
 *
 * Uma cor só → ela sozinha ("azul" / "Cor 2"). Cores diferentes por tamanho →
 * o detalhe inteiro ("3M azul / 2G rosa" / "3M Cor 2 / 2G Cor 1"), porque é
 * isso que a separação precisa saber.
 */
function resumirPorSku(
  porSku: Map<string, Array<{ qtdTam: string; cor: string }>>,
  rotulo: (sku: string, nome: string) => string,
): Map<string, string> {
  const resumo = new Map<string, string>();
  for (const [sku, linhas] of porSku) {
    const escritas = linhas.map((l) => ({ qtdTam: l.qtdTam, cor: rotulo(sku, l.cor) }));
    const cores = [...new Set(escritas.map((l) => l.cor))];
    resumo.set(
      sku,
      cores.length === 1
        ? cores[0]!
        : escritas.map((l) => `${l.qtdTam} ${l.cor}`).join(' / '),
    );
  }
  return resumo;
}

// ─── A cor como o Control recebe: o número da bolinha do catálogo ────────────

/**
 * O recorte da ficha de cores da peça (`CatalogColor`, tabela product_colors)
 * que a tradução para o Control usa: o número da bolinha, o nome que o app
 * mostra e o selo VARIADAS.
 */
export type CorDaFicha = Pick<CatalogColor, 'codigo' | 'nome' | 'variadas'>;

/**
 * "Azul  Marinho" e "azul marinho" são a mesma cor; "Orquídea" e "orquidea"
 * também. Compara sem diferença de maiúscula, acento e espaço.
 */
function chaveDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Como a bolinha aparece no catálogo impresso — o rótulo que vai ao Control.
 *
 * "01" → "Cor 1", "10" → "Cor 10" (sem o zero à esquerda: é "Cor 1, Cor 2"
 * que o Yan pediu). A bolinha VARIADAS → "Variadas" (nunca "sortidas"), tenha
 * ela número ou não.
 *
 * A bolinha COR ÚNICA sem número → "Cor única". No banco ela é o código "VAR"
 * SEM o selo VARIADAS: quem grava product_colors é só o _tools/catalogo-cores,
 * e o extrair.py dá "VAR" à bolinha-selo (a que tem a palavra escrita DENTRO
 * dela, sem número embaixo); o selo é VARIADAS (`variadas` = true) ou ÚNICA
 * (`variadas` = false). Na CS (22/09/2026) são as 9 peças 0981, 0990, 1007,
 * 1008, 1009, 1020, 1021, 1023 e 1024: o catálogo imprime ÚNICA nelas, mas o
 * NOME no banco saiu "Cores variadas" por um erro do cores.mjs (o ramo da
 * bolinha-selo sozinha é testado antes do selo ÚNICA). O Control não recebe
 * esse nome errado: recebe "Cor única", o mesmo rótulo que o app já dá às
 * peças de uma cor só. (O nome no app só muda quando o Yan corrigir o
 * cores.mjs e rodar o sincronizar de novo.)
 *
 * `null` quando a bolinha não tem número de verdade (código vazio, "00",
 * lixo): quem chama fica com o nome — número não se inventa.
 */
export function rotuloDaBolinha(
  cor: Pick<CatalogColor, 'codigo' | 'variadas'> & { nome?: string | null },
): string | null {
  // Só a bolinha que é ESCOLHA numerada vira "Cor N". Cor única e cores
  // sortidas vão pelo NOME, como no app — Yan, 22/09/2026: "aí elas continuam
  // como nome sortido, as cores sortidas continuam com nome". Faz sentido para
  // quem separa: onde não há duas cores para escolher, o número não diz nada,
  // e "Variadas"/"Cor única" é o que está impresso no catálogo.
  if (cor.variadas) return null;
  if (ehCorUnica(cor.nome)) return null;
  const codigo = (cor.codigo ?? '').trim();
  if (!/^\d+$/.test(codigo)) return null;
  const numero = Number.parseInt(codigo, 10);
  return numero > 0 ? `Cor ${numero}` : null;
}

/** A bolinha de peça que só tem uma cor ("Cor única", "única"). */
function ehCorUnica(nome: string | null | undefined): boolean {
  const chave = chaveDoNome(nome ?? '');
  return chave === 'cor unica' || chave === 'unica' || chave === 'cor unico';
}

/**
 * Por que uma cor foi ao Control pelo NOME, e não pelo número da bolinha:
 *   • `sem_ficha`     — a peça não tem ficha de cores (ou ela não foi
 *                       carregada: o catálogo baixado veio sem ela);
 *   • `sem_casamento` — o nome da nota não bate com nenhuma bolinha da peça
 *                       (cor renomeada depois do pedido);
 *   • `ambigua`       — duas bolinhas da peça com o mesmo nome;
 *   • `sem_numero`    — a bolinha casou, mas não tem número de verdade;
 *   • `nome_do_catalogo` — NÃO é queda: a bolinha é sortida ("Variadas") ou de
 *                       cor única, e o catálogo mostra o nome, não um número
 *                       (22/09/2026). Quem avisa a pessoa ignora este motivo.
 */
export type MotivoDaCorPeloNome =
  | 'sem_ficha'
  | 'sem_casamento'
  | 'ambigua'
  | 'sem_numero'
  | 'nome_do_catalogo';

/** Uma cor das notas que foi ao Control pelo nome — para avisar quem sobe o pedido. */
export interface CorPeloNome {
  sku: string;
  nome: string;
  motivo: MotivoDaCorPeloNome;
}

function casarNaFicha(
  nome: string,
  ficha: readonly CorDaFicha[] | null | undefined,
): { rotulo: string } | { motivo: MotivoDaCorPeloNome } {
  const chave = chaveDoNome(nome);
  if (!ficha || ficha.length === 0) return { motivo: 'sem_ficha' };
  if (!chave) return { motivo: 'sem_casamento' };
  const casadas = ficha.filter((c) => c.nome != null && chaveDoNome(c.nome) === chave);
  if (casadas.length === 0) return { motivo: 'sem_casamento' };
  if (casadas.length > 1) return { motivo: 'ambigua' };
  const bolinha = casadas[0]!;
  const rotulo = rotuloDaBolinha(bolinha);
  if (rotulo) return { rotulo };
  // Sortida ou cor única: o nome É a resposta certa (22/09/2026) — não é queda,
  // então a planilha não avisa nada sobre estas.
  if (bolinha.variadas || ehCorUnica(bolinha.nome)) return { motivo: 'nome_do_catalogo' };
  return { motivo: 'sem_numero' };
}

/**
 * O nome gravado nas notas ("pink") → o rótulo do Control ("Cor 3"), pela
 * ficha de cores DAQUELA peça.
 *
 * Casa o nome da nota com o nome das bolinhas da peça, sem diferença de
 * maiúscula, acento e espaço. Cai no próprio NOME, como era antes de
 * 22/09/2026, sempre que não há um casamento único e numerado:
 *   • peça sem ficha de cores (ou ficha não carregada);
 *   • cor renomeada depois do pedido (o nome da nota não bate com nenhuma);
 *   • nome ambíguo — duas bolinhas da peça com o mesmo nome: escolher uma
 *     seria chutar o número, e número errado despacha a peça errada;
 *   • bolinha sem número (ver `rotuloDaBolinha`).
 * Nunca inventa número e nunca apaga a informação: no pior caso o Control
 * recebe o nome, que é o que recebia até aqui. Quem precisa AVISAR dessa
 * queda (a planilha) usa `coresSemNumeroParaOControl`.
 */
export function corParaOControl(
  nome: string,
  ficha: readonly CorDaFicha[] | null | undefined,
): string {
  const casamento = casarNaFicha(nome, ficha);
  return 'rotulo' in casamento ? casamento.rotulo : nome;
}

/**
 * O `coresPorSku` do CONTROL: a mesma leitura das notas e o mesmo resumo por
 * referência, com cada nome trocado pelo número da bolinha do catálogo —
 * "Cor 2", ou "3M Cor 2 / 2G Cor 1" quando os tamanhos têm cores diferentes.
 *
 * Pedido do Yan (22/09/2026): "na hora de subir pro Control tem que ser Cor 1,
 * Cor 2, do jeito que está no catálogo" — ajuda o pessoal do estoque, que
 * confere pelo número impresso na bolinha. No APP o nome continua (catálogo,
 * carrinho, detalhe do pedido, e-mail, página pública, vitrine): quem mostra
 * cor na tela usa `coresPorSku`, não esta. Isto atualiza a decisão antiga "o
 * número não aparece em lugar nenhum" (ver `observacaoDeCores`) só para o que
 * vai ao Control.
 *
 * `fichaPorSku`: referência (a mesma que está nas notas) → as bolinhas da
 * peça. Referência sem ficha, ou cor sem casamento único, sai com o nome —
 * ver `corParaOControl`.
 */
export function coresPorSkuParaOControl(
  texto: string | null | undefined,
  skusDoPedido: ReadonlySet<string>,
  fichaPorSku: ReadonlyMap<string, readonly CorDaFicha[]>,
): Map<string, string> {
  return resumirPorSku(linhasDeCorPorSku(texto, skusDoPedido), (sku, nome) =>
    corParaOControl(nome, fichaPorSku.get(sku)),
  );
}

/**
 * O avesso de `coresPorSkuParaOControl`: as cores que ela NÃO conseguiu
 * numerar e mandou pelo nome, uma vez por (referência, nome), com o motivo.
 *
 * A regra de cair no nome continua (nunca inventar número); isto só deixa a
 * queda VISÍVEL. A planilha oficial é feita no navegador, com as fichas do
 * catálogo em cache — e um catálogo baixado sem as fichas (um soluço do banco
 * na hora de baixar) mandaria o nome em todas as referências sem ninguém
 * perceber. A API de Parceiro não precisa disto: lá a leitura das fichas que
 * falha derruba a resposta (500) em vez de seguir sem elas.
 */
export function coresSemNumeroParaOControl(
  texto: string | null | undefined,
  skusDoPedido: ReadonlySet<string>,
  fichaPorSku: ReadonlyMap<string, readonly CorDaFicha[]>,
): CorPeloNome[] {
  const vistas = new Set<string>();
  const saida: CorPeloNome[] = [];
  for (const [sku, linhas] of linhasDeCorPorSku(texto, skusDoPedido)) {
    for (const { cor: nome } of linhas) {
      const casamento = casarNaFicha(nome, fichaPorSku.get(sku));
      if ('rotulo' in casamento || casamento.motivo === 'nome_do_catalogo') continue;
      const chave = `${sku}|${chaveDoNome(nome)}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      saida.push({ sku, nome, motivo: casamento.motivo });
    }
  }
  return saida;
}

// ─── A observação GERAL que vai ao Control ───────────────────────────────────

/**
 * Quantidade + tamanho do jeito que `observacaoDeCores` escreve: a quantidade
 * COLADA no tamanho — letras ("3M", "2GG", "1EG") ou os dois dígitos da grade
 * numerada ("304" = 3 no 04, "248" = 2 no 48). "2" sozinho não é: falta o
 * tamanho — é o "0015 2 peças" que o representante digita.
 */
const QTD_COM_TAMANHO = /^\d+[A-Za-z]+$|^\d{3,}$/;

/**
 * A cara de uma referência do catálogo: começa com dígito ("0015", "1036A").
 * "Ref." — o "Ref. 0848 mandar a cor Marrom…" que os representantes digitam —
 * não tem.
 */
const CARA_DE_REFERENCIA = /^\d[0-9A-Za-z-]{2,19}$/;

/** Uma linha de cor que ficou de fora da observação geral — para o aviso. */
export interface LinhaDeCorDeOutraPeca {
  sku: string;
  linha: string;
}

/**
 * A observação GERAL do pedido como vai ao Control — o rodapé da planilha
 * oficial e o `observacoes` da API de Parceiro: só o que o representante
 * DIGITOU (remessas, boletos…).
 *
 * Saem dela:
 *   1. as linhas de cor das peças que vão no pedido (`skusDoPedido`) — a cor
 *      delas já vai na linha/no item, pelo número da bolinha;
 *   2. as linhas de cor de peça que NÃO vai: a que saiu do pedido no "editar
 *      peças" da triagem (as notas guardam a linha dela — no banco da CS, em
 *      22/09/2026, 142 linhas em 4 pedidos, como "1036 3P Cor única" no
 *      #14628) e, na planilha, a que ficou de fora ("sem tamanho", "fora do
 *      catálogo baixado"). Deixá-las mandava ao estoque o NOME da cor de uma
 *      peça que nem está no pedido. Elas voltam em `linhasDeOutrasPecas`, para
 *      a planilha avisar o operador — nada some em silêncio.
 *
 * O item 2 reconhece a linha pelo FORMATO que o app escreve, sem precisar do
 * catálogo: referência (começa com dígito) + quantidade colada no tamanho +
 * o nome da cor. É mais estrito que o modo genérico de `semLinhasDeCor`, que
 * também tiraria o "0015 2 peças" digitado pelo representante — esse fica.
 * No banco da CS (22/09/2026) as 5.102 linhas de cor dos pedidos e as 142
 * órfãs têm esse formato, e nenhum recado de representante tem.
 */
export function observacaoGeralParaOControl(
  texto: string | null | undefined,
  skusDoPedido: ReadonlySet<string>,
): { texto: string; linhasDeOutrasPecas: LinhaDeCorDeOutraPeca[] } {
  const linhasDeOutrasPecas: LinhaDeCorDeOutraPeca[] = [];
  const ficam: string[] = [];
  for (const linha of (texto ?? '').split('\n')) {
    if (ehLinhaDeCor(linha, skusDoPedido)) continue;
    const [sku, qtdTam, ...resto] = linha.trim().split(/\s+/);
    if (
      sku &&
      qtdTam &&
      resto.length > 0 &&
      CARA_DE_REFERENCIA.test(sku) &&
      QTD_COM_TAMANHO.test(qtdTam)
    ) {
      linhasDeOutrasPecas.push({ sku, linha: linha.trim() });
      continue;
    }
    ficam.push(linha);
  }
  return {
    texto: ficam.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    linhasDeOutrasPecas,
  };
}
