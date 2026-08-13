import { unzipSync, zipSync } from 'fflate';
import { nucleoDaRef } from './colunas.js';
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
/** A taxa que o formulário chama de "DESC %" — em FRAÇÃO (0,1 = 10%). */
const CELULA_DESCONTO_PERCENTUAL = 'AB46';
const CELULA_DESCONTO = 'AB47';
const CELULA_TOTAL = 'AB48';
/**
 * O campo do número do pedido é AB2 — AA2 guarda o rótulo "Nª PED" e escrever
 * ali apagaria o texto impresso do formulário.
 */
const CELULA_NUMERO_DO_PEDIDO = 'AB2';

/**
 * O cabeçalho do formulário, célula a célula. Cada rótulo impresso ("DATA :",
 * "RAZÃO SOCIAL:"…) tem ao lado uma área mesclada de valor — escrever é sempre
 * na PRIMEIRA célula da área mesclada, nunca no rótulo. Mapeado do modelo
 * oficial (linhas 2 a 8 do sheet1.xml, conferidas uma a uma):
 *
 *   B2  = DATA (mescla B2:E2)          N2 = Nome Fantasia (N2:Z2)
 *   C3  = RAZÃO SOCIAL (C3:AB3)        C4 = ENDEREÇO (C4:AB4)
 *   S6  = WhatsApp (S6:W6)             C7 = CNPJ/CPF (C7:L7)
 *   W7  = E-mail (W7:AB7)              C8 = COND PGTO (C8:M8)
 *
 * CIDADE, Bairro, UF, CEP, TEL, Contato e Inscrição Estadual ficam em branco:
 * o cadastro do app guarda o endereço como texto único (vai inteiro no
 * ENDEREÇO) e não tem esses campos separados — o Control completa pelo
 * cadastro dele quando importa.
 */
const CELULA_DATA = 'B2';
const CELULA_NOME_FANTASIA = 'N2';
const CELULA_RAZAO_SOCIAL = 'C3';
const CELULA_ENDERECO = 'C4';
const CELULA_WHATSAPP = 'S6';
const CELULA_CNPJ = 'C7';
const CELULA_EMAIL = 'W7';

/**
 * O bloco de observações do rodapé (mescla A45:V49) — é onde o formulário da
 * fábrica traz "PÁGINA 01." e os recados do pedido (remessas, boletos, cores).
 */
const CELULA_OBSERVACAO = 'A45';
/**
 * O valor do COND PGTO mora em C8 (mesclada C8:M8) — A8 é o rótulo, e escrever
 * nele apagaria o "COND PGTO" impresso. Conferido no modelo oficial: a linha 8
 * é "COND PGTO | FORMA PGTO | Data da Entrega", cada rótulo com sua área
 * mesclada de valor ao lado.
 */
const CELULA_COND_PGTO = 'C8';

const PLANILHA_DO_PEDIDO = 'xl/worksheets/sheet1.xml';
const PLANILHA_DOS_PRECOS = 'xl/worksheets/sheet2.xml';
const TEXTOS = 'xl/sharedStrings.xml';

type Patch =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'numero'; valor: number }
  /** Mantém a fórmula onde está e troca só o valor que ela tem guardado. */
  | { tipo: 'cache'; valor: number }
  /** Como `cache`, mas o valor é uma fração e precisa de casas decimais. */
  | { tipo: 'taxa'; valor: number };

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

/**
 * Uma TAXA, não um valor em reais.
 *
 * `numeroXml` arredonda para centavos, que é o certo para dinheiro e errado
 * para fração: numa taxa, duas casas são dois pontos percentuais inteiros, e
 * 7,5% (0,075) viraria 8%. A fábrica leria "DESC 8%" ao lado de um desconto de
 * R$ 75 em R$ 1.000 — dois números que se contradizem no mesmo rodapé.
 *
 * Seis casas cobrem centésimo de ponto percentual com folga, e o `Number()`
 * derruba os zeros à direita para não poluir a célula.
 */
