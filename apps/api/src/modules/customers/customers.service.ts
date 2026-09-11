import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import type {
  CustomerListItem,
  CreateCustomerRequest,
  CustomerDetail,
  PedidoDoCliente,
} from '@csb/shared';
import type { AuthRole } from '@csb/shared';
import { documento, formatarDocumento, linhaDeEndereco, apenasDigitos } from '@csb/shared';

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
  return colunas;
}

export async function getCustomers(
  company_id: string,
  role: AuthRole,
  rep_id: string,
  search?: string,
  include_blocked = true,
  erp_rep_id?: string | null,
): Promise<CustomerListItem[]> {
  // Sanitiza o termo de busca: vírgula/parênteses/barra têm significado no
  // filtro `.or()` do PostgREST e quebrariam a query se digitados.
  const term = search ? search.replace(/[,()\\]/g, ' ').trim() : '';

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
 */
async function clienteComOMesmoDocumento(
  company_id: string,
  digitos: string,
): Promise<ClienteDuplicado['duplicado'] | null> {
  // A detecção vem ANTES de montar a consulta: é uma leitura à parte no banco,
  // e a ordem das leituras é o contrato que o teste (e o fake) enxergam.
  const temDigitos = await detectarCadastroReal();
  let consulta = supabase
    .from('customers')
    .select('id, name, erp_id, rep_id')
    .eq('company_id', company_id)
    .limit(1);
  consulta = temDigitos
    ? consulta.eq('cnpj_digits', digitos)
    : consulta.in('cnpj', [digitos, formatarDocumento(digitos)]);
  const { data } = await consulta;
  const achado = (data ?? [])[0] as ClienteDuplicado['duplicado'] | undefined;
  return achado ?? null;
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

  const { data } = await consulta.maybeSingle();
  return (data as T | null) ?? null;
}

/** Histórico suficiente para a ficha sem varrer anos de pedido. */
const MAX_PEDIDOS_DA_FICHA = 50;

const DETALHE_COLUNAS =
  'id, name, trade_name, cnpj, whatsapp, email, address, credit_limit, blocked, block_reason, price_table_id';

/** A ficha soma o que as migrações 036/039 trouxerem — sem elas, vem como antes. */
async function colunasDoDetalhe(): Promise<string> {
  // erp_id: a ficha mostra o número do Control (ou "sem código") — é o que o
  // financeiro atrela. cadastro real: os campos da 041, quando existem.
  let colunas = `${DETALHE_COLUNAS}, erp_id`;
  if (await detectarCadastroReal()) colunas += `, ${COLUNAS_DO_CADASTRO_REAL}`;
  if (await detectarHistoricoDeCompra()) colunas += ', last_purchase_at';
  if (await detectarInatividade()) colunas += ', inactivity_reason, inactivity_note, inactivity_updated_at';
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
  const cliente = await clienteDaCarteira<Omit<CustomerDetail, 'pedidos'>>(
    company_id,
    customer_id,
    escopo,
    await colunasDoDetalhe(),
  );
  if (!cliente) return null;

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

  return { ...cliente, pedidos };
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

  const { error } = await supabase
    .from('customers')
    .update({
      inactivity_reason: body.motivo.trim(),
      inactivity_note: body.observacao?.trim() || null,
      inactivity_updated_by: quem,
      inactivity_updated_at: new Date().toISOString(),
    })
    .eq('id', customer_id)
    .eq('company_id', company_id);

  return error ? { ok: false, motivo: 'erro' } : { ok: true };
}

export type TrocaDeTabela =
  | { ok: true; cliente: CustomerListItem }
  | { ok: false; motivo: 'cliente_nao_encontrado' | 'erro' };

/**
 * Troca a tabela de preço de um cliente. É a única edição de cadastro que o app
 * permite — e a mais cara de errar: muda o preço de tudo que a loja comprar
 * dali para frente, inclusive pelo login próprio dela.
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
  const cliente = await clienteDaCarteira<{ id: string }>(company_id, customer_id, escopo, 'id');
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  const { data, error } = await supabase
    .from('customers')
    .update({ price_table_id })
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle();

  if (error || !data) return { ok: false, motivo: 'erro' };
  return { ok: true, cliente: data as CustomerListItem };
}
