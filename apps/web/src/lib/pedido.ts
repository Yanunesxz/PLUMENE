import type { AuthRole, Order, OrderSource, OrderStatus, StatusDoCliente } from '@csb/shared';
import {
  ORDER_STATUS_LABELS,
  STATUS_DO_CLIENTE_LABELS,
  lerNumeroErp,
  statusDoCliente,
  usaStatusInterno,
} from '@csb/shared';

/**
 * Quem está comprando, em uma linha.
 *
 * Pedido de vitrine não tem cliente cadastrado — quem pediu se identificou só
 * com nome e WhatsApp no fechamento. Toda tela que mostra "o cliente do pedido"
 * passa por aqui para não precisar repetir essa decisão.
 */
export function nomeDoComprador(order: Order, nomePorCliente: Map<string, string>): string {
  if (order.customer_id) return nomePorCliente.get(order.customer_id) ?? 'Cliente';
  return order.guest_name?.trim() || 'Visitante';
}

/**
 * Ordena referências como números: 15 antes de 130, 130 antes de 1001.
 *
 * As refs do catálogo vêm com zero à esquerda ("0015"), então a ordem
 * alfabética quase funciona — até aparecer uma sem o zero, vinda do ERP ou de
 * cadastro antigo, e "950" ir parar depois de "1001". Comparar o número
 * resolve as duas formas; o que não é numérico cai na ordem alfabética.
 *
 * É por esta função que toda lista de peças (montagem, detalhe, página do
 * cliente) sai em ordem crescente de referência — a mesma ordem do catálogo
 * impresso, que é como o representante procura.
 */
export function compararReferencia(a: string, b: string): number {
  const na = Number(a.trim());
  const nb = Number(b.trim());
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, 'pt-BR', { numeric: true });
}

export const ORIGEM_LABEL: Record<OrderSource, string> = {
  rep: 'Representante',
  store: 'Loja',
  showcase: 'Vitrine',
};

/** Só vale destacar a origem quando NÃO foi o representante que montou. */
export function origemParaExibir(order: Order): string | null {
  const origem = order.source;
  if (!origem || origem === 'rep') return null;
  return ORIGEM_LABEL[origem];
}

/** Cor do selo de status. Uma tabela só, para as telas não divergirem. */
export const STATUS_VARIANTE: Record<OrderStatus, 'gray' | 'yellow' | 'green' | 'red' | 'brand'> = {
  draft: 'gray',
  pending_rep: 'brand',
  pending_approval: 'yellow',
  approved: 'green',
  rejected: 'red',
  sent_erp: 'brand',
  error_erp: 'red',
};

const VARIANTE_DO_CLIENTE: Record<StatusDoCliente, 'gray' | 'yellow' | 'green' | 'red' | 'brand'> = {
  enviado: 'yellow',
  aprovado: 'green',
  entregue: 'green',
  recusado: 'red',
};

export interface SeloDoPedido {
  texto: string;
  variante: 'gray' | 'yellow' | 'green' | 'red' | 'brand';
}

/**
 * O selo de status que ESTE papel deve ver.
 *
 * Gerente e administrador veem o estado interno, que é o que eles operam.
 * Representante e loja veem os três degraus de fora — para eles "Aguardando
 * Aprovação" e "Enviado ao ERP" são vocabulário da fábrica, não notícia sobre
 * a mercadoria. E o "Aprovado" deles é o FATURADO, não o status `approved`:
 * quem fecha o valor é o financeiro. Ver `constants/statusDoCliente.ts`.
 *
 * Toda tela que desenha status passa por aqui — se cada uma decidisse sozinha,
 * o mesmo pedido apareceria de um jeito na lista e de outro no detalhe.
 */
