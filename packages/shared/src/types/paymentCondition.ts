/**
 * Condição de pagamento do Control (migração 028).
 *
 * A lista veio da exportação do próprio Control (146 condições em 13/08/2026) e
 * é ele quem manda: o app não cria condição, só escolhe uma. O CÓDIGO é a
 * identidade — há descrições repetidas com códigos diferentes de propósito
 * ("60 DIAS" é o código 15 e o 36; "A VISTA" é o 1 e o 68), porque no Control
 * são condições distintas, com prazos e regras próprias.
 */
export interface PaymentCondition {
  id: string;
  /** O código da condição NO CONTROL (1 a 146 hoje). */
  code: number;
  /** O texto que o representante reconhece ("30/60/90 DIAS"). Vai no COND PGTO. */
  description: string;
  active: boolean;
  /**
   * Como o Control descreve a condição (migração 049). `description` continua
   * sendo a do app — o CRM casa por ela e a API nunca a regrava.
   */
  erp_description?: string | null;
  /** Quando o Control mandou esta condição pela última vez. */
  erp_updated_at?: string | null;
  /** O menor pedido que a condição aceita, como o Control informa. Nulo = sem mínimo. */
  valor_minimo?: number | null;
}
