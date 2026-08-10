import { unzipSync, zipSync } from 'fflate';
import type { LinhaDaPlanilha } from './linhas.js';

/**
 * Preenche o formulário oficial da fábrica sem tocar em mais nada dele.
 *
 * O Control só importa pedido no layout dessas planilhas, então o arquivo que
 * sai daqui tem de ser o arquivo original — a logo, as validações, a área de
 * impressão, a Plan2 com os preços, as fórmulas de UNIT e TOTAL, tudo. Por isso
 * não geramos planilha nenhuma: abrimos o .xlsx oficial como o zip que ele é,
 * reescrevemos as células da grade dentro de `xl/worksheets/sheet1.xml` e
 * fechamos o zip de volta. Todo o resto sai byte a byte como entrou.
 *
 * É também por isso que a biblioteca de planilha não aparece aqui. Ler com uma e
 * gravar de novo custaria a logo e parte da formatação — ela reescreve o arquivo
 * a partir do que entendeu, e o que ela não entende não volta.
 *
 * As células que preenchemos já existem no modelo (conferido nas três tabelas),
 * cada uma com o `s=` do estilo. Reescrevemos o conteúdo e preservamos o estilo:
 * é o que mantém a borda e o alinhamento da grade no lugar.
 */

/** Primeira e última linha da grade de itens. Fora daí começa o rodapé. */
const PRIMEIRA_LINHA = 13;

/** Onde o rodapé guarda os totais que o Excel calcularia sozinho. */
const CELULA_TOTAL_PECAS = 'Z45';
const CELULA_VALOR_PARCIAL = 'AB45';
const CELULA_DESCONTO = 'AB47';
const CELULA_TOTAL = 'AB48';
/**
 * O campo do número do pedido é AB2 — AA2 guarda o rótulo "Nª PED" e escrever
 * ali apagaria o texto impresso do formulário.
 */
const CELULA_NUMERO_DO_PEDIDO = 'AB2';

const PLANILHA_DO_PEDIDO = 'xl/worksheets/sheet1.xml';
const PLANILHA_DOS_PRECOS = 'xl/worksheets/sheet2.xml';
const TEXTOS = 'xl/sharedStrings.xml';

type Patch =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'numero'; valor: number }
  /** Mantém a fórmula onde está e troca só o valor que ela tem guardado. */
  | { tipo: 'cache'; valor: number };

const textoDecodificado = new TextDecoder();
const textoCodificado = new TextEncoder();