export function seloDoPedido(
  pedido: Pick<Order, 'status'> & {
    invoiced?: boolean | null;
    delivered?: boolean | null;
    erp_requested_at?: string | null;
    erp_order_id?: string | null;
  },
  papel: AuthRole | undefined,
): SeloDoPedido {
  // O financeiro fala a língua da MESA dele, não a do fluxo interno: o que
  // chegou espera o aceite; o que ele aceitou espera o faturamento; o que
  // faturou acabou. É o selo que casa com as filas da tela de pedidos.
  if (papel === 'financeiro') {
    if (pedido.status === 'draft') return { texto: 'Rascunho', variante: 'gray' };
    if (pedido.invoiced) return { texto: 'Faturado', variante: 'green' };
    if (pedido.status === 'pending_approval') return { texto: 'Aguardando aceite', variante: 'yellow' };
    // Aceito e já SOLICITADO ao Control (049): não é mais "a lançar" — o
    // clique foi dado; falta o Control devolver o número.
    if (pedido.status === 'approved' && pedido.erp_requested_at && !pedido.erp_order_id) {
      return { texto: 'Solicitado ao Control', variante: 'yellow' };
    }
    // Aceito mas fora do Control: falta o LANÇAMENTO (a planilha).
    if (pedido.status === 'approved') return { texto: 'A lançar', variante: 'brand' };
    // Lançado: agora é esperar a nota sair para carimbar.
    if (pedido.status === 'sent_erp') return { texto: 'A faturar', variante: 'gray' };
    return { texto: ORDER_STATUS_LABELS[pedido.status], variante: STATUS_VARIANTE[pedido.status] };
  }
  if (usaStatusInterno(papel)) {
    return { texto: ORDER_STATUS_LABELS[pedido.status], variante: STATUS_VARIANTE[pedido.status] };
  }
  // O rascunho é a área "Enviar pra fábrica" do representante — o pedido salvo
  // que ainda não foi. Deixá-lo cair nos degraus diria "Enviado pra fábrica"
  // sobre um pedido que a fábrica nunca viu.
  if (pedido.status === 'draft') {
    return { texto: 'Enviar pra fábrica', variante: 'gray' };
  }
  const degrau = statusDoCliente(pedido);
  return { texto: STATUS_DO_CLIENTE_LABELS[degrau], variante: VARIANTE_DO_CLIENTE[degrau] };
}

/**
 * A decisão que ESTE usuário pode tomar sobre ESTE pedido — ou nenhuma.
 *
 * São dois portões diferentes com a mesma cara: o representante tria o que
 * chegou de fora, o gerente aprova o que vai faturar. Os rótulos dizem o que o
 * botão faz ("mandar para a fábrica"), não o nome do estado — quem usa não
 * precisa saber que existe um `pending_approval`.
 */
export interface Decisao {
  aceitar: OrderStatus;
  rotuloAceitar: string;
  rotuloRecusar: string;
  /** Uma linha dizendo o que acontece depois de aceitar. */
  explicacao: string;
}

/**
 * `podeAprovar` vem da tecla `aprovar_pedidos` do gerente. Padrão `true` para os
 * chamadores que não têm o que perguntar — rep e loja não têm teclas, e quem
 * decide se eles decidem continua sendo o papel.
 */
export function decisaoDoPedido(
  papel: AuthRole | undefined,
  status: OrderStatus,
  podeAprovar = true,
): Decisao | null {
  const daFabrica = papel === 'manager' || papel === 'admin' || papel === 'financeiro';
  // Quem DECIDE o pedido na fila é o financeiro ("quem aceita os pedidos"); o
  // admin fica como válvula. O gerente saiu do caminho — Yan, 02/09/2026:
  // "nenhum pedido precisa passar por ele, chega direto no financeiro". Ele
  // continua vendo e organizando; só não aprova nem recusa.
  const decideAFila = papel === 'admin' || papel === 'financeiro';

  // Triagem: o pedido chegou da loja ou de um link. O gerente também passa por
  // aqui — se o representante sumir, o pedido não fica preso.
  if (status === 'pending_rep' && (papel === 'rep' || daFabrica) && podeAprovar) {
    return {
      aceitar: 'pending_approval',
      rotuloAceitar: 'Mandar para a fábrica',
      rotuloRecusar: 'Recusar',
      explicacao: 'Este pedido chegou pronto. Ao mandar, ele cai direto na mesa do financeiro.',
    };
  }

  if (status === 'pending_approval' && decideAFila && podeAprovar) {
    return {
      aceitar: 'approved',
      rotuloAceitar: 'Aprovar',
      rotuloRecusar: 'Recusar',
      explicacao: 'Aprovar libera o pedido para o faturamento.',
    };
  }

  return null;
}

/**
 * Quem vê o botão "Lançar no ERP": o financeiro (a Larissa — "os pedidos só
 * vão ser incluídos por ela", Yan 10/09/2026) e o admin como válvula. Pedido
 * aceito e ainda sem nota. Função pura para o teste trancar a regra.
 */
export function podeLancarNoErp(
  papel: AuthRole | undefined,
  status: OrderStatus,
  invoiced: boolean | null | undefined,
): boolean {
  return status === 'approved' && !invoiced && (papel === 'financeiro' || papel === 'admin');
}

// ─── A integração com o Control (048/049) ────────────────────────────────────

/**
 * Os canais da empresa que o GET /orders/:id devolve junto com o pedido
 * (migração 048): por onde o número do Control chega e por onde o faturado
 * chega. `null` = a API não conseguiu ler; ausente = pedido do cache offline.
 * Nos dois casos a tela se comporta como sempre (manual).
 */
export interface CanaisDoPedido {
  pedido_erp: string;
  faturamento: string;
}

/**
 * O número do pedido vem do Control pela API? Aí "Lançar" não pede número:
 * SOLICITA, e a tela espera o Control responder (decisão 2 de 16/09/2026).
 */
export function lancaPeloControl(canais: CanaisDoPedido | null | undefined): boolean {
  return canais?.pedido_erp === 'api';
}

