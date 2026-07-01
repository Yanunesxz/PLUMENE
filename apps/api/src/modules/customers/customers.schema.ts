import { z } from 'zod';

const somenteDigitos = (v: string): string => v.replace(/\D/g, '');

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Nome / razão social é obrigatório'),
  // Aceita CNPJ (14 dígitos) ou CPF (11), pois o cliente pode ser PJ ou PF.
  cnpj: z
    .string()
    .trim()
    .min(1, 'CNPJ / CPF é obrigatório')
    .refine((v) => [11, 14].includes(somenteDigitos(v).length), 'Informe um CNPJ (14 dígitos) ou CPF (11 dígitos)'),
  // Contato é essencial para o representante — obrigatório.
  whatsapp: z
    .string()
    .trim()
    .min(1, 'WhatsApp é obrigatório')
    .refine((v) => {
      const n = somenteDigitos(v).length;
      return n >= 10 && n <= 11;
    }, 'Informe o WhatsApp com DDD (10 ou 11 dígitos)'),
  trade_name: z.string().trim().nullable().default(null),
  email: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido'),
});
