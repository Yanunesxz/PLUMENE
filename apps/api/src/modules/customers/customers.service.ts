import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import type {
  CustomerListItem,
  CreateCustomerRequest,
  CustomerDetail,
  DonoDoCliente,
  PedidoDoCliente,
} from '@csb/shared';
import type { AuthRole } from '@csb/shared';
import {
  documento,
  formatarDocumento,
  linhaDeEndereco,
  apenasDigitos,
  codigoMiolo,
  frescorPorDias,
  diasSemComprar,
} from '@csb/shared';
import { lerAlteracoesDoCliente } from './customers.alteracoes.service.js';
import { lerRegua } from '../company/carteira.service.js';

// O PostgREST devolve no máximo 1000 linhas por requisição. Gerente/admin podem
// ter milhares de clientes, então paginamos em blocos até pegar todos.
const PAGE_SIZE = 1000;

// Só o que as telas usam. `select('*')` + o embed da tabela de preço (que nada
// no app lia) tornava a lista de 1.353 clientes ~5× maior do que precisa.
// `rep_id` entra porque separa as duas famílias de cliente sem código do ERP:
// quem nasceu no app (fila da Larissa) e quem veio das cargas da Curva ABC (já
// está no Control, só chegou sem código). Ver CustomerListItem.
const CUSTOMER_COLUMNS =
  'id, name, trade_name, cnpj, blocked, block_reason, credit_limit, whatsapp, price_table_id, erp_id, rep_id';

/**
 * As colunas da carteira inteligente vêm da migração 036 — pedi-las antes do
 * SQL rodar derrubaria a lista INTEIRA de clientes. Sem elas, os selos de
 * frescor simplesmente não aparecem, que é o comportamento de antes.
 */
async function detectarHistoricoDeCompra(): Promise<boolean> {
  return detectar('customers', 'last_purchase_at');
}

/** A marca de cliente de varejo (migração 047). */
export async function detectarVarejo(): Promise<boolean> {
  return detectar('customers', 'varejo');
}

/** O cliente inativo (migração 052). */
export async function detectarInativo(): Promise<boolean> {
  return detectar('customers', 'inativo');
}

/** Mesmo padrão para as colunas do controle de inatividade (migração 039). */
async function detectarInatividade(): Promise<boolean> {
  return detectar('customers', 'inactivity_reason');
}

/** E para o cadastro real (migração 041): endereço estruturado, IE, observações, cnpj_digits. */
async function detectarCadastroReal(): Promise<boolean> {
  return detectar('customers', 'cep');
}

const COLUNAS_DO_CADASTRO_REAL =
  'cep, logradouro, numero, complemento, bairro, cidade, uf, inscricao_estadual, observacoes, erp_linked_at';

async function colunasDaLista(): Promise<string> {
  let colunas = CUSTOMER_COLUMNS;
  if (await detectarHistoricoDeCompra()) colunas += ', last_purchase_at, overdue_amount';
  if (await detectarInatividade()) colunas += ', inactivity_reason';
  if (await detectarVarejo()) colunas += ', varejo';
  if (await detectarInativo()) colunas += ', inativo, inativo_motivo';
  return colunas;
}

