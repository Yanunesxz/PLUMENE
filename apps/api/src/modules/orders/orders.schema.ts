import { z } from 'zod';

export const createOrderSchema = z.object({
  // Opcional no schema porque o controller decide quem é o cliente: o
  // representante manda; a loja tem o dela no token; a vitrine não tem nenhum.
  // Quem exige a presença é o `createOrder`, conforme a origem.
  customer_id: z.string().min(1).optional(),
  notes: z.string().optional(),
  local_id: z.string().optional(),
  // Pedido fechado pelo representante entra direto na fila de aprovação.
  // Ausente = rascunho (compatível com clientes antigos que não mandam o campo).
  submit: z.boolean().optional(),
  // Vitrine: quem está pedindo, já que não há cadastro por trás.
  guest_name: z.string().max(160).optional(),
  guest_whatsapp: z.string().max(30).optional(),
  // Condição de pagamento escolhida (rep ou loja). Opcional: sem ela o pedido
  // sai como sempre saiu, com o COND PGTO da planilha em branco.
  payment_condition_id: z.string().uuid().optional(),
  // O desconto do representante, fechado na montagem (029). O controller
  // descarta o campo de quem não é rep — aqui só se valida a forma.
  discount_percent: z.number().min(0).max(100).multipleOf(0.01).optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().min(1, 'product_id é obrigatório'),
        variant_id: z.string().optional(),
        quantity: z.number().int('Quantidade deve ser inteira').positive('Quantidade deve ser maior que zero'),
        unit_price: z.number().nonnegative('Preço unitário não pode ser negativo'),
      }),
    )
    .min(1, 'O pedido precisa ter ao menos um item'),
});

export const updateOrderStatusSchema = z.object({
  // `pending_rep` não entra: ninguém EMPURRA um pedido para a triagem por fora.
  // Ele só nasce assim, quando a loja ou a vitrine monta o pedido.
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'sent_erp', 'error_erp']),
  notes: z.string().default(''),
});

export const setInvoicedSchema = z.object({
  invoiced: z.boolean(),
});

/**
 * O desconto que o representante dá no pedido inteiro.
 *
 * Duas casas porque o formulário do Control aceita fração (o DESC % dele é
 * `AB45*AB46`, com AB46 em decimal) — 7,5% é um desconto comum e arredondar
 * para 7 ou 8 mudaria o valor combinado com o lojista.
 *
 * O teto de 100 é o impossível, não a política comercial: quanto o
 * representante PODE dar é decisão da fábrica, e ainda não foi definida.
 */
export const setDiscountSchema = z.object({
  desconto: z.number().min(0).max(100).multipleOf(0.01),
});

/** Troca da condição de pagamento num pedido em aberto. `null` remove. */
export const setPaymentSchema = z.object({
  payment_condition_id: z.string().uuid().nullable(),
});

/**
 * A troca das peças de um pedido em aberto. Só (produto × variante ×
 * quantidade): preço não entra no corpo de propósito — o servidor reprecifica
 * tudo pela tabela do pedido, como no create.
 *
 * Lista vazia é recusada: pedido sem peça não é edição, é cancelamento — e
 * cancelar tem caminho próprio (recusar ou excluir), que deixa rastro certo.
 */
export const setOrderItemsSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().min(1),
        variant_id: z.string().min(1).optional(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(500),
});
