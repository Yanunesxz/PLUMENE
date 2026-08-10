import { zipSync } from 'fflate';
import { montarLinhas, dividirEmFolhas, type ItemParaPlanilha } from './planilha/linhas.js';
import { preencherModelo } from './planilha/modeloOficial.js';
import type { OrderWithItems } from '@csb/shared';

/**
 * Exporta pedido no formulário oficial da fábrica, do jeito que o Control importa.
 *
 * O que sai daqui não é relatório: é a planilha oficial preenchida. Três regras
 * mandam no formato e nenhuma delas é nossa —
 *
 *   • a grade da planilha tem 32 linhas (13 a 44) e não admite uma 33ª, então o
 *     pedido que passa disso vira vários arquivos, entregues num .zip;
 *   • uma linha carrega uma grade só, porque as colunas se repetem entre grades
 *     (a coluna Q é "XG" e "48"). A referência que pega letras e números gasta
 *     duas linhas — ver planilha/colunas.ts;
 *   • representante e cliente ficam em branco. Quem lança preenche no Control.
 *
 * Nada disso conversa com o ERP ainda. A planilha é a ponte enquanto não há
 * integração direta.
 */

/** Qual das três tabelas de preço da fábrica. É o que escolhe o modelo. */
export type NumeroDaTabela = 1 | 2 | 3;

export interface ContextoDaExportacao {
  /** product_id → SKU do produto. */
  skuDoProduto: Map<string, string>;
  /** variant_id → tamanho ("M", "48"). Sem ele o item não tem coluna. */
  tamanhoDaVariante: Map<string, string>;
  /** A tabela que precifica o pedido. `null` quando não deu para descobrir. */
  tabelaDoPedido: (pedido: OrderWithItems) => NumeroDaTabela | null;
}

export interface ResultadoDaExportacao {
  /** Quantos .xlsx foram gerados ao todo. */
  arquivos: number;
  /** O que o operador precisa conferir antes de lançar. Vazio = tudo certo. */
  avisos: string[];
  /** O usuário fechou a folha de compartilhamento. Nada foi entregue. */
  cancelado: boolean;
}

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TIPO_ZIP = 'application/zip';

/** Os modelos são estáticos e pesam ~50 KB: uma busca por sessão basta. */
const modelosCarregados = new Map<NumeroDaTabela, Uint8Array>();

async function carregarModelo(tabela: NumeroDaTabela): Promise<Uint8Array> {
  const guardado = modelosCarregados.get(tabela);
  if (guardado) return guardado;

  const resposta = await fetch(`${import.meta.env.BASE_URL}modelos/pedido-cs-${tabela}.xlsx`);
  if (!resposta.ok) throw new Error(`Modelo da tabela ${tabela} não encontrado (${resposta.status}).`);

  const bytes = new Uint8Array(await resposta.arrayBuffer());
  modelosCarregados.set(tabela, bytes);
  return bytes;
}

function nomeDoPedido(pedido: OrderWithItems): string {
  return String(pedido.order_number ?? pedido.id.slice(0, 8));
}

interface ArquivoGerado {
  nome: string;
  bytes: Uint8Array;
}

/**
 * Um pedido vira um arquivo — ou vários, quando não cabe em 32 linhas.
 */