function escaparXml(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function desescaparXml(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * O Excel aceita "43.90" e "3". O que ele não aceita é notação científica, que é
 * onde `String(0.0000001)` iria parar.
 */
function numeroXml(valor: number): string {
  const arredondado = Math.round(valor * 100) / 100;
  return Number.isInteger(arredondado) ? String(arredondado) : arredondado.toFixed(2);
}

function semAtributo(atributos: string, nome: string): string {
  return atributos.replace(new RegExp(`\\s${nome}="[^"]*"`, 'g'), '');
}

/**
 * Reescreve só as células pedidas. As outras — e tudo que não é célula — voltam
 * exatamente como estavam.
 */
function aplicarPatches(xml: string, patches: Map<string, Patch>): string {
  return xml.replace(
    /<c\s+r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    (inteiro, referencia: string, atributos: string, interno: string | undefined) => {
      const patch = patches.get(referencia);
      if (!patch) return inteiro;

      // `t` diz o TIPO do valor; ele muda conforme o que estamos escrevendo, e o
      // modelo já traz `t="str"` nas células de fórmula (que hoje guardam "-").
      const base = semAtributo(atributos ?? '', 't');

      if (patch.tipo === 'texto') {
        return `<c r="${referencia}"${base} t="inlineStr"><is><t>${escaparXml(patch.valor)}</t></is></c>`;
      }
      if (patch.tipo === 'numero') {
        return `<c r="${referencia}"${base}><v>${numeroXml(patch.valor)}</v></c>`;
      }

      const formula = (interno ?? '').match(/<f[\s\S]*?(?:\/>|<\/f>)/)?.[0] ?? '';
      return `<c r="${referencia}"${base}>${formula}<v>${numeroXml(patch.valor)}</v></c>`;
    },
  );
}

function lerTextos(xml: string): string[] {
  return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((si) =>
    (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
      .map((t) => desescaparXml(t.replace(/<[^>]+>/g, '')))
      .join(''),
  );
}

/**
 * As referências que a Plan2 conhece. Se a referência do pedido não estiver
 * nesta lista, o VLOOKUP devolveria "-" e o pedido chegaria ao Control sem
 * preço — melhor avisar antes de o arquivo sair.
 */
function referenciasConhecidas(sheet2: string, textos: readonly string[]): Set<string> {
  const conhecidas = new Set<string>();
  for (const [, atributos = '', interno = ''] of sheet2.matchAll(
    /<c\s+r="A\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
  )) {
    const bruto = interno.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (bruto == null) continue;
    const valor = / t="s"/.test(atributos) ? (textos[Number(bruto)] ?? '') : bruto;
    conhecidas.add(desescaparXml(valor).trim().toUpperCase());
  }
  return conhecidas;
}

export interface FolhaPreenchida {
  arquivo: Uint8Array;
  /** Referências escritas que a Plan2 não reconhece — sairiam sem preço. */
  refsDesconhecidas: string[];
}

export interface DadosDaFolha {
  linhas: readonly LinhaDaPlanilha[];
  /** Vai na célula "Nº PED". Representante e cliente ficam em branco. */
  numeroDoPedido?: string | undefined;
}

/**
 * Recebe o .xlsx oficial e devolve o mesmo arquivo com a grade preenchida.
 */
export function preencherModelo(modelo: Uint8Array, dados: DadosDaFolha): FolhaPreenchida {
  const partes = unzipSync(modelo);

  const sheet1 = partes[PLANILHA_DO_PEDIDO];
  if (!sheet1) throw new Error('Modelo sem xl/worksheets/sheet1.xml — não é a planilha oficial.');

  const bytesDosTextos = partes[TEXTOS];
  const bytesDosPrecos = partes[PLANILHA_DOS_PRECOS];
  const textos = bytesDosTextos ? lerTextos(textoDecodificado.decode(bytesDosTextos)) : [];
  const conhecidas = bytesDosPrecos
    ? referenciasConhecidas(textoDecodificado.decode(bytesDosPrecos), textos)
    : null;

  const patches = new Map<string, Patch>();
  const refsDesconhecidas: string[] = [];
  let totalPecas = 0;
  let valorParcial = 0;

  dados.linhas.forEach((linha, indice) => {
    const numeroDaLinha = PRIMEIRA_LINHA + indice;
    // A referência entra como NÚMERO quando é numérica: na Plan2 ela está numa
    // célula numérica, e o VLOOKUP do Excel não casa texto com número — escrever
    // "130" como texto faria o UNIT virar "-".
    patches.set(
      `A${numeroDaLinha}`,
      /^\d+$/.test(linha.ref)
        ? { tipo: 'numero', valor: Number(linha.ref) }
        : { tipo: 'texto', valor: linha.ref },
    );

    for (const [coluna, quantidade] of Object.entries(linha.quantidades)) {
      patches.set(`${coluna}${numeroDaLinha}`, { tipo: 'numero', valor: quantidade });
    }

    // QUANT, UNIT e TOTAL continuam sendo fórmula: só o valor guardado muda, para
    // que o arquivo já chegue com o número certo a quem lê sem abrir o Excel.
    const total = linha.pecas * linha.unit_price;
    patches.set(`Z${numeroDaLinha}`, { tipo: 'cache', valor: linha.pecas });
    patches.set(`AA${numeroDaLinha}`, { tipo: 'cache', valor: linha.unit_price });
    patches.set(`AB${numeroDaLinha}`, { tipo: 'cache', valor: total });

    totalPecas += linha.pecas;
    valorParcial += total;

    if (conhecidas && !conhecidas.has(linha.ref)) refsDesconhecidas.push(linha.ref);
  });

  patches.set(CELULA_TOTAL_PECAS, { tipo: 'cache', valor: totalPecas });
  patches.set(CELULA_VALOR_PARCIAL, { tipo: 'cache', valor: valorParcial });
  // DESC % fica em branco no modelo, então o desconto é zero e o total fecha no
  // parcial. Quem quiser dar desconto digita na planilha e o Excel refaz a conta.
  patches.set(CELULA_DESCONTO, { tipo: 'cache', valor: 0 });
  patches.set(CELULA_TOTAL, { tipo: 'cache', valor: valorParcial });

  if (dados.numeroDoPedido) {
    patches.set(CELULA_NUMERO_DO_PEDIDO, { tipo: 'texto', valor: dados.numeroDoPedido });
  }

  const preenchida = aplicarPatches(textoDecodificado.decode(sheet1), patches);
  const saida: Record<string, Uint8Array> = { ...partes };
  saida[PLANILHA_DO_PEDIDO] = textoCodificado.encode(preenchida);

  return { arquivo: zipSync(saida), refsDesconhecidas };
}
