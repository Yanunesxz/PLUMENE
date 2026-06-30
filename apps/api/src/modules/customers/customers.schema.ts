import { z } from 'zod';

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  trade_name: z.string().nullable().default(null),
  cnpj: z.string().nullable().default(null),
  whatsapp: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
});
