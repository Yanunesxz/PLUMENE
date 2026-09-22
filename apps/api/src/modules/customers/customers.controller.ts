import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getCustomers,
  createCustomer,
  atualizarTabelaDoCliente,
  obterCliente,
  marcarInatividade,
  marcarVarejo,
  marcarInativo,
  atrelarCodigoErp,
} from './customers.service.js';
import { excluirCliente, lerVinculosParaExcluir } from './customers.exclusao.service.js';
import { editarCadastroDoCliente } from './customers.edicao.service.js';
import { confirmarAlteracoesNoControl, listarClientesComAlteracaoPendente } from './customers.alteracoes.service.js';
import { z } from 'zod';
import {
  editaQualquerCliente,
  podeTrocarDocumentoDoCliente,
  primeiroErroDaEdicao,
  CHAVES_DE_MOTIVO,
  motivoExigeNota,
} from '@csb/shared';
import type { AlteracoesPendentesResponse, AvisadosDaAlteracao } from '@csb/shared';
import { resolverTabelaEscolhida } from '../reps/reps.service.js';
import { parseBody } from '../../lib/validation.js';
import { lerCanais } from '../../lib/canais.js';
import { avisarCadastroAlteradoNoControl, avisarClienteNovoParaIncluir } from '../push/push.avisos.js';
import {
  createCustomerSchema,
  trocarTabelaDoClienteSchema,
  atrelarCodigoErpSchema,
  excluirClienteSchema,
  idDeClienteSchema,
  editarCadastroDoClienteSchema,
  confirmarAlteracoesDoClienteSchema,
} from './customers.schema.js';

const inatividadeSchema = z.object({
  motivo: z.string().trim().min(2).max(200),
  observacao: z.string().trim().max(2000).optional(),
});

const varejoSchema = z.object({ varejo: z.boolean() });

// Marcar inativo exige motivo da lista (as chaves do CRM); "outro" exige nota.
// Desmarcar não leva nada. Sem texto livre no motivo — pedido literal do Yan.
const inativoSchema = z
  .object({
    inativo: z.boolean(),
    motivo: z.enum(CHAVES_DE_MOTIVO).optional(),
    nota: z.string().trim().max(300).optional(),
  })
  .superRefine((b, ctx) => {
    if (!b.inativo) return;
    if (!b.motivo) ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Escolha o motivo' });
    if (motivoExigeNota(b.motivo) && !b.nota) {
      ctx.addIssue({ code: 'custom', path: ['nota'], message: 'Diga em poucas palavras qual é o outro motivo' });
    }
  });