export async function getCustomers(
  company_id: string,
  role: AuthRole,
  rep_id: string,
  search?: string,
  include_blocked = true,
  erp_rep_id?: string | null,
  cnpj?: string | null,
): Promise<CustomerListItem[]> {
  // Sanitiza o termo de busca: vírgula/parênteses/barra têm significado no
  // filtro `.or()` do PostgREST e quebrariam a query se digitados.
  const term = search ? search.replace(/[,()\\]/g, ' ').trim() : '';

  // O mesmo documento (o diálogo de excluir cliente procura o cadastro em
  // dobro). Pedido sem dígito nenhum não vira "a carteira inteira": não casa
  // com ninguém.
  const doc = cnpj != null ? apenasDigitos(cnpj) : null;
  if (doc === '') return [];
  const temDigitos = doc ? await detectarCadastroReal() : false;

  const colunas = await colunasDaLista();
  const all: CustomerListItem[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('customers')
      .select(colunas)
      .eq('company_id', company_id)
      .order('name')
      .range(from, from + PAGE_SIZE - 1);

    // Carteira do representante = clientes que ELE cadastrou no app (rep_id) +
    // os que o ERP atribuiu ao código dele (rep_erp_id). Sem a segunda metade o
    // rep enxergava só o punhado que digitou à mão — os 1.3 mil vindos do ERP
    // ficavam invisíveis porque chegam com rep_id nulo.
    if (role === 'rep') {
      query = erp_rep_id
        ? query.or(`rep_id.eq.${rep_id},rep_erp_id.eq.${erp_rep_id}`)
        : query.eq('rep_id', rep_id);
    }
    if (!include_blocked) query = query.eq('blocked', false);
    if (term) query = query.or(`name.ilike.%${term}%,cnpj.ilike.%${term}%`);
    // Com a 041, `cnpj_digits` enxerga máscara e dígitos como o mesmo
    // documento; sem ela, as duas grafias que as cargas gravaram.
    if (doc) query = temDigitos ? query.eq('cnpj_digits', doc) : query.in('cnpj', [doc, formatarDocumento(doc)]);

    const { data, error } = await query;
    if (error || !data) break;
    // `as unknown`: o select dinâmico (com/sem as colunas da 036) tira do
    // supabase-js a inferência do shape.
    all.push(...(data as unknown as CustomerListItem[]));
    if (data.length < PAGE_SIZE) break; // última página
  }

  return all;
}

/** O cadastro recusado porque o documento já está na base — com quem ele é. */
export interface ClienteDuplicado {
  duplicado: { id: string; name: string; erp_id: string | null; rep_id: string | null };
}

/**
 * Acha o cliente que já tem este CPF/CNPJ, se houver.
 *
 * Com a 041, `cnpj_digits` é gerada pelo banco e enxerga "22.518.613/0001-58"
 * e "22518613000158" como o mesmo documento. Sem a 041, cobre as duas formas
 * mais comuns (só dígitos e a máscara padrão) — o que as cargas gravaram.
 *
 * `exceto_id`: a edição do cadastro (17/09/2026) procura o documento em OUTRO
 * cliente. Sem excluir o próprio, trocar a máscara de um documento — ou
 * qualquer cliente que já tenha o documento — acharia a si mesmo como
 * duplicado.
 *
 * Engole o erro do banco (erro = "ninguém tem"): é o comportamento de sempre do
 * cadastro novo. Quem não pode confundir as duas coisas usa
 * `buscarClienteComOMesmoDocumento`.
 */
export async function clienteComOMesmoDocumento(
  company_id: string,
  digitos: string,
  exceto_id?: string,
): Promise<ClienteDuplicado['duplicado'] | null> {
  return (await buscarClienteComOMesmoDocumento(company_id, digitos, exceto_id)).duplicado;
}

/**
 * A mesma busca, sem engolir o erro do banco (revisão de 17/09/2026). Na troca
 * de documento pela edição do cadastro ela é a ÚNICA trava contra CPF/CNPJ
 * repetido — o índice de `cnpj_digits` da 041 não é UNIQUE —, e um timeout
 * nesta leitura lido como "ninguém tem" gravava duas lojas da mesma empresa com
 * o mesmo documento, com a troca indo para a fila do Control.
 */
export async function buscarClienteComOMesmoDocumento(
  company_id: string,
  digitos: string,
  exceto_id?: string,
): Promise<{ duplicado: ClienteDuplicado['duplicado'] | null; error: { message: string } | null }> {
  // A detecção vem ANTES de montar a consulta: é uma leitura à parte no banco,
  // e a ordem das leituras é o contrato que o teste (e o fake) enxergam.
  const temDigitos = await detectarCadastroReal();
  let consulta = supabase
    .from('customers')
    .select('id, name, erp_id, rep_id')
    .eq('company_id', company_id)
    .limit(1);
  if (exceto_id) consulta = consulta.neq('id', exceto_id);
  consulta = temDigitos
    ? consulta.eq('cnpj_digits', digitos)
    : consulta.in('cnpj', [digitos, formatarDocumento(digitos)]);
  const { data, error } = await consulta;
  if (error) return { duplicado: null, error: { message: error.message } };
  const achado = (Array.isArray(data) ? data : [])[0] as ClienteDuplicado['duplicado'] | undefined;
  return { duplicado: achado ?? null, error: null };
}