function taxaXml(valor: number): string {
  return String(Number(valor.toFixed(6)));
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
      const escrito = patch.tipo === 'taxa' ? taxaXml(patch.valor) : numeroXml(patch.valor);
      return `<c r="${referencia}"${base}>${formula}<v>${escrito}</v></c>`;
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
 * As referências que a Plan2 conhece, guardadas pelo miolo (sem zeros à frente,
 * sem "E"). É preciso normalizar porque a Plan2 escreve a mesma peça de dois
 * jeitos — "130" e "0130E" — e nós escrevemos um terceiro, "0130".
 *
 * O que isto pega é a referência que a fábrica não tem em NENHUMA forma: essa
 * sim chegaria ao Control como produto inexistente.
 */
function referenciasConhecidas(sheet2: string, textos: readonly string[]): Set<string> {
  const conhecidas = new Set<string>();
  for (const [, atributos = '', interno = ''] of sheet2.matchAll(
    /<c\s+r="A\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
  )) {
    const bruto = interno.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (bruto == null) continue;
    const valor = / t="s"/.test(atributos) ? (textos[Number(bruto)] ?? '') : bruto;
    conhecidas.add(nucleoDaRef(desescaparXml(valor)));
  }
  return conhecidas;
}

export interface FolhaPreenchida {
  arquivo: Uint8Array;
  /** Referências escritas que a Plan2 não reconhece — sairiam sem preço. */
  refsDesconhecidas: string[];
}

/** O que o formulário mostra de quem comprou. Todo campo ausente fica em branco. */
export interface ClienteDaFolha {
  razaoSocial?: string | undefined;
  nomeFantasia?: string | undefined;
  endereco?: string | undefined;
  whatsapp?: string | undefined;
  cnpj?: string | undefined;
  email?: string | undefined;
}

export interface DadosDaFolha {
  linhas: readonly LinhaDaPlanilha[];
  /** Vai na célula "Nº PED". */
  numeroDoPedido?: string | undefined;
  /** A data do pedido, já formatada ("13/08/2026") — vai no DATA. */
  data?: string | undefined;
  /** O cabeçalho de quem comprou (razão social, CNPJ, endereço…). */
  cliente?: ClienteDaFolha | undefined;
  /**
   * A descrição da condição escolhida ("30/60/90 DIAS") — vai no COND PGTO.
   * Ausente = célula fica em branco e a fábrica preenche, como sempre foi.
   */
  condicaoDePagamento?: string | undefined;
  /**
   * Desconto do pedido inteiro, em PERCENTUAL (10 = 10%). Vai para o campo
   * DESC % do formulário, que a fábrica já tem. Ausente/zero = sem desconto.
   *
   * Em percentual e não em fração porque é assim que o resto do sistema fala —
   * a conversão para a fração que a planilha quer acontece aqui dentro, num
   * lugar só.
   */
  descontoPercentual?: number | undefined;
  /**
   * O bloco de observações do rodapé ("PÁGINA 01." + recados do pedido).
   * É onde as cores escolhidas e instruções de remessa chegam à fábrica.
   */
  observacao?: string | undefined;
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
    // Sempre TEXTO: a referência é "0130", e como número o zero da frente
    // sumiria. Ver refDaPlanilha sobre por que é essa a forma que o Control lê.
    patches.set(`A${numeroDaLinha}`, { tipo: 'texto', valor: linha.ref });

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

    if (conhecidas && !conhecidas.has(nucleoDaRef(linha.ref))) refsDesconhecidas.push(linha.ref);
  });

  patches.set(CELULA_TOTAL_PECAS, { tipo: 'cache', valor: totalPecas });
  patches.set(CELULA_VALOR_PARCIAL, { tipo: 'cache', valor: valorParcial });

  // O rodapé do formulário é uma conta em três degraus:
  //
  //     AB45  Valor Parcial   =SUM(AB13:AB44)
  //     AB46  DESC  %         (entrada — FRAÇÃO: 0,1 é 10%)
  //     AB47                  =AB45*AB46   → o desconto em reais
  //     AB48  TOTAL           =AB45-AB47
  //
  // AB46 é fração porque o desconto é `parcial × AB46`; escrever 10 ali daria
  // dez vezes o valor do pedido de desconto. Preenchemos os três em cache, e
  // não só a taxa, porque o Control lê o valor guardado da célula — ele não
  // recalcula a fórmula na importação.
  //
  // Sem desconto, tudo continua como sempre foi: zero na taxa e total = parcial.
  const percentual = dados.descontoPercentual ?? 0;
  const fracao = percentual / 100;
  const valorDoDesconto = Number((valorParcial * fracao).toFixed(2));
  patches.set(CELULA_DESCONTO_PERCENTUAL, { tipo: 'taxa', valor: fracao });
  patches.set(CELULA_DESCONTO, { tipo: 'cache', valor: valorDoDesconto });
  patches.set(CELULA_TOTAL, { tipo: 'cache', valor: Number((valorParcial - valorDoDesconto).toFixed(2)) });

  if (dados.numeroDoPedido) {
    patches.set(CELULA_NUMERO_DO_PEDIDO, { tipo: 'texto', valor: dados.numeroDoPedido });
  }

  if (dados.condicaoDePagamento) {
    patches.set(CELULA_COND_PGTO, { tipo: 'texto', valor: dados.condicaoDePagamento });
  }

  if (dados.data) {
    patches.set(CELULA_DATA, { tipo: 'texto', valor: dados.data });
  }

  const cliente = dados.cliente;
  if (cliente) {
    const campos: Array<[string, string | undefined]> = [
      [CELULA_RAZAO_SOCIAL, cliente.razaoSocial],
      [CELULA_NOME_FANTASIA, cliente.nomeFantasia],
      [CELULA_ENDERECO, cliente.endereco],
      [CELULA_WHATSAPP, cliente.whatsapp],
      [CELULA_CNPJ, cliente.cnpj],
      [CELULA_EMAIL, cliente.email],
    ];
    for (const [celula, valor] of campos) {
      const texto = valor?.trim();
      if (texto) patches.set(celula, { tipo: 'texto', valor: texto });
    }
  }

  if (dados.observacao) {
    patches.set(CELULA_OBSERVACAO, { tipo: 'texto', valor: dados.observacao });
  }

  const preenchida = aplicarPatches(textoDecodificado.decode(sheet1), patches);
  const saida: Record<string, Uint8Array> = { ...partes };
  saida[PLANILHA_DO_PEDIDO] = textoCodificado.encode(preenchida);

  return { arquivo: zipSync(saida), refsDesconhecidas };
}