async function gerarArquivosDoPedido(
  pedido: OrderWithItems,
  contexto: ContextoDaExportacao,
  avisos: string[],
): Promise<ArquivoGerado[]> {
  const numero = nomeDoPedido(pedido);
  const itens: ItemParaPlanilha[] = [];
  const semTamanho: string[] = [];

  for (const item of pedido.items) {
    const sku = contexto.skuDoProduto.get(item.product_id);
    if (!sku) {
      semTamanho.push(`produto ${item.product_id.slice(0, 8)} fora do catálogo baixado`);
      continue;
    }
    const size = item.variant_id ? contexto.tamanhoDaVariante.get(item.variant_id) : undefined;
    if (!size) {
      semTamanho.push(`${sku} sem tamanho no pedido`);
      continue;
    }
    itens.push({ sku, size, quantity: item.quantity, unit_price: item.unit_price });
  }

  for (const motivo of semTamanho) {
    avisos.push(`Pedido ${numero}: ${motivo} — não entrou na planilha.`);
  }

  const { linhas, foraDaGrade } = montarLinhas(itens);
  for (const item of foraDaGrade) {
    avisos.push(
      `Pedido ${numero}: ${item.sku} tamanho "${item.size}" não existe na planilha — não entrou.`,
    );
  }
  if (linhas.length === 0) return [];

  const resolvida = contexto.tabelaDoPedido(pedido);
  if (!resolvida) {
    avisos.push(`Pedido ${numero}: tabela de preço não identificada — exportado na Tabela 1.`);
  }
  const tabela: NumeroDaTabela = resolvida ?? 1;

  const modelo = await carregarModelo(tabela);
  const folhas = dividirEmFolhas(linhas);

  return folhas.map((folha, indice) => {
    const { arquivo, refsDesconhecidas } = preencherModelo(modelo, {
      linhas: folha,
      numeroDoPedido: numero,
    });

    for (const ref of refsDesconhecidas) {
      avisos.push(`Pedido ${numero}: a referência ${ref} não existe na Tabela ${tabela} — sairá sem preço.`);
    }

    const parte = folhas.length > 1 ? `-parte-${indice + 1}-de-${folhas.length}` : '';
    return { nome: `pedido-${numero}-tabela-${tabela}${parte}.xlsx`, bytes: arquivo };
  });
}

/**
 * iOS Safari e o app instalado como PWA ignoram o download por `<a download>`,
 * então `writeFile` "não baixa nada" no iPhone. Quando o navegador sabe
 * compartilhar arquivo, abrimos a folha nativa — o usuário salva em Arquivos ou
 * manda no WhatsApp. No desktop e no Android cai no download de sempre.
 */
async function entregar(nome: string, bytes: Uint8Array, tipo: string): Promise<boolean> {
  // A cópia não é desperdício: o `Uint8Array` que a fflate devolve é genérico
  // sobre `ArrayBufferLike`, e `BlobPart` só aceita `ArrayBuffer`. Recopiar sai
  // mais barato do que um cast que esconde a diferença.
  const blob = new Blob([new Uint8Array(bytes)], { type: tipo });
  const file = new File([blob], nome, { type: tipo });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };

  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Pedidos' });
      return true;
    } catch (err) {
      // Fechou a folha de compartilhamento: não é erro, e não é para baixar
      // escondido depois de a pessoa ter desistido.
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      // Qualquer outra falha: cai no download abaixo.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function exportarPedidosParaControl(
  pedidos: readonly OrderWithItems[],
  contexto: ContextoDaExportacao,
): Promise<ResultadoDaExportacao> {
  const avisos: string[] = [];
  const arquivos: ArquivoGerado[] = [];

  for (const pedido of pedidos) {
    arquivos.push(...(await gerarArquivosDoPedido(pedido, contexto, avisos)));
  }

  if (arquivos.length === 0) {
    avisos.push('Nada foi exportado: nenhum item dos pedidos escolhidos cabe na planilha.');
    return { arquivos: 0, avisos, cancelado: false };
  }

  const dia = new Date().toISOString().slice(0, 10);

  if (arquivos.length === 1) {
    const unico = arquivos[0]!;
    const entregue = await entregar(unico.nome, unico.bytes, TIPO_XLSX);
    return { arquivos: 1, avisos, cancelado: !entregue };
  }

  const pacote = zipSync(
    Object.fromEntries(arquivos.map((a) => [a.nome, a.bytes])),
    { level: 6 },
  );
  const entregue = await entregar(`pedidos-control-${dia}.zip`, pacote, TIPO_ZIP);
  return { arquivos: arquivos.length, avisos, cancelado: !entregue };
}