/**
 * O cliente nasce no app do jeito que o Control o quer (Yan, 10/09/2026):
 * documento válido e normalizado (só dígitos), endereço em campos, e a linha
 * `address` montada deles — a planilha do Control e as telas antigas leem a
 * linha. Duplicidade por documento é recusada com o nome de quem já tem.
 */
export async function createCustomer(
  company_id: string,
  rep_id: string,
  body: CreateCustomerRequest,
  price_table_id: string | null,
): Promise<CustomerListItem | { erro: string } | ClienteDuplicado> {
  // O documento só em dígitos. Sem documento válido (cargas antigas chamando o
  // service direto) grava o que veio, aparado — o schema da rota é quem obriga.
  const doc = documento(body.cnpj);
  const cnpj = doc ? doc.digitos : body.cnpj?.trim() || null;

  if (doc) {
    const existente = await clienteComOMesmoDocumento(company_id, doc.digitos);
    if (existente) return { duplicado: existente };
  }

  const endereco = {
    cep: apenasDigitos(body.cep) || null,
    logradouro: body.logradouro?.trim() || null,
    numero: body.numero?.trim() || null,
    complemento: body.complemento?.trim() || null,
    bairro: body.bairro?.trim() || null,
    cidade: body.cidade?.trim() || null,
    uf: body.uf?.trim().toUpperCase() || null,
  };
  const temCampos = Object.values(endereco).some(Boolean);
  const address = temCampos ? linhaDeEndereco(endereco) : body.address?.trim() || null;

  const linha: Record<string, unknown> = {
    company_id,
    rep_id,
    name: body.name.trim(),
    trade_name: body.trade_name?.trim() || null,
    cnpj,
    whatsapp: body.whatsapp?.trim() || null,
    email: body.email?.trim() || null,
    address,
    price_table_id,
    blocked: false,
  };
  // As colunas da 041 só vão se existem — sem o SQL aplicado o cadastro segue
  // funcionando como antes (linha única), em vez de derrubar o POST inteiro.
  if (await detectarCadastroReal()) {
    Object.assign(linha, endereco, {
      inscricao_estadual: body.inscricao_estadual?.trim() || null,
      observacoes: body.observacoes?.trim() || null,
    });
  }

  const { data, error } = await supabase.from('customers').insert(linha).select(CUSTOMER_COLUMNS).single();

  // O motivo do banco viaja na resposta, como no onboarding. Sem ele, um schema
  // fora do lugar numa instalação nova vira "não foi possível" mudo — foi
  // preciso uma semana de cegueira com a Simone (Plumene) para aprender isso.
  if (error || !data) return { erro: error?.message ?? 'insert sem retorno' };
  return data as CustomerListItem;
}

/**
 * O código do cliente no Control, como o app o guarda: 5 dígitos com zeros à
 * esquerda ("05836"). O Control exporta com "#" e as pessoas digitam sem os
 * zeros; os três são o mesmo cliente. Nulo = não é um código.
 *
 * LETRA é recusada, não descartada. Os 1.350 códigos da CS são cinco dígitos
 * e nada mais (conferido em 11/09/2026), mas jogar fora a letra de um "C0001"
 * digitado gravaria "00001" em silêncio — o cliente ficaria atrelado ao
 * cadastro errado, e ninguém descobriria antes do faturamento. Recusar é
 * barulhento; corromper, não.
 */
export function normalizarCodigoErp(v: string | null | undefined): string | null {
  const texto = (v ?? '').trim();
  if (/[a-z]/i.test(texto)) return null;
  const d = apenasDigitos(texto);
  if (!d || d.length > 5 || Number(d) === 0) return null;
  return d.padStart(5, '0');
}

export type AtrelamentoErp =
  | { ok: true; erp_id: string }
  | { ok: false; motivo: 'codigo_invalido' | 'cliente_nao_encontrado' | 'ja_tem_codigo' | 'codigo_em_uso' | 'erro'; detalhe?: string };

/**
 * O financeiro atrela o número do Control a um cliente nascido no app —
 * "esses números vão ter que ser incluídos e atrelados aos do sistema" (Yan,
 * 10/09/2026). Só em cliente SEM código: o que veio do ERP já tem o dele, e
 * trocar código de cliente do ERP é assunto do ERP. Recusa código que já é de
 * outro cliente, em qualquer grafia ("#2225", "2225", "02225").
 */
