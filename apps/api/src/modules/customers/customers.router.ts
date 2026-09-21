import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listCustomers,
  getCustomerHandler,
  createCustomerHandler,
  trocarTabelaDoClienteHandler,
  marcarInatividadeHandler,
  marcarVarejoHandler,
  atrelarCodigoErpHandler,
  vinculosDoClienteHandler,
  excluirClienteHandler,
  editarCadastroDoClienteHandler,
  alteracoesPendentesHandler,
  confirmarAlteracoesHandler,
} from './customers.controller.js';

export async function customersRouter(fastify: FastifyInstance): Promise<void> {
  // A carteira de clientes é de quem vende. A loja não tem o que fazer aqui —
  // ela é UM cliente, não tem carteira — e o visitante da vitrine muito menos.
  // Sem esta guarda, um token de loja listava os clientes inteiros da empresa.
  //
  // O financeiro LÊ tudo (confere cliente e código antes de lançar no ERP).
  // Cadastrar cliente novo e trocar tabela seguem com quem vende. A decisão de
  // 14/08/2026 ("não pode alterar cadastro dos clientes, só visualizar") foi
  // revertida pelo Yan em 17/09/2026 SÓ para a edição do cadastro (PATCH
  // /customers/:id/cadastro): o financeiro é quem leva a mudança ao Control e
  // edita — CPF/CNPJ inclusive, que só ele e o admin trocam.
  // O relacionamento (Bruna, migração 038) LÊ qualquer carteira: o trabalho
  // dela é achar o cliente parado e encaminhar pro rep — sem ler, não há o que
  // encaminhar. Escrever cadastro continua fora do alcance dela.
  const leitura = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'financeiro', 'relacionamento'])] };
  const escrita = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] };

  fastify.get('/customers', leitura, listCustomers);
  // A fila "Cadastros alterados para atualizar no Control" (051). Rota estática:
  // o Fastify a prefere a /customers/:id, e ela fica antes por clareza.
  fastify.get(
    '/customers/alteracoes-pendentes',
    { preHandler: [authenticate, requireRole(['financeiro', 'admin', 'manager'])] },
    alteracoesPendentesHandler,
  );
  fastify.get('/customers/:id', leitura, getCustomerHandler);
  fastify.post('/customers', escrita, createCustomerHandler);
  // Só a tabela de preço. Edição de cadastro é outro assunto, com outros riscos.
  fastify.patch('/customers/:id', escrita, trocarTabelaDoClienteHandler);
  // Editar o cadastro (Yan, 17/09/2026; migração 051): rep e venda interna na
  // própria carteira; gerente, admin e financeiro em qualquer cliente. CPF/CNPJ
  // só admin e financeiro (o controller barra). Relacionamento, loja e
  // visitante não editam.
  fastify.patch(
    '/customers/:id/cadastro',
    { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'financeiro'])] },
    editarCadastroDoClienteHandler,
  );
  // "Já atualizei no Control": só quem mexe no Control.
  fastify.post(
    '/customers/:id/alteracoes/confirmar',
    { preHandler: [authenticate, requireRole(['financeiro', 'admin'])] },
    confirmarAlteracoesHandler,
  );
  // O porquê do cliente vermelho (migração 039): rep na própria carteira;
  // relacionamento e gerência em qualquer uma. Financeiro segue só lendo.
  fastify.patch(
    '/customers/:id/inatividade',
    { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'relacionamento'])] },
    marcarInatividadeHandler,
  );
  // Cliente de varejo (migração 047): só a venda interna marca, na própria
  // carteira — o controller barra o representante comum.
  fastify.patch(
    '/customers/:id/varejo',
    { preHandler: [authenticate, requireRole(['rep'])] },
    marcarVarejoHandler,
  );
  // O número do cliente no Control, atrelado ao cadastro nascido no app. É a
  // Larissa (financeiro) quem inclui e atrela — o admin fica como válvula.
  fastify.patch(
    '/customers/:id/codigo-erp',
    { preHandler: [authenticate, requireRole(['financeiro', 'admin'])] },
    atrelarCodigoErpHandler,
  );
  // Excluir cliente (decisão do Yan, 16/09/2026): SÓ o admin. Cliente com
  // pedido, login, convite, vitrine ou tarefa sai juntado em outro cadastro, e
  // a cópia fica em deleted_customers (migração 050).
  const soAdmin = { preHandler: [authenticate, requireRole(['admin'])] };
  fastify.get('/customers/:id/vinculos', soAdmin, vinculosDoClienteHandler);
  fastify.post('/customers/:id/excluir', soAdmin, excluirClienteHandler);
}
