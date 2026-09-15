import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getCustomers,
  createCustomer,
  atualizarTabelaDoCliente,
  obterCliente,
  marcarInatividade,
  marcarVarejo,
  atrelarCodigoErp,
} from './customers.service.js';
import { z } from 'zod';
import { resolverTabelaEscolhida } from '../reps/reps.service.js';
import { parseBody } from '../../lib/validation.js';
import { avisarClienteNovoParaIncluir } from '../push/push.avisos.js';
import {
  createCustomerSchema,
  trocarTabelaDoClienteSchema,
  atrelarCodigoErpSchema,
} from './customers.schema.js';

const inatividadeSchema = z.object({
  motivo: z.string().trim().min(2).max(200),
  observacao: z.string().trim().max(2000).optional(),
});

const varejoSchema = z.object({ varejo: z.boolean() });

export async function listCustomers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { search, include_blocked } = request.query as {
    search?: string;
    include_blocked?: string;
  };

  const customers = await getCustomers(
    company_id,
    role,
    rep_id,
    search,
    include_blocked !== 'false',
    erp_rep_id,
  );
  await reply.send({ data: customers });
}

/**
 * A ficha de um cliente: cadastro, tabela e histórico.
 *
 * 404 tanto para cliente inexistente quanto para cliente de outra carteira —
 * distinguir os dois contaria ao representante que a loja existe e é de outro.
 */
export async function getCustomerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };

  const cliente = await obterCliente(company_id, id, {
    rep_id,
    erp_rep_id: erp_rep_id ?? null,
    irrestrito:
      role === 'manager' || role === 'admin' || role === 'financeiro' || role === 'relacionamento',
  });

  if (!cliente) {
    await reply.status(404).send({
      error: 'Cliente não encontrado na sua carteira',
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    return;
  }
  await reply.send({ data: cliente });
}

/**
 * Traduz a recusa do resolvedor em resposta.
 *
 * O 403 não diz se a tabela existe: quem pediu uma tabela que não é dele está
 * chamando a API por fora da tela, e a resposta não é lugar de confirmar que a
 * tabela da região vizinha existe.
 */
async function recusarTabela(
  reply: FastifyReply,
  motivo: 'fora_do_conjunto' | 'escolha_obrigatoria',
): Promise<void> {
  if (motivo === 'escolha_obrigatoria') {
    await reply.status(400).send({
      error: 'Escolha a tabela de preço.',
      code: 'PRICE_TABLE_REQUIRED',
      statusCode: 400,
    });
    return;
  }
  await reply.status(403).send({
    error: 'Esta tabela de preço não está disponível para você.',
    code: 'FORBIDDEN',
    statusCode: 403,
  });
}

export async function createCustomerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role } = request.user;
  const body = await parseBody(createCustomerSchema, request.body, reply);
  if (!body) return;

  const tabela = await resolverTabelaEscolhida(company_id, rep_id, role, body.price_table_id);
  if (!tabela.ok) {
    await recusarTabela(reply, tabela.motivo);
    return;
  }

  const customer = await createCustomer(
    company_id,
    rep_id,
    {
      name: body.name,
      trade_name: body.trade_name ?? null,
      cnpj: body.cnpj,
      inscricao_estadual: body.inscricao_estadual ?? null,
      cep: body.cep,
      logradouro: body.logradouro,
      numero: body.numero,
      complemento: body.complemento ?? null,
      bairro: body.bairro,
      cidade: body.cidade,
      uf: body.uf,
      whatsapp: body.whatsapp ?? null,
      email: body.email ?? null,
      observacoes: body.observacoes ?? null,
    },
    tabela.price_table_id,
  );
  if ('duplicado' in customer) {
    const d = customer.duplicado;
    // Cliente de OUTRA carteira: o representante não o enxerga na lista dele,
    // então dizer o nome e o código não o ajuda em nada e entrega o cadastro
    // do colega. O que resolve é o escritório transferir — e é isso que a
    // mensagem manda fazer. Escritório continua vendo tudo, porque é quem vai
    // procurar o cadastro.
    const daCarteiraDele = role === 'rep' && d.rep_id !== rep_id;
    await reply.status(409).send({
      error: daCarteiraDele
        ? 'Este CPF/CNPJ já está cadastrado na empresa, em outra carteira. Fale com o escritório para transferir o cliente.'
        : `Este CPF/CNPJ já está cadastrado: ${d.name}${d.erp_id ? ` (cód. ${d.erp_id})` : ''}`,
      code: 'CLIENTE_DUPLICADO',
      statusCode: 409,
    });
    return;
  }
  if ('erro' in customer) {
    await reply.status(500).send({
      error: `Não foi possível criar o cliente: ${customer.erro}`,
      code: 'CREATE_FAILED',
      statusCode: 500,
    });
    return;
  }
  // O cadastro novo CHEGA pra Larissa: ela inclui no Control e atrela o código.
  // Carona, nunca condição — o push falhando não desfaz o cadastro.
  avisarClienteNovoParaIncluir(company_id, { id: customer.id, name: customer.name }, rep_id);
  await reply.status(201).send({ data: customer });
}

/**
 * Troca a tabela de preço de um cliente que já existe — a maioria veio do ERP
 * com a tabela dele, e é aqui que o representante corrige.
 *
 * Duas travas independentes: a tabela pedida é do conjunto dele, e o cliente é
 * da carteira dele. Passar em uma só não basta.
 */
