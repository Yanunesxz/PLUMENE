import { zipSync } from 'fflate';
import { montarLinhas, dividirEmFolhas, type ItemParaPlanilha } from './planilha/linhas.js';
import { preencherModelo, type ClienteDaFolha } from './planilha/modeloOficial.js';
import {
  coresPorSkuParaOControl,
  coresSemNumeroParaOControl,
  observacaoGeralParaOControl,
} from '@csb/shared';
import type { NumeroDaTabela } from './planilha/tabela.js';
import type { CorDaFicha, CorPeloNome, OrderWithItems } from '@csb/shared';

export type { ClienteDaFolha };

export type { NumeroDaTabela };

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

export interface ContextoDaExportacao {
  /** product_id → SKU do produto. */
  skuDoProduto: Map<string, string>;
  /** variant_id → tamanho ("M", "48"). Sem ele o item não tem coluna. */
  tamanhoDaVariante: Map<string, string>;
  /** A tabela que precifica o pedido. `null` quando não deu para descobrir. */
  tabelaDoPedido: (pedido: OrderWithItems) => NumeroDaTabela | null;
  /**
   * O cabeçalho de quem comprou (razão social, CNPJ, endereço…). `null` ou
   * ausente = cabeçalho em branco, que era o comportamento até 13/08/2026.
   */
  clienteDoPedido?: (pedido: OrderWithItems) => ClienteDaFolha | null;
  /**
   * product_id → cor do produto ("Azul"). Vai na coluna OBSERVAÇÃO de cada
   * linha — o campo que a fábrica lê na separação. Ausente = coluna em branco.
   */
  corDoProduto?: Map<string, string | null>;
  /**
   * product_id → a ficha de cores da peça (as bolinhas do catálogo impresso,
   * `ProductWithPrice.colors`). É por ela que a cor escolhida sai NUMERADA na
   * coluna OBSERVAÇÃO — "Cor 2", "3M Cor 2 / 2G Cor 1", "Variadas" — do jeito
   * que o estoque confere no catálogo (pedido do Yan, 22/09/2026). Ausente,
   * ou peça sem ficha, ou nome sem casamento: sai o nome, como antes — e o
   * resultado leva um aviso por cor que foi pelo nome.
   */
  coresDoProduto?: Map<string, readonly CorDaFicha[] | undefined>;
}

export interface ResultadoDaExportacao {
  /** Quantos .xlsx foram gerados ao todo. */
  arquivos: number;
  /** O que o operador precisa conferir antes de lançar. Vazio = tudo certo. */
  avisos: string[];
  /** O usuário fechou a folha de compartilhamento. Nada foi entregue. */
  cancelado: boolean;
  /**
   * O arquivo que foi entregue. `zip` quando saíram várias planilhas num
   * pacote só — a tela precisa contar isso ao operador: quem abre o .zip
   * direto (no navegador, no Drive) vê "erro", quando na verdade é só
   * extrair e abrir os .xlsx de dentro. `null` = nada foi gerado.
   */
  entrega: { nome: string; zip: boolean } | null;
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

/**
 * referência → a ficha de cores da peça, de TODO o catálogo em cache (não só
 * das peças que entraram na planilha): a cor anotada de uma peça que ficou de
 * fora também é avisada pelo número.
 */
function fichasPorSku(contexto: ContextoDaExportacao): Map<string, readonly CorDaFicha[]> {
  const fichas = new Map<string, readonly CorDaFicha[]>();
  if (!contexto.coresDoProduto) return fichas;
  for (const [produto, sku] of contexto.skuDoProduto) {
    const ficha = contexto.coresDoProduto.get(produto);
    if (ficha && ficha.length > 0) fichas.set(sku, ficha);
  }
  return fichas;
}

/**
 * A cor que foi pelo NOME na coluna OBSERVAÇÃO — o operador precisa saber
 * antes de subir: o estoque confere pelo número da bolinha (Yan, 22/09/2026).
 */
function avisoDaCorPeloNome(numero: string, cor: CorPeloNome): string {
  const porque = {
    sem_ficha:
      'o catálogo baixado está sem a ficha de cores da peça. Recarregue o catálogo (abra o Catálogo) e exporte de novo; se continuar, confira o número no catálogo',
    sem_casamento: 'essa cor não está na ficha de cores da peça (foi renomeada?). Confira o número no catálogo',
    ambigua: 'duas bolinhas da peça têm esse nome. Confira o número no catálogo',
    sem_numero: 'a bolinha dessa cor não tem número no cadastro. Confira no catálogo',
    // Não chega aqui: sortida e cor única vão pelo nome de propósito, e
    // `coresSemNumeroParaOControl` não as devolve (22/09/2026).
    nome_do_catalogo: 'é o nome que o catálogo mostra nessa bolinha',
  }[cor.motivo];
  return `Pedido ${numero}: a cor da ${cor.sku} saiu pelo nome ("${cor.nome}"), não pelo número — ${porque} antes de subir no Control.`;
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
    // A cor do CADASTRO (peça que é um produto por cor). A cor escolhida nas
    // bolinhas do catálogo não mora aqui — vem das notas, logo abaixo.
    const cor = contexto.corDoProduto?.get(item.product_id)?.trim();
    itens.push({
      sku,
      size,
      quantity: item.quantity,
      unit_price: item.unit_price,
      observacao: cor || undefined,
    });
  }

  for (const motivo of semTamanho) {
    avisos.push(`Pedido ${numero}: ${motivo} — não entrou na planilha.`);
  }

