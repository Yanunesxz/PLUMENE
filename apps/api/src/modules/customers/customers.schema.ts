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
  // Contato e endereço são obrigatórios para o cadastro do cliente.
  email: z
    .string()
    .trim()
    .min(1, 'E-mail é obrigatório')
    .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido'),
  address: z.string().trim().min(5, 'Endereço é obrigatório'),
  trade_name: z.string().trim().nullable().default(null),
  // Opcional aqui de propósito: rep com uma tabela só não manda nada e o
  // servidor usa a dele. Quem tem duas ou mais é obrigado a escolher, mas essa
  // regra depende do conjunto do usuário — vive no controller, não no schema.
  price_table_id: z.string().uuid('Tabela de preço inválida').nullable().optional(),
});

export const trocarTabelaDoClienteSchema = z.object({
  price_table_id: z.string().uuid('Tabela de preço inválida'),
});