export async function trocarTabelaDoClienteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(trocarTabelaDoClienteSchema, request.body, reply);
  if (!body) return;

  const tabela = await resolverTabelaEscolhida(company_id, rep_id, role, body.price_table_id);
  if (!tabela.ok) {
    await recusarTabela(reply, tabela.motivo);
    return;
  }
  // O schema exige o campo, então o resolvedor nunca devolve null aqui.
  if (!tabela.price_table_id) {
    await recusarTabela(reply, 'fora_do_conjunto');
    return;
  }

  const resultado = await atualizarTabelaDoCliente(company_id, id, tabela.price_table_id, {
    rep_id,
    erp_rep_id: erp_rep_id ?? null,
    irrestrito: role === 'manager' || role === 'admin' || role === 'financeiro',
  });

  if (!resultado.ok) {
    if (resultado.motivo === 'cliente_nao_encontrado') {
      await reply.status(404).send({
        error: 'Cliente não encontrado na sua carteira',
        code: 'NOT_FOUND',
        statusCode: 404,
      });
      return;
    }
    await reply.status(500).send({
      error: 'Não foi possível trocar a tabela',
      code: 'UPDATE_FAILED',
      statusCode: 500,
    });
    return;
  }

  await reply.send({ data: resultado.cliente });
}

/** O porquê do cliente vermelho: motivo + observação de quem apurou. */
/**
 * PATCH /customers/:id/varejo — só a VENDA INTERNA marca o cliente de balcão
 * como varejo, para ele sair da cobrança de contato (migração 047).
 *
 * Pedido do Yan (15/09/2026): "apenas as vendedoras internas". A rota já só
 * deixa entrar representante; aqui fica de fora o representante comum — ele
 * não atende balcão, e um toque dele sumiria com um cliente de verdade da régua.
 */
export async function marcarVarejoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, erp_rep_id, venda_interna } = request.user;
  if (role !== 'rep' || venda_interna !== true) {
    await reply.status(403).send({
      error: 'Só a venda interna marca cliente de varejo',
      code: 'SO_VENDA_INTERNA',
      statusCode: 403,
    });
    return;
  }
  const { id } = request.params as { id: string };
  const body = await parseBody(varejoSchema, request.body, reply);
  if (!body) return;

  const r = await marcarVarejo(company_id, id, { rep_id: sub, erp_rep_id: erp_rep_id ?? null }, sub, body.varejo);

  if (r.ok) {
    await reply.send({ data: { varejo: r.varejo, varejo_marcado_em: r.marcado_em } });
    return;
  }
  if (r.motivo === 'sem_migracao') {
    await reply.status(503).send({
      error: 'A marca de cliente varejo precisa da migração 047',
      code: 'VAREJO_INDISPONIVEL',
      statusCode: 503,
    });
    return;
  }
  if (r.motivo === 'cliente_nao_encontrado') {
    await reply.status(404).send({
      error: 'Cliente não encontrado na sua carteira',
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    return;
  }
  await reply.status(500).send({
    error: 'Não foi possível salvar a marca de varejo',
    code: 'UPDATE_FAILED',
    statusCode: 500,
  });
}

export async function marcarInatividadeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(inatividadeSchema, request.body, reply);
  if (!body) return;

  const r = await marcarInatividade(
    company_id,
    id,
    {
      rep_id,
      erp_rep_id: erp_rep_id ?? null,
      // O rep explica os clientes DELE; relacionamento e gerência, qualquer um.
      irrestrito: role === 'manager' || role === 'admin' || role === 'relacionamento',
    },
    rep_id,
    body,
  );

  if (r.ok) {
    await reply.send({ data: { ok: true } });
    return;
  }
  if (r.motivo === 'sem_migracao') {
    await reply.status(503).send({
      error: 'O controle de inatividade precisa da migração 039',
      code: 'INATIVIDADE_INDISPONIVEL',
      statusCode: 503,
    });
    return;
  }
  if (r.motivo === 'cliente_nao_encontrado') {
    await reply.status(404).send({
      error: 'Cliente não encontrado na sua carteira',
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    return;
  }
  await reply.status(500).send({
    error: 'Não foi possível salvar o motivo',
    code: 'UPDATE_FAILED',
    statusCode: 500,
  });
}

/** O financeiro atrela o número do Control a um cliente nascido no app. */
export async function atrelarCodigoErpHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(atrelarCodigoErpSchema, request.body, reply);
  if (!body) return;

  const r = await atrelarCodigoErp(company_id, id, body.erp_id, sub);
  if (r.ok) {
    await reply.send({ data: { erp_id: r.erp_id } });
    return;
  }
  const respostas: Record<typeof r.motivo, { status: number; error: string; code: string }> = {
    codigo_invalido: {
      status: 422,
      error: 'Código inválido — o Control usa até 5 números, sem letras (ex.: 05836)',
      code: 'CODIGO_INVALIDO',
    },
    cliente_nao_encontrado: { status: 404, error: 'Cliente não encontrado', code: 'NOT_FOUND' },
    ja_tem_codigo: { status: 409, error: 'Este cliente já tem código do ERP — quem muda é o Control', code: 'JA_TEM_CODIGO' },
    codigo_em_uso: { status: 409, error: `Este código já é de outro cliente: ${r.detalhe ?? ''}`, code: 'CODIGO_EM_USO' },
    erro: { status: 500, error: `Não foi possível atrelar o código: ${r.detalhe ?? ''}`, code: 'UPDATE_FAILED' },
  };
  const resp = respostas[r.motivo];
  await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
}