export async function atrelarCodigoErp(
  company_id: string,
  customer_id: string,
  codigoDigitado: string,
  quem: string,
): Promise<AtrelamentoErp> {
  const codigo = normalizarCodigoErp(codigoDigitado);
  if (!codigo) return { ok: false, motivo: 'codigo_invalido' };

  const { data: alvo } = await supabase
    .from('customers')
    .select('id, erp_id')
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!alvo) return { ok: false, motivo: 'cliente_nao_encontrado' };
  if ((alvo as { erp_id: string | null }).erp_id) return { ok: false, motivo: 'ja_tem_codigo' };

  const semZeros = String(Number(codigo));
  const { data: donos } = await supabase
    .from('customers')
    .select('id, name')
    .eq('company_id', company_id)
    .in('erp_id', [codigo, semZeros, `#${codigo}`, `#${semZeros}`])
    .limit(1);
  const dono = (donos ?? [])[0] as { id: string; name: string } | undefined;
  if (dono && dono.id !== customer_id) return { ok: false, motivo: 'codigo_em_uso', detalhe: dono.name };

  const update: Record<string, unknown> = { erp_id: codigo, updated_at: new Date().toISOString() };
  if (await detectarCadastroReal()) {
    update['erp_linked_by'] = quem;
    update['erp_linked_at'] = new Date().toISOString();
  }
  const { error } = await supabase
    .from('customers')
    .update(update)
    .eq('id', customer_id)
    .eq('company_id', company_id);
  if (error) return { ok: false, motivo: 'erro', detalhe: error.message };
  return { ok: true, erp_id: codigo };
}

/** De quem é a carteira, para as duas metades da regra abaixo. */
export interface EscopoDaCarteira {
  rep_id: string;
  erp_rep_id?: string | null;
  /** Gerente e admin passam por qualquer cliente da empresa. */
  irrestrito?: boolean;
}

/**
 * Busca um cliente DENTRO da carteira de quem pediu.
 *
 * A regra repete a de `getCustomers`: dono no app (`rep_id`) OU carteira do ERP
 * (`rep_erp_id`). Um representante que não enxerga o cliente na lista também
 * não pode abrir a ficha dele nem reprecificá-lo pela API — sem isto, trocar a
 * lista por uma chamada direta bastaria para contornar a carteira.
 */
async function clienteDaCarteira<T>(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
  colunas: string,
): Promise<T | null> {
  const { data } = await lerClienteDaCarteira<T>(company_id, customer_id, escopo, colunas);
  return data;
}

/**
 * A mesma busca, sem engolir o erro do banco. Para quem GRAVA depois de ler
 * (a edição do cadastro): "o banco não respondeu" não pode virar "cliente não
 * encontrado na sua carteira".
 */
export async function lerClienteDaCarteira<T>(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
  colunas: string,
): Promise<{ data: T | null; error: { message: string } | null }> {
  let consulta = supabase
    .from('customers')
    .select(colunas)
    .eq('id', customer_id)
    .eq('company_id', company_id);

  if (!escopo.irrestrito) {
    consulta = escopo.erp_rep_id
      ? consulta.or(`rep_id.eq.${escopo.rep_id},rep_erp_id.eq.${escopo.erp_rep_id}`)
      : consulta.eq('rep_id', escopo.rep_id);
  }

  const { data, error } = await consulta.maybeSingle();
  return { data: (data as T | null) ?? null, error: error ? { message: error.message } : null };
}

/** Histórico suficiente para a ficha sem varrer anos de pedido. */
const MAX_PEDIDOS_DA_FICHA = 50;

const DETALHE_COLUNAS =
  'id, name, trade_name, cnpj, whatsapp, email, address, credit_limit, blocked, block_reason, price_table_id';

