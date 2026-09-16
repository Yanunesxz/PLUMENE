/**
 * O que o app guarda das RESPOSTAS do Control (migração 049).
 *
 * A fase 0 (048) deu ao app o canal por empresa, o rastro do pedido e as notas
 * fiscais. A 049 fecha o ciclo nas decisões de 16/09/2026: com o canal em
 * 'api' o pedido é SOLICITADO ao Control (o financeiro não digita mais o
 * número — ele chega pela confirmação do Control), e uma nota nova para o
 * mesmo pedido substitui a anterior. Os tipos aqui são o que a API devolve às
 * telas; as colunas por trás estão em orders.erp_requested_* e
 * order_invoices.substituida_*.
 */

/**
 * O pedido foi solicitado ao Control e está esperando o número.
 *
 * "Lançar no ERP" com canal 'api' não pede número nem responde 409: grava
 * orders.erp_requested_at/by, registra o evento 'solicitado_ao_erp' e a tela
 * fica consultando GET /orders/:id a cada 3 s, por até 3 min. O estado se lê
 * junto com o pedido: `erp_order_id` nulo = ainda esperando ("O Control ainda
 * não respondeu. O pedido fica na fila e o número aparece aqui quando
 * chegar"); preenchido = importado ("Parabéns, pedido importado! O número no
 * Control é CS…"). Não há coluna de "aguardando": é a comparação, para o
 * estado nunca desencontrar do fato.
 */
export interface SolicitacaoErp {
  /** Quando o financeiro apertou "Lançar no ERP" (orders.erp_requested_at). */
  solicitado_em: string;
  /** Quem apertou (orders.erp_requested_by). Nulo quando o login foi apagado. */
  solicitado_por: string | null;
  /** O nome de quem apertou, resolvido pela API. Ausente no cache offline. */
  solicitado_por_nome?: string | null;
}

/**
 * Uma nota que outra nota tomou o lugar (migração 049).
 *
 * Nota cancelada ou devolvida no Control não chega como aviso: o Control sobe
 * OUTRA nota (número diferente) para o mesmo pedido. A anterior recebe
 * cancelada_em e substituida_por = a nova, e o rastro ganha 'nota_substituida'.
 * A tela usa só a nota ativa; este par é o que o rastro e o histórico do
 * pedido mostram ("a 1234 foi substituída pela 1260 em 16/09").
 */
export interface NotaSubstituida {
  /** A nota que saiu de cena: número e série (série vazia = o Control não mandou). */
  anterior: { numero: string; serie: string };
  /** A nota que tomou o lugar dela. */
  nova: { numero: string; serie: string };
  /** Quando a troca aconteceu (order_invoices.substituida_em da anterior). */
  substituida_em: string;
}