export async function listCustomers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { search, include_blocked, cnpj } = request.query as {
    search?: string;
    include_blocked?: string;
    /** Só os clientes com este documento (dígitos ou máscara). */
    cnpj?: string;
  };

  const customers = await getCustomers(
    company_id,
    role,
    rep_id,
    search,
    include_blocked !== 'false',
    erp_rep_id,
    typeof cnpj === 'string' ? cnpj : null,
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

/**
 * PATCH /customers/:id/inativo — o cliente que não compra mais sai da régua
 * inteira (migração 052). Rep na própria carteira; relacionamento e gerência
 * em qualquer uma — os mesmos que explicam o cliente esfriado (039).
 */
export async function marcarInativoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(inativoSchema, request.body, reply);
  if (!body) return;

  const r = await marcarInativo(
    company_id,
    id,
    {
      rep_id: sub,
      erp_rep_id: erp_rep_id ?? null,
      irrestrito: role === 'manager' || role === 'admin' || role === 'relacionamento',
    },
    sub,
    body,
  );

  if (r.ok) {
    await reply.send({
      data: { inativo: r.inativo, inativo_motivo: r.motivo, inativo_nota: r.nota, inativo_marcado_em: r.marcado_em },
    });
    return;
  }
  if (r.motivo === 'sem_migracao') {
    await reply.status(503).send({
      error: 'A marca de cliente inativo precisa da migração 052',
      code: 'INATIVO_INDISPONIVEL',
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
  if (r.motivo === 'nao_esfriado') {
    await reply.status(409).send({
      error: 'Só cliente esfriado pode ser marcado como inativo',
      code: 'CLIENTE_NAO_ESFRIADO',
      statusCode: 409,
    });
    return;
  }
  await reply.status(500).send({
    error: 'Não foi possível salvar o cliente inativo',
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

// ─── Excluir cliente (só admin) ──────────────────────────────────────────────

async function clienteNaoEncontrado(reply: FastifyReply): Promise<void> {
  await reply.status(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND', statusCode: 404 });
}

/**
 * GET /customers/:id/vinculos — o que o diálogo de exclusão mostra antes de o
 * admin confirmar: quantos pedidos, logins, convites, vitrines e tarefas.
 */
export async function vinculosDoClienteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };
  if (!idDeClienteSchema.safeParse(id).success) {
    await clienteNaoEncontrado(reply);
    return;
  }

  const r = await lerVinculosParaExcluir(company_id, id);
  if (r.ok) {
    await reply.send({ data: r.vinculos });
    return;
  }
  if (r.motivo === 'cliente_nao_encontrado') {
    await clienteNaoEncontrado(reply);
    return;
  }
  await reply.status(500).send({
    error: 'Não foi possível contar os vínculos do cliente. Tente de novo.',
    code: 'LEITURA_FALHOU',
    statusCode: 500,
  });
}

/**
 * POST /customers/:id/excluir — só admin (a rota barra os outros papéis).
 *
 * Cliente com pedido, login de loja, convite, vitrine ou tarefa só sai juntado
 * em outro cadastro da empresa (`juntar_em`). A cópia vai para
 * deleted_customers antes; sem a migração 050, nada acontece.
 */
export async function excluirClienteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, name } = request.user;
  const { id } = request.params as { id: string };
  if (!idDeClienteSchema.safeParse(id).success) {
    await clienteNaoEncontrado(reply);
    return;
  }
  const body = await parseBody(excluirClienteSchema, request.body ?? {}, reply);
  if (!body) return;

  const r = await excluirCliente(company_id, id, body, { id: sub, nome: name });
  if (r.ok) {
    await reply.send({ data: r.resultado });
    return;
  }

  switch (r.motivo) {
    case 'migracao_pendente':
      await reply.status(409).send({
        error: 'Excluir cliente precisa da migração 050 aplicada no banco. Nada foi alterado.',
        code: 'MIGRACAO_PENDENTE',
        statusCode: 409,
      });
      return;
    case 'banco_indisponivel':
      await reply.status(503).send({
        error: 'O banco não respondeu. Nada foi alterado — tente de novo em instantes.',
        code: 'BANCO_INDISPONIVEL',
        statusCode: 503,
      });
      return;
    case 'cliente_nao_encontrado':
      await clienteNaoEncontrado(reply);
      return;
    case 'juntar_em_invalido':
      await reply.status(400).send({
        error: 'O cadastro que fica precisa ser outro cliente desta empresa.',
        code: 'JUNTAR_EM_INVALIDO',
        statusCode: 400,
      });
      return;
    case 'com_vinculos':
      await reply.status(409).send({
        error:
          'Este cliente tem pedidos, login, convites, vitrines ou tarefas. Escolha o cadastro que fica com eles.',
        code: 'CLIENTE_COM_VINCULOS',
        statusCode: 409,
        contagens: r.contagens,
      });
      return;
    case 'erro':
      await reply.status(500).send({
        error: `Não foi possível excluir o cliente. Nada foi alterado. (${r.detalhe})`,
        code: 'EXCLUSAO_FALHOU',
        statusCode: 500,
        desfeito: true,
      });
      return;
    case 'falhou_no_meio':
      await reply.status(500).send({
        error: r.desfeito
          ? `Não foi possível excluir o cliente. O que já tinha mudado foi desfeito. (${r.detalhe})`
          : `A exclusão falhou no meio e nem tudo pôde ser desfeito — avise o suporte. (${r.detalhe})`,
        code: 'EXCLUSAO_FALHOU',
        statusCode: 500,
        desfeito: r.desfeito,
      });
      return;
  }
}

// ─── Editar o cadastro (051) ─────────────────────────────────────────────────

/**
 * PATCH /customers/:id/cadastro — editar o cadastro do cliente.
 *
 * "Não tem como alterar esses dados nem sendo admin lá dentro. Quero poder
 * mudar sim, e quando mudar lá tem que mudar no ERP do Fábio também." (Yan,
 * 17/09/2026)
 *
 * Quem entra a rota decide (rep, gerente, admin, financeiro). Aqui ficam as
 * duas outras travas: o representante (e a venda interna) só edita cliente da
 * PRÓPRIA carteira — fora dela é 404, como na ficha —, e o CPF/CNPJ só o
 * escritório troca (admin e financeiro).
 *
 * Deu certo e o cliente já está no Control: o financeiro é avisado por push —
 * menos quando o canal de cadastro da empresa é a API, em que o Control puxa a
 * mudança sozinho. O aviso é carona: falhando, a edição continua salva, e a
 * resposta diz para onde ele saiu.
 */
export async function editarCadastroDoClienteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, erp_rep_id, name } = request.user;
  const { id } = request.params as { id: string };
  if (!idDeClienteSchema.safeParse(id).success) {
    await reply.status(404).send({ error: 'Cliente não encontrado na sua carteira', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  const body = await parseBody(editarCadastroDoClienteSchema, request.body, reply);
  if (!body) return;

  // O documento é a chave do cliente entre o app e o Control: trocado errado,
  // a nota sai no nome de outra empresa. Recusa antes de ler qualquer coisa.
  if (body.novo.cnpj !== undefined && !podeTrocarDocumentoDoCliente(role)) {
    await reply.status(403).send({
      error: 'Só o financeiro ou o administrador trocam o CPF/CNPJ do cliente',
      code: 'DOCUMENTO_SO_ESCRITORIO',
      statusCode: 403,
    });
    return;
  }

  const escopo = { rep_id: sub, erp_rep_id: erp_rep_id ?? null, irrestrito: editaQualquerCliente(role) };
  const r = await editarCadastroDoCliente(company_id, id, body, escopo, { id: sub, nome: name });

  if (r.ok) {
    if (r.sem_mudanca) {
      if (!r.detalhe) {
        await reply.status(404).send({ error: 'Cliente não encontrado na sua carteira', code: 'NOT_FOUND', statusCode: 404 });
        return;
      }
      await reply.send({ data: r.detalhe, sem_mudanca: true });
      return;
    }

    // Com o canal de cadastro na API, o Control puxa a edição pelo GET
    // ?desde= — push seria ruído. Sem conseguir ler o canal, avisa: um push a
    // mais custa menos que uma mudança que ninguém leva ao Control.
    let control_puxa_pela_api = false;
    if (r.alteracao.erp_pendente) {
      try {
        control_puxa_pela_api = (await lerCanais(company_id)).cadastro === 'api';
      } catch (err) {
        console.error('[editar-cadastro] não deu para ler o canal de cadastro; o financeiro é avisado mesmo assim:', err);
      }
    }
    let avisados: AvisadosDaAlteracao | null = null;
    if (r.alteracao.erp_pendente && !control_puxa_pela_api) {
      avisados = await avisarCadastroAlteradoNoControl(company_id, r.cliente, Object.keys(r.alteracao.campos), sub);
    }

    // Gravou e registrou, mas a releitura da ficha falhou (a leitura do detalhe
    // engole o erro do banco e devolve nulo). Responder 404 "não encontrado"
    // diria que nada aconteceu — e a pessoa, achando que perdeu a edição,
    // digitaria tudo de novo. O aviso ao financeiro já saiu acima: a edição
    // está pendente de qualquer jeito.
    if (!r.detalhe) {
      await reply.status(500).send({
        error: 'O cadastro foi salvo, mas não deu para recarregar a ficha. Feche e abra a ficha de novo para ver os dados.',
        code: 'SALVO_SEM_RELER_A_FICHA',
        statusCode: 500,
        alteracao: r.alteracao,
        erp_pendente: r.alteracao.erp_pendente,
        control_puxa_pela_api,
        avisados,
      });
      return;
    }

    await reply.send({
      data: r.detalhe,
      alteracao: r.alteracao,
      erp_pendente: r.alteracao.erp_pendente,
      control_puxa_pela_api,
      avisados,
    });
    return;
  }

  switch (r.motivo) {
    case 'migracao_051_pendente':
      await reply.status(503).send({
        error: 'Editar o cadastro precisa da migração 051 aplicada no banco (rode a 051). Nada foi alterado.',
        code: 'MIGRACAO_PENDENTE',
        statusCode: 503,
      });
      return;
    case 'migracao_041_pendente':
      await reply.status(503).send({
        error: 'Endereço, inscrição estadual e observações precisam da migração 041 aplicada no banco. Nada foi alterado.',
        code: 'MIGRACAO_PENDENTE',
        statusCode: 503,
      });
      return;
    case 'banco_indisponivel':
      await reply.status(503).send({
        error: 'O banco não respondeu. Nada foi alterado — tente de novo em instantes.',
        code: 'TENTE_DE_NOVO',
        statusCode: 503,
      });
      return;
    case 'cliente_nao_encontrado':
      await reply.status(404).send({ error: 'Cliente não encontrado na sua carteira', code: 'NOT_FOUND', statusCode: 404 });
      return;
    case 'mudou_de_novo':
      // A ficha de agora vai junto: a tela recarrega o formulário com ela.
      await reply.status(409).send({
        error: 'Alguém alterou este cadastro enquanto você editava. Confira os dados de agora e salve de novo.',
        code: 'MUDOU_DE_NOVO',
        statusCode: 409,
        campos: r.campos,
        data: r.detalhe,
      });
      return;
    case 'invalido':
      await reply.status(400).send({
        error: primeiroErroDaEdicao(r.erros) ?? 'Dados inválidos',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        campos: r.erros,
      });
      return;
    case 'documento_duplicado': {
      // Mesma política do cadastro novo: o nome de um cliente de outra
      // carteira não vai para o representante. (Hoje só o escritório troca
      // documento, mas a regra não pode depender disso.)
      const d = r.duplicado;
      const deOutraCarteira = role === 'rep' && d.rep_id !== sub;
      await reply.status(409).send({
        error: deOutraCarteira
          ? 'Este CPF/CNPJ já está cadastrado na empresa, em outra carteira. Fale com o escritório.'
          : `Este CPF/CNPJ já está cadastrado em outro cliente: ${d.name}${d.erp_id ? ` (cód. ${d.erp_id})` : ''}`,
        code: 'DOCUMENTO_DUPLICADO',
        statusCode: 409,
      });
      return;
    }
    case 'alteracao_nao_registrada':
      await reply.status(503).send({
        error: 'Não salvou: não deu para registrar a alteração para o Control. Nada foi alterado — tente de novo.',
        code: 'ALTERACAO_NAO_REGISTRADA',
        statusCode: 503,
      });
      return;
    case 'sem_historico':
      await reply.status(500).send({
        error: 'O cadastro foi alterado, mas o registro para o Control falhou e não deu para desfazer — avise o suporte.',
        code: 'ALTERACAO_SEM_HISTORICO',
        statusCode: 500,
      });
      return;
    case 'gravacao_incerta':
      // O banco não confirmou nem desmentiu a gravação (17/09/2026). "Nada foi
      // alterado" seria mentira se ela ficou — e a pessoa, tentando de novo por
      // cima, levaria um 409 "alguém alterou" pela própria edição.
      await reply.status(503).send({
        error:
          'O banco não confirmou se o cadastro foi salvo. Feche e abra a ficha para conferir antes de salvar de novo.',
        code: 'GRAVACAO_NAO_CONFIRMADA',
        statusCode: 503,
      });
      return;
    case 'erro':
      await reply.status(500).send({
        error: `Não foi possível salvar o cadastro. Nada foi alterado. (${r.detalhe})`,
        code: 'UPDATE_FAILED',
        statusCode: 500,
      });
      return;
  }
}

/**
 * GET /customers/alteracoes-pendentes — a fila "Cadastros alterados para
 * atualizar no Control" da Minha área (financeiro, admin e gerente).
 * Sem a 051: lista vazia com `migracao_pendente: true`.
 */
export async function alteracoesPendentesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const r = await listarClientesComAlteracaoPendente(company_id);
  if (r.ok) {
    const resposta: AlteracoesPendentesResponse = { data: r.clientes, migracao_pendente: r.migracao_pendente };
    await reply.send(resposta);
    return;
  }
  if (r.motivo === 'banco_indisponivel') {
    await reply.status(503).send({
      error: 'O banco não respondeu. Tente de novo em instantes.',
      code: 'TENTE_DE_NOVO',
      statusCode: 503,
    });
    return;
  }
  await reply.status(500).send({
    error: 'Não foi possível ler os cadastros alterados. Tente de novo.',
    code: 'LEITURA_FALHOU',
    statusCode: 500,
  });
}

/**
 * POST /customers/:id/alteracoes/confirmar — "Já atualizei no Control" (só
 * financeiro e admin, pela rota). Marca apenas os ids que vieram, ainda
 * pendentes, deste cliente.
 */
export async function confirmarAlteracoesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, name } = request.user;
  const { id } = request.params as { id: string };
  if (!idDeClienteSchema.safeParse(id).success) {
    await clienteNaoEncontrado(reply);
    return;
  }
  const body = await parseBody(confirmarAlteracoesDoClienteSchema, request.body, reply);
  if (!body) return;

  const r = await confirmarAlteracoesNoControl(company_id, id, body.ids, { id: sub, nome: name });
  if (r.ok) {
    await reply.send({ data: { confirmadas: r.confirmadas, alteracoes: r.alteracoes } });
    return;
  }
  switch (r.motivo) {
    case 'migracao_pendente':
      await reply.status(503).send({
        error: 'Confirmar alteração precisa da migração 051 aplicada no banco (rode a 051).',
        code: 'MIGRACAO_PENDENTE',
        statusCode: 503,
      });
      return;
    case 'banco_indisponivel':
      await reply.status(503).send({
        error: 'O banco não respondeu. Nada foi confirmado — tente de novo em instantes.',
        code: 'TENTE_DE_NOVO',
        statusCode: 503,
      });
      return;
    case 'cliente_nao_encontrado':
      await clienteNaoEncontrado(reply);
      return;
    case 'confirmacao_incerta':
      // O banco não confirmou nem desmentiu a baixa (17/09/2026). "Nada foi
      // marcado" seria mentira se ela ficou — a mesma regra do
      // GRAVACAO_NAO_CONFIRMADA da edição do cadastro.
      await reply.status(503).send({
        error: 'O banco não confirmou a baixa. Abra a ficha de novo para conferir antes de marcar outra vez.',
        code: 'CONFIRMACAO_NAO_CONFIRMADA',
        statusCode: 503,
      });
      return;
    case 'erro':
      await reply.status(500).send({
        error: 'Não foi possível confirmar. Nada foi marcado — tente de novo.',
        code: 'UPDATE_FAILED',
        statusCode: 500,
      });
      return;
  }
}
