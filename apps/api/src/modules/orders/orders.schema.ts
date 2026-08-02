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
