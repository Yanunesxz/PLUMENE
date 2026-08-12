import { z } from 'zod';

const somenteDigitos = (v: string): string => v.replace(/\D/g, '');

/** Vazio ou null passam; se veio algo, `check` decide. Campos opcionais com formato. */
const opcionalCom = (check: (v: string) => boolean, msg: string) =>
  z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine((v) => v == null || v === '' || check(v), msg);

export const createCustomerSchema = z.object({
  // Único campo obrigatório. Cliente cadastrado no app NÃO vai para o Control,
  // então o padrão fiscal rígido — que só o Control precisa — só atrapalharia a
  // venda. O que estiver preenchido, porém, é validado: dado sujo é pior que dado
  // ausente, porque parece certo.
  name: z.string().trim().min(2, 'Nome / razão social é obrigatório'),
  // Obrigatório. CPF (11) ou CNPJ (14) — o cliente pode ser PF ou PJ.
  cnpj: z
    .string()
    .trim()
    .min(1, 'CPF / CNPJ é obrigatório')
    .refine((v) => [11, 14].includes(somenteDigitos(v).length), 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)'),
  whatsapp: opcionalCom((v) => {
    const n = somenteDigitos(v).length;
    return n >= 10 && n <= 11;
  }, 'Informe o WhatsApp com DDD (10 ou 11 dígitos), ou deixe em branco'),
  email: opcionalCom((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido — ou deixe em branco'),
  address: z.string().trim().nullable().optional(),
  trade_name: z.string().trim().nullable().default(null),
  // Rep com uma tabela só não manda nada e o servidor usa a dele. Quem tem duas
  // ou mais é obrigado a escolher, mas essa regra depende do conjunto do
  // usuário — vive no controller, não no schema.
  price_table_id: z.string().uuid('Tabela de preço inválida').nullable().optional(),
});

export const trocarTabelaDoClienteSchema = z.object({
  price_table_id: z.string().uuid('Tabela de preço inválida'),
});
