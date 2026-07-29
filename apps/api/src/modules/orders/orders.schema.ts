import { z } from 'zod';

export const createOrderSchema = z.object({
  customer_id: z.string().min(1, 'customer_id é obrigatório'),
  notes: z.string().optional(),
  local_id: z.string().optional(),
  // Pedido fechado pelo representante entra direto na fila de aprovação.
  // Ausente = rascunho (compatível com clientes antigos que não mandam o campo).
  submit: z.boolean().optional(),
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
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'sent_erp', 'error_erp']),
  notes: z.string().default(''),
});

export const setInvoicedSchema = z.object({
  invoiced: z.boolean(),
});