/**
 * O faturado vem do Control pela API? Aí o botão manual de faturado some
 * para TODOS — financeiro, admin e venda interna (decisão 11 de 16/09/2026).
 */
export function faturaPeloControl(canais: CanaisDoPedido | null | undefined): boolean {
  return canais?.faturamento === 'api';
}

/**
 * A SÉRIE do número do Control desta marca: CS na Corpo Sensual, PL na
 * PLUMENE. É só para exemplo e sugestão na tela — quem cunha o número é o
 * Control. Marca que a tela não conhece usa a série do último número lançado
 * na empresa; sem nenhum dos dois, vazio.
 */
export function serieDoControl(marca: string | null | undefined, ultimo?: string | null): string {
  const nome = (marca ?? '').trim().toUpperCase();
  if (nome === 'CORPO SENSUAL') return 'CS';
  if (nome === 'PLUMENE') return 'PL';
  return lerNumeroErp(ultimo)?.prefixo ?? '';
}

/** O exemplo que a tela mostra ao lado do campo ("CS17379"). */
export function exemploDeNumeroErp(serie: string): string {
  return `${serie || 'CS'}17379`;
}

/**
 * A espera pelo Control depois de solicitar: a tela consulta o pedido de 3 em
 * 3 s, por até 3 min (decisão 2 de 16/09/2026).
 */
export const ESPERA_DO_CONTROL = {
  intervalo_ms: 3_000,
  limite_ms: 3 * 60_000,
} as const;

export type EstadoDaEspera = 'aguardando' | 'importado' | 'esgotou';

/**
 * Onde a espera está, a partir do pedido recém-consultado e do relógio.
 * Número chegou = importado (mesmo que o tempo já tenha passado); sem número
 * e dentro do prazo = aguardando; sem número e fora = esgotou.
 */
export function estadoDaEspera(
  pedido: Pick<Order, 'erp_order_id'>,
  inicioMs: number,
  agoraMs: number,
): EstadoDaEspera {
  if (pedido.erp_order_id) return 'importado';
  return agoraMs - inicioMs >= ESPERA_DO_CONTROL.limite_ms ? 'esgotou' : 'aguardando';
}

/**
 * Quem vê "Cancelar solicitação" (decisão do Yan, 16/09/2026 à tarde): quem
 * solicita — financeiro e admin —, num pedido SOLICITADO ao Control e ainda
 * sem número. Com o número, o Control já importou e não há o que cancelar.
 * A mesma regra do PATCH /orders/:id/cancelar-solicitacao; quem protege de
 * verdade é a API.
 */
export function podeCancelarSolicitacao(
  papel: AuthRole | undefined,
  pedido: Pick<Order, 'erp_order_id'> & { erp_requested_at?: string | null },
): boolean {
  return (papel === 'financeiro' || papel === 'admin') && Boolean(pedido.erp_requested_at) && !pedido.erp_order_id;
}

/** A pergunta antes de cancelar — combinada com o Yan (16/09/2026). */
export const PERGUNTA_CANCELAR_SOLICITACAO = 'O Control ainda não importou. Cancelar tira o pedido da fila do Control.';

/** As frases combinadas com o Yan (16/09/2026) para cada desfecho da espera. */
export function mensagemDaEspera(estado: EstadoDaEspera, numeroNoControl: string | null | undefined): string {
  if (estado === 'importado') {
    return `Parabéns, pedido importado! O número no Control é ${numeroNoControl ?? ''}`.trimEnd() + '.';
  }
  if (estado === 'esgotou') {
    return 'O Control ainda não respondeu. O pedido fica na fila e o número aparece aqui quando chegar.';
  }
  return 'Aguardando o Control importar o pedido…';
}

/**
 * O link "wa.me" que abre o WhatsApp com a mensagem pronta.
 *
 * O cadastro guarda o número como o Control mandou — "(11) 1734-0709",
 * "32 99849 3125" — sem o DDI. O wa.me exige o número internacional completo:
 * sem o 55 na frente, o WhatsApp diz que o número não existe. Número de 10–11
 * dígitos (DDD + linha) ganha o 55; quem já veio com 55 passa direto; formato
 * fora disso vai como está (melhor abrir errado que não abrir).
 *
 * Sem número, abre o WhatsApp no seletor de conversa — o representante escolhe
 * o contato e a mensagem já está lá.
 */
export function linkDoWhatsApp(numero: string | null | undefined, texto?: string): string {
  const mensagem = texto ? `?text=${encodeURIComponent(texto)}` : '';
  const digitos = (numero ?? '').replace(/\D/g, '');
  if (!digitos) return `https://wa.me/${mensagem}`;
  const completo =
    digitos.length === 10 || digitos.length === 11
      ? `55${digitos}`
      : digitos;
  return `https://wa.me/${completo}${mensagem}`;
}
