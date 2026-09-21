import { z } from 'zod';
import { apenasDigitos, documento, cepValido, ufValida, CAMPOS_EDITAVEIS_DO_CLIENTE } from '@csb/shared';
import type { CampoEditavelDoCliente } from '@csb/shared';

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

/**
 * Excluir cliente (só admin). `juntar_em` é o cadastro que fica com o que o
 * excluído tinha; se é da mesma empresa, quem confere é o service.
 */
export const excluirClienteSchema = z.object({
  juntar_em: z.string().uuid('O cadastro que fica é inválido').nullable().optional(),
  motivo: z.string().trim().max(500, 'O motivo passa de 500 caracteres').nullable().optional(),
});

/** O `:id` das rotas de exclusão. Id que não é UUID não é cliente de ninguém. */
export const idDeClienteSchema = z.string().uuid();

/**
 * PATCH /customers/:id/cadastro — edição PARCIAL do cadastro (051).
 *
 * O schema só confere a FORMA: chaves conhecidas, texto ou null, e um valor
 * visto para cada campo novo. A régua de cada campo (a mesma do cadastro novo)
 * roda no service, com `validarEdicaoDoCadastro` de @csb/shared — ela precisa
 * do cliente atual para saber se o endereço resultante fica completo.
 *
 * Chave fora da lista (erp_id, address, blocked, rep_id…) é recusada: o que
 * não se edita por aqui não pode passar calado.
 */
const valorDoCampo = z.string().max(5000, 'Texto grande demais').nullable().optional();

/**
 * O valor VISTO não tem teto (revisão de 17/09/2026). Ele é o que está no banco,
 * e o banco aceita mais que a régua: o POST /partner/v1/clientes grava a
 * observação do tamanho que o Control mandar (coluna TEXT). Com o mesmo teto
 * de 5.000 do valor novo, uma observação longa vinda do Control não podia ser
 * encurtada nem apagada pelo app — o 400 saía antes de qualquer conta. O corpo
 * inteiro continua limitado pelo bodyLimit do Fastify.
 */
const valorVisto = z.string().nullable().optional();

const valoresDoCadastro = (valor: typeof valorVisto) =>
  z
    .object(
      Object.fromEntries(CAMPOS_EDITAVEIS_DO_CLIENTE.map((c) => [c, valor])) as Record<
        CampoEditavelDoCliente,
        typeof valor
      >,
    )
    .strict('Este campo não se edita por aqui (código do ERP, bloqueio, carteira e tabela têm caminho próprio)');

export const editarCadastroDoClienteSchema = z
  .object({ novo: valoresDoCadastro(valorDoCampo), vistos: valoresDoCadastro(valorVisto) })
  .superRefine((corpo, ctx) => {
    for (const campo of CAMPOS_EDITAVEIS_DO_CLIENTE) {
      if (corpo.novo[campo] === undefined) continue;
      if (corpo.vistos[campo] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['vistos', campo],
          message: 'Faltou o valor que estava na tela — recarregue a ficha e tente de novo',
        });
      }
    }
  });

/** POST /customers/:id/alteracoes/confirmar — os ids que a pessoa VIU no cartão. */
export const confirmarAlteracoesDoClienteSchema = z.object({
  ids: z
    .array(z.string().uuid('Alteração inválida'))
    .min(1, 'Nenhuma alteração para confirmar')
    .max(50, 'No máximo 50 alterações de uma vez'),
});
