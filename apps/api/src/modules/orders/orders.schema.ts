import { z } from 'zod';
import { numeroErpValido } from '@csb/shared';

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
  // O desconto fechado na montagem (029). Em % ou em R$ — o servidor converte o
  // valor usando a soma dos itens. O controller descarta de quem não é rep.
  discount_percent: z.number().min(0).max(100).optional(),
  discount_value: z.number().min(0).optional(),
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
  // O número do Control ao lançar ("CS17379"). Se vier, tem de ter o formato;
  // se É obrigatório (sent_erp) quem cobra é o service, que conhece o passo.
  erp_order_id: z
    .string()
    .trim()
    .max(12)
    .optional()
    .refine((v) => v == null || v === '' || numeroErpValido(v), 'Número do Control inválido — são duas letras e a numeração, ex.: CS17379'),
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
/**
 * O desconto do pedido — em % ou em REAIS, um dos dois.
 *
 * Quem manda o valor não manda o percentual: é o SERVIDOR que converte, usando
 * a soma dos itens que ele mesmo calculou. Aceitar os dois do aparelho abriria
 * a porta para eles discordarem, e aí o total e a planilha contariam histórias
 * diferentes.
 */
export const setDiscountSchema = z
  .object({
    desconto: z.number().min(0).max(100).optional(),
    desconto_valor: z.number().min(0).optional(),
  })
  .refine((b) => b.desconto != null || b.desconto_valor != null, {
    message: 'Informe "desconto" (%) ou "desconto_valor" (R$)',
  })
  .refine((b) => !(b.desconto != null && b.desconto_valor != null), {
    message: 'Informe só um: "desconto" (%) OU "desconto_valor" (R$)',
  });

/** Troca da condição de pagamento num pedido em aberto. `null` remove. */
/** A observação LIVRE do pedido — as linhas de cor o servidor preserva sozinho. */
export const setNotesSchema = z.object({
  notes: z.string().max(4000),
});

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

/** A correção do número do Control, quando a Larissa digitou errado ao lançar. */
export const corrigirNumeroErpSchema = z.object({
  erp_order_id: z
    .string()
    .trim()
    .max(12)
    .refine(numeroErpValido, 'Número do Control inválido — são duas letras e a numeração, ex.: CS17379'),
});

/**
 * "Atualizar no ERP" (046): a venda interna editou as peças de um pedido que já
 * está no Control e avisa que a fábrica precisa mudar lá. `confirmar` é a outra
 * ponta — quem mexe no Control diz que já atualizou.
 */
export const erpSyncSchema = z.object({
  acao: z.enum(['pedir', 'confirmar']),
  /** O recado de quem pediu ("tirei 6 peças da 0124, faltou no estoque"). */
  observacao: z.string().trim().max(500).optional(),
  /**
   * Só no `confirmar`: a impressão do pedido que estava na tela
   * (`assinaturaDoPedido`, em shared). Se o pedido mudou de novo desde então,
   * a confirmação é recusada em vez de engolir a segunda edição.
   */
  assinatura: z.string().trim().max(40).optional(),
}).refine((b) => b.acao !== 'confirmar' || !!b.assinatura, {
  // Sem ela a confirmação fotografaria o pedido de agora sem conferir nada. O
  // app antigo, que não manda, recebe o recado de atualizar em vez de engolir
  // uma edição.
  message: 'Atualize o app para confirmar — esta versão não diz qual lista você conferiu',
  path: ['assinatura'],
});