/**
 * De quem é o cliente, pelos dois caminhos da carteira: o login que cadastrou
 * (`rep_id`) e o representante do código do Control (`rep_erp_id`).
 *
 * O código casa pelo MIOLO ("#779", "779" e "00779" são o mesmo
 * representante) — comparar a grafia deixava o dono sem nome sempre que a
 * carga do ERP e o cadastro do login escreveram diferente. Só representante
 * da MESMA empresa; havendo dois logins com o código, vale o ativo.
 *
 * Falha de leitura aqui não derruba a ficha: o nome só não aparece.
 */
async function donoDoCliente(
  company_id: string,
  rep_id: string | null,
  rep_erp_id: string | null,
): Promise<DonoDoCliente> {
  let rep_nome: string | null = null;
  if (rep_id) {
    const { data } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', rep_id)
      .eq('company_id', company_id)
      .maybeSingle();
    rep_nome = (data as { name: string } | null)?.name ?? null;
  }

  let rep_pelo_codigo_id: string | null = null;
  let rep_pelo_codigo_nome: string | null = null;
  const miolo = codigoMiolo(rep_erp_id);
  if (miolo) {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, erp_rep_id, active')
      .eq('company_id', company_id)
      .eq('role', 'rep')
      .not('erp_rep_id', 'is', null)
      .order('name');
    const reps = (!error && Array.isArray(data) ? data : []) as Array<{
      id: string;
      name: string;
      erp_rep_id: string | null;
      active: boolean | null;
    }>;
    const doCodigo = reps.filter((u) => codigoMiolo(u.erp_rep_id) === miolo);
    const escolhido = doCodigo.find((u) => u.active !== false) ?? doCodigo[0];
    rep_pelo_codigo_id = escolhido?.id ?? null;
    rep_pelo_codigo_nome = escolhido?.name ?? null;
  }

  return { rep_id, rep_nome, rep_erp_id, rep_pelo_codigo_id, rep_pelo_codigo_nome };
}

/** A ficha soma o que as migrações 036/039 trouxerem — sem elas, vem como antes. */
async function colunasDoDetalhe(): Promise<string> {
  // erp_id: a ficha mostra o número do Control (ou "sem código") — é o que o
  // financeiro atrela. cadastro real: os campos da 041, quando existem.
  // rep_id e rep_erp_id: viram o `dono` e saem da resposta como colunas soltas.
  let colunas = `${DETALHE_COLUNAS}, erp_id, rep_id, rep_erp_id`;
  if (await detectarCadastroReal()) colunas += `, ${COLUNAS_DO_CADASTRO_REAL}`;
  if (await detectarHistoricoDeCompra()) colunas += ', last_purchase_at';
  if (await detectarInatividade()) colunas += ', inactivity_reason, inactivity_note, inactivity_updated_at';
  if (await detectarVarejo()) colunas += ', varejo, varejo_marcado_em, varejo_marcado_por';
  if (await detectarInativo()) {
    colunas += ', inativo, inativo_motivo, inativo_nota, inativo_marcado_em, inativo_marcado_por, inativo_origem';
  }
  return colunas;
}

/**
 * A ficha do cliente: cadastro, tabela de preço e histórico de pedidos.
 *
 * Duas consultas, não mais: a ficha não mostra "o que mais compra", então não
 * há motivo para cruzar `order_items` e `products` de todos os pedidos como
 * faz a "Minha área" da loja.
 */
export async function obterCliente(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
): Promise<CustomerDetail | null> {
  return (await lerFichaDoCliente(company_id, customer_id, escopo)).data;
}

/**
 * A ficha, sem engolir o erro do banco na leitura do cliente (revisão de
 * 17/09/2026). É a regra de `lerClienteDaCarteira` para quem precisa dela
 * depois de gravar (ou de tentar): na edição do cadastro, a releitura que
 * falhava no meio de um 409 virava 404 "Cliente não encontrado na sua carteira"
 * — o representante lia que o cliente tinha saído da carteira dele, com o
 * cliente ainda lá e nada gravado.
 *
 * `error` só da leitura do cliente; o resto da ficha (pedidos, dono,
 * alterações) segue degradando como sempre.
 */