  // A OBSERVAÇÃO da linha, na ordem do que se sabe sobre a cor:
  //   1. a cor escolhida nas bolinhas do catálogo — só existe nas NOTAS do
  //      pedido (o item vai sortido pro ERP; as linhas "0706 6M azul" são a
  //      única memória da escolha). Aqui ela sai com o NÚMERO da bolinha
  //      ("Cor 2"), não com o nome: "na hora de subir pro Control tem que ser
  //      Cor 1, Cor 2, do jeito que está no catálogo" (Yan, 22/09/2026). O app
  //      continua mostrando o nome; sem casamento na ficha da peça, vai o nome;
  //   2. a cor do cadastro do produto (peça que é um produto por cor — essa
  //      não tem bolinha numerada, vai o nome);
  //   3. "Variado" — sortida de verdade, para a separação nunca ficar sem
  //      resposta. Só quando o chamador forneceu o mapa de cores.
  const skusDoPedido = new Set(itens.map((i) => i.sku));
  const fichaPorSku = fichasPorSku(contexto);
  const corDasNotas = coresPorSkuParaOControl(pedido.notes, skusDoPedido, fichaPorSku);
  if (contexto.corDoProduto) {
    for (const item of itens) {
      item.observacao = corDasNotas.get(item.sku) ?? item.observacao ?? 'Variado';
    }
    // A cor que caiu no NOME continua indo (número não se inventa), mas nunca
    // em silêncio: a planilha é feita com as fichas do catálogo EM CACHE, e um
    // catálogo baixado sem elas mandaria o nome em todas as referências. A API
    // de Parceiro não corre esse risco: lá a leitura que falha derruba a
    // resposta (500), porque "um soluço que mandasse o nome no lugar do número
    // ficaria gravado" no Control.
    for (const cor of coresSemNumeroParaOControl(pedido.notes, skusDoPedido, fichaPorSku)) {
      avisos.push(avisoDaCorPeloNome(numero, cor));
    }
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

  // O cabeçalho do formulário, como no modelo que a fábrica preenche à mão.
  // Pedido de vitrine não tem cadastro: sai o nome e o WhatsApp do visitante.
  const cliente =
    contexto.clienteDoPedido?.(pedido) ??
    (pedido.guest_name
      ? { razaoSocial: pedido.guest_name, whatsapp: pedido.guest_whatsapp ?? undefined }
      : null);
  const dataDoPedido = new Date(pedido.created_at).toLocaleDateString('pt-BR');

  // O rodapé fica com o que o REPRESENTANTE digitou (remessas, boletos…). As
  // linhas de cor que o app anexou às notas saem daqui: a cor agora vive na
  // coluna OBSERVAÇÃO de cada linha, e dobrada confundiria a separação.
  // Saem também as linhas de cor de peça que NÃO está nesta planilha (tirada
  // do pedido no "editar peças", ou que ficou de fora acima): iam ao estoque
  // com o NOME da cor de uma peça que nem vai. Cada uma vira um aviso, com a
  // cor já pelo número — se a peça tiver de ir, o operador lança à mão.
  const geral = observacaoGeralParaOControl(pedido.notes, skusDoPedido);
  const notasDoRep = geral.texto;
  const foraDaPlanilha = new Map<string, string[]>();
  for (const { sku, linha } of geral.linhasDeOutrasPecas) {
    foraDaPlanilha.set(sku, [...(foraDaPlanilha.get(sku) ?? []), linha]);
  }
  for (const [sku, anotadas] of foraDaPlanilha) {
    const cor = coresPorSkuParaOControl(anotadas.join('\n'), new Set([sku]), fichaPorSku).get(sku);
    avisos.push(
      `Pedido ${numero}: a ${sku} não está na planilha — a cor anotada para ela (${cor ?? anotadas.join(' / ')}) ficou fora do rodapé. Se a peça tiver de ir, lance à mão no Control.`,
    );
  }

  return folhas.map((folha, indice) => {
    // O rodapé marca a página ("PÁGINA 01.") e leva os recados do rep. Só na
    // primeira página, como no modelo da fábrica; as demais levam só o número.
    const pagina = `PÁGINA ${String(indice + 1).padStart(2, '0')}.`;
    const observacao = indice === 0 && notasDoRep ? `${pagina} ${notasDoRep}` : pagina;

    const { arquivo, refsDesconhecidas } = preencherModelo(modelo, {
      linhas: folha,
      numeroDoPedido: numero,
      data: dataDoPedido,
      cliente: cliente ?? undefined,
      observacao,
      // A API já manda a condição resolvida no pedido (embed da 028). Em todas
      // as folhas: cada arquivo do zip é um formulário completo.
      condicaoDePagamento: pedido.payment_condition?.description,
      // O desconto que o representante deu vai no campo DESC % do formulário —
      // a fábrica precisa VER que houve desconto, e não recebê-lo diluído no
      // preço unitário. Em cada folha, porque cada uma fecha o próprio total.
      descontoPercentual: pedido.discount_percent ?? 0,
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
    return { arquivos: 0, avisos, cancelado: false, entrega: null };
  }

  const dia = new Date().toISOString().slice(0, 10);

  if (arquivos.length === 1) {
    const unico = arquivos[0]!;
    const entregue = await entregar(unico.nome, unico.bytes, TIPO_XLSX);
    return { arquivos: 1, avisos, cancelado: !entregue, entrega: { nome: unico.nome, zip: false } };
  }

  const nomeDoPacote = `pedidos-control-${dia}.zip`;
  const pacote = zipSync(
    Object.fromEntries(arquivos.map((a) => [a.nome, a.bytes])),
    { level: 6 },
  );
  const entregue = await entregar(nomeDoPacote, pacote, TIPO_ZIP);
  return {
    arquivos: arquivos.length,
    avisos,
    cancelado: !entregue,
    entrega: { nome: nomeDoPacote, zip: true },
  };
}
