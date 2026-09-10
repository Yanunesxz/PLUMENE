import { z } from 'zod';
import { apenasDigitos, documento, cepValido, ufValida } from '@csb/shared';

/** Vazio ou null passam; se veio algo, `check` decide. Campos opcionais com formato. */
const opcionalCom = (check: (v: string) => boolean, msg: string, max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .refine((v) => v == null || v === '' || check(v), msg);

const obrigatorio = (msg: string, max = 200) => z.string().trim().min(1, msg).max(max);

/**
 * O cadastro "mais real" (Yan, 10/09/2026): o cliente que nasce aqui vai para
 * o Control, então o padrão é o do Control — CPF/CNPJ com dígito verificador,
 * endereço em campos separados com CEP obrigatório. O que é opcional lá
 * (complemento, IE, WhatsApp, e-mail, observações) segue opcional aqui, mas
 * validado se preenchido: dado sujo é pior que dado ausente, porque parece
 * certo.
 */
export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Nome / razão social é obrigatório').max(200),
  trade_name: z.string().trim().max(200).nullable().default(null),
  cnpj: z
    .string()
    .trim()
    .min(1, 'CPF / CNPJ é obrigatório')
    .refine((v) => documento(v) !== null, 'CPF / CNPJ inválido — confira os números'),
  inscricao_estadual: z.string().trim().max(30).nullable().optional(),

  cep: z.string().trim().min(1, 'CEP é obrigatório').refine(cepValido, 'CEP inválido — são 8 números'),
  logradouro: obrigatorio('Endereço (rua, avenida…) é obrigatório'),
  numero: obrigatorio('Número é obrigatório', 20),
  complemento: z.string().trim().max(100).nullable().optional(),
  bairro: obrigatorio('Bairro é obrigatório', 100),
  cidade: obrigatorio('Cidade é obrigatória', 100),
  uf: z.string().trim().refine(ufValida, 'UF inválida'),

  whatsapp: opcionalCom((v) => {
    const n = apenasDigitos(v).length;
    return n >= 10 && n <= 11;
  }, 'Informe o WhatsApp com DDD (10 ou 11 dígitos), ou deixe em branco', 30),
  email: opcionalCom((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido — ou deixe em branco'),
  observacoes: z.string().trim().max(2000).nullable().optional(),
  // Rep com uma tabela só não manda nada e o servidor usa a dele. Quem tem duas
  // ou mais é obrigado a escolher, mas essa regra depende do conjunto do
  // usuário — vive no controller, não no schema.
  price_table_id: z.string().uuid('Tabela de preço inválida').nullable().optional(),
});

export const trocarTabelaDoClienteSchema = z.object({
  price_table_id: z.string().uuid('Tabela de preço inválida'),
});

/** O número do cliente no Control, digitado pelo financeiro. Normalizado no service. */
export const atrelarCodigoErpSchema = z.object({
  erp_id: z.string().trim().min(1, 'Informe o código do cliente no ERP').max(10),
});