export async function lerFichaDoCliente(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
): Promise<{ data: CustomerDetail | null; error: { message: string } | null }> {
  const { data: lido, error } = await lerClienteDaCarteira<
    Omit<CustomerDetail, 'pedidos'> & {
      varejo_marcado_por?: string | null;
      inativo_marcado_por?: string | null;
      rep_id?: string | null;
      rep_erp_id?: string | null;
    }
  >(company_id, customer_id, escopo, await colunasDoDetalhe());
  if (error) return { data: null, error };
  if (!lido) return { data: null, error: null };

  // Quem marcou o varejo e quem marcou o inativo, pelo nome: a ficha diz
  // "marcado pela Simone" — sem isso o gerente vê o cliente fora da régua e
  // não sabe a quem perguntar. Uma consulta só para os dois.
  const { varejo_marcado_por, inativo_marcado_por, rep_id, rep_erp_id, ...cliente } = lido;
  const idsDeQuemMarcou = [varejo_marcado_por, inativo_marcado_por].filter((x): x is string => !!x);
  if (idsDeQuemMarcou.length) {
    const { data: quem } = await supabase.from('users').select('id, name').in('id', idsDeQuemMarcou);
    const nome = new Map(((quem ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    if (varejo_marcado_por) cliente.varejo_marcado_por_nome = nome.get(varejo_marcado_por) ?? null;
    if (inativo_marcado_por) cliente.inativo_marcado_por_nome = nome.get(inativo_marcado_por) ?? null;
  }

  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, total, created_at')
    .eq('company_id', company_id)
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false })
    .limit(MAX_PEDIDOS_DA_FICHA);

  const pedidos: PedidoDoCliente[] = (
    (data ?? []) as Array<Omit<PedidoDoCliente, 'total'> & { total: number | null }>
  ).map((p) => ({
    id: p.id,
    order_number: p.order_number ?? null,
    status: p.status,
    total: p.total ?? 0,
    created_at: p.created_at,
  }));

  const dono = await donoDoCliente(company_id, rep_id ?? null, rep_erp_id ?? null);

  // As edições do cadastro (051): as pendentes para o Control e o histórico
  // recente. Sem a 051 (ou com a leitura falhando) o campo não vem — a ficha
  // abre como antes.
  const alteracoes = await lerAlteracoesDoCliente(company_id, customer_id);

  return { data: { ...cliente, dono, pedidos, ...(alteracoes ? { alteracoes } : {}) }, error: null };
}

export type MarcaDeInatividade =
  | { ok: true }
  | { ok: false; motivo: 'sem_migracao' | 'cliente_nao_encontrado' | 'erro' };

/**
 * O porquê do cliente vermelho — motivo + observação com as palavras de quem
 * apurou. O rep escreve sobre a própria carteira; relacionamento e gerência,
 * sobre qualquer cliente (o controller decide o escopo).
 */
export async function marcarInatividade(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
  quem: string,
  body: { motivo: string; observacao?: string | undefined },
): Promise<MarcaDeInatividade> {
  if (!(await detectarInatividade())) return { ok: false, motivo: 'sem_migracao' };

  const cliente = await clienteDaCarteira<{ id: string }>(company_id, customer_id, escopo, 'id');
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  // `updated_at` junto: é por ele que o CRM (e quem mais sincroniza) descobre
  // que o cadastro mudou desde a última leitura.
  const agora = new Date().toISOString();
  const { error } = await supabase
    .from('customers')
    .update({
      inactivity_reason: body.motivo.trim(),
      inactivity_note: body.observacao?.trim() || null,
      inactivity_updated_by: quem,
      inactivity_updated_at: agora,
      updated_at: agora,
    })
    .eq('id', customer_id)
    .eq('company_id', company_id);

  return error ? { ok: false, motivo: 'erro' } : { ok: true };
}

export type MarcaDeVarejo =
  | { ok: true; varejo: boolean; marcado_em: string }
  | { ok: false; motivo: 'sem_migracao' | 'cliente_nao_encontrado' | 'erro' };

/**
 * Marca (ou desmarca) o cliente como VAREJO — a venda interna tirando da
 * cobrança de contato quem compra no balcão e não volta.
 *
 * Quem pode é decidido no controller (só rep com venda interna). Aqui vale a
 * outra metade: o cliente é da carteira dela.
 */
export async function marcarVarejo(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
  quem: string,
  varejo: boolean,
): Promise<MarcaDeVarejo> {
  if (!(await detectarVarejo())) return { ok: false, motivo: 'sem_migracao' };

  const cliente = await clienteDaCarteira<{ id: string }>(company_id, customer_id, escopo, 'id');
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  const marcado_em = new Date().toISOString();
  const { error } = await supabase
    .from('customers')
    .update({ varejo, varejo_marcado_por: quem, varejo_marcado_em: marcado_em, updated_at: marcado_em })
    .eq('id', customer_id)
    .eq('company_id', company_id);

  return error ? { ok: false, motivo: 'erro' } : { ok: true, varejo, marcado_em };
}

export type MarcaDeInativo =
  | { ok: true; inativo: boolean; motivo: string | null; nota: string | null; marcado_em: string }
  | { ok: false; motivo: 'sem_migracao' | 'cliente_nao_encontrado' | 'nao_esfriado' | 'erro' };

/**
 * Marca (ou desmarca) o cliente como INATIVO — controle interno (migração 052).
 *
 * Marcar exige motivo da lista fechada (o controller valida a chave; `outro`
 * exige nota). Desmarcar limpa tudo: o cliente volta para a régua. Grava
 * `updated_at` de propósito — é por ele que o CRM percebe e espelha o
 * "Perdido manual" do lado dele.
 */
export async function marcarInativo(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
  quem: string,
  body: { inativo: boolean; motivo?: string | undefined; nota?: string | undefined },
): Promise<MarcaDeInativo> {
  if (!(await detectarInativo())) return { ok: false, motivo: 'sem_migracao' };

  const cliente = await clienteDaCarteira<{ id: string; last_purchase_at: string | null }>(
    company_id,
    customer_id,
    escopo,
    'id, last_purchase_at',
  );
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  // Só cliente ESFRIADO vira inativo (Yan, 22/09/2026: "só se o cliente estiver
  // esfriado"). A régua é a da fábrica (043). Reativar vale sempre.
  if (body.inativo) {
    const dias = diasSemComprar(cliente.last_purchase_at);
    const faixa = dias === null ? 'sem_registro' : frescorPorDias(dias, await lerRegua(company_id));
    if (faixa !== 'parado') return { ok: false, motivo: 'nao_esfriado' };
  }

  const marcado_em = new Date().toISOString();
  const motivo = body.inativo ? (body.motivo ?? null) : null;
  const nota = body.inativo ? body.nota?.trim() || null : null;
  const { error } = await supabase
    .from('customers')
    .update({
      inativo: body.inativo,
      inativo_motivo: motivo,
      inativo_nota: nota,
      inativo_marcado_por: quem,
      inativo_marcado_em: marcado_em,
      inativo_origem: 'app',
      updated_at: marcado_em,
    })
    .eq('id', customer_id)
    .eq('company_id', company_id);

  return error ? { ok: false, motivo: 'erro' } : { ok: true, inativo: body.inativo, motivo, nota, marcado_em };
}

export type TrocaDeTabela =
  | { ok: true; cliente: CustomerListItem }
  | { ok: false; motivo: 'cliente_nao_encontrado' | 'erro' };

/**
 * Troca a tabela de preço de um cliente. Tem rota própria, fora da edição do
 * cadastro (customers.edicao.service.ts), por ser a mais cara de errar: muda o
 * preço de tudo que a loja comprar dali para frente, inclusive pelo login
 * próprio dela.
 *
 * Quem chama JÁ precisa ter validado que `price_table_id` está no conjunto de
 * quem pediu. Aqui vale a outra metade: o cliente é da carteira dele?
 */
export async function atualizarTabelaDoCliente(
  company_id: string,
  customer_id: string,
  price_table_id: string,
  escopo: EscopoDaCarteira,
): Promise<TrocaDeTabela> {
  const cliente = await clienteDaCarteira<CustomerListItem>(company_id, customer_id, escopo, CUSTOMER_COLUMNS);
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  // Já é esta a tabela: nada a gravar — nem o `updated_at`, que faria o CRM
  // reler um cadastro que não mudou.
  if (cliente.price_table_id === price_table_id) return { ok: true, cliente };

  const { data, error } = await supabase
    .from('customers')
    .update({ price_table_id, updated_at: new Date().toISOString() })
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle();

  if (error || !data) return { ok: false, motivo: 'erro' };
  return { ok: true, cliente: data as CustomerListItem };
}
