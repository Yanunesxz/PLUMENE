/**
 * Recebe dados que o ERP do parceiro empurra e grava no Supabase.
 *
 * É a mão inversa da API de pedidos: em vez de o parceiro BUSCAR pedidos, ele
 * MANDA clientes e representantes atualizados. Leitura do lado dele, escrita do
 * nosso — e só nas tabelas que o app usa, nunca no banco do ERP.
 *
 * Política tolerante, combinada com o Yan: recusa apenas o registro que não dá
 * para usar (sem código ou sem nome) e aceita o resto, devolvendo a lista do que
 * foi ignorado e por quê. Dado incompleto entra; dado impossível é reportado.
 *
 * Chave de tudo é o CÓDIGO do ERP. `customers.erp_id` não tem índice único, então
 * o upsert é feito por mapa (busca os existentes, decide update ou insert) — não
 * por `onConflict`, que exigiria a constraint.
 */
import { supabase } from '../../config/supabase.js';

// ─── Tipos do corpo que o parceiro envia ─────────────────────────────────────

export interface EnderecoParceiro {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
}

export interface ClienteParceiro {
  codigo?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cnpj_cpf?: string | null;
  representante?: string | null;
  tabela_preco?: string | null;
  /** Objeto com os pedaços, ou a linha já montada. */
  endereco?: EnderecoParceiro | string | null;
  bloqueado?: string | boolean | null;
  limite_credito?: number | null;
  whatsapp?: string | null;
  email?: string | null;
}

export interface RepresentanteParceiro {
  codigo?: string | null;
  nome?: string | null;
  razao_social?: string | null;
  email?: string | null;
  ativo?: string | boolean | null;
}

export interface ResultadoSync {
  recebidos: number;
  criados: number;
  atualizados: number;
  ignorados: Array<{ codigo: string | null; motivo: string }>;
  avisos: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const txt = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** 'S'/'N', true/false, 1/0 — tudo vira booleano. */
const flagSim = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'S' || s === 'SIM' || s === '1' || s === 'TRUE';
};

/**
 * Miolo do código, para casar formatos diferentes do MESMO código: sem "#",
 * sem zeros à frente. "#2225", "2225" e "02225" são o mesmo cliente no Control.
 * Sem isso o casamento exato criaria um cliente novo a cada variação de formato.
 */
const miolo = (v: unknown): string | null => {
  const s = txt(v);
  if (!s) return null;
  const semZero = s.replace(/#/g, '').trim().toUpperCase().replace(/^0+/, '');
  return semZero === '' ? '0' : semZero;
};

/** CNPJ/CPF só dígitos — 11 (CPF) ou mais; menos que isso é lixo de digitação. */
const digitos = (v: unknown): string | null => {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  return d.length >= 11 ? d : null;
};

/** Junta os pedaços do endereço numa linha só — é como o app guarda. */
function montarEndereco(e: EnderecoParceiro | string | null | undefined): string | null {
  if (e == null) return null;
  if (typeof e === 'string') return txt(e);

  const rua = [txt(e.logradouro), txt(e.numero)].filter(Boolean).join(', ');
  const compl = txt(e.complemento);
  const bairro = txt(e.bairro);
  const cidadeUf = [txt(e.cidade), txt(e.uf)].filter(Boolean).join('/');
  const cep = txt(e.cep);

  const partes = [
    [rua, compl].filter(Boolean).join(' '),
    bairro,
    cidadeUf,
    cep ? `CEP ${cep}` : null,
  ].filter(Boolean);

  const linha = partes.join(' - ');
  return linha === '' ? null : linha;
}

/** Chunk para não estourar o payload do Supabase. */
async function emLotes<T>(rows: T[], fn: (lote: T[]) => Promise<void>, tam = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += tam) await fn(rows.slice(i, i + tam));
}

// ─── Clientes ────────────────────────────────────────────────────────────────

export async function receberClientes(
  company_id: string,
  clientes: ClienteParceiro[],
): Promise<ResultadoSync> {
  const ignorados: ResultadoSync['ignorados'] = [];
  const avisos: string[] = [];

  // Elo cliente → tabela de preço: pelo código do ERP. Nas 4 tabelas de produção
  // o erp_code está vazio; enquanto ninguém o preencher, todo cliente cai sem
  // tabela (e usa a do rep). Avisamos uma vez, não a cada cliente.
  const { data: tabelas } = await supabase
    .from('price_tables')
    .select('id, erp_code')
    .eq('company_id', company_id);
  const tabelaPorCodigo = new Map<string, string>();
  for (const t of (tabelas ?? []) as Array<{ id: string; erp_code: string | null }>) {
    const cod = txt(t.erp_code);
    if (cod) tabelaPorCodigo.set(cod, t.id);
  }
  if (tabelaPorCodigo.size === 0) {
    avisos.push(
      'Nenhuma tabela de preço tem código do ERP preenchido — os clientes entram sem tabela e usam a do representante. Preencha o erp_code das tabelas para o vínculo funcionar.',
    );
  }

  // Existentes por código (miolo, para "#2225"="2225"="02225") — e por CNPJ os
  // que estão SEM código. Estes últimos vieram das cargas de carteira (relatório
  // Curva ABC, que não traz código): quando o ERP mandar o mesmo cliente COM
  // código, é adoção, não criação — senão a mesma loja vira duas.
  const { data: existentes } = await supabase
    .from('customers')
    .select('id, erp_id, cnpj')
    .eq('company_id', company_id);
  const idPorCodigo = new Map<string, string>();
  const semCodigoPorCnpj = new Map<string, string>();
  for (const c of (existentes ?? []) as Array<{ id: string; erp_id: string | null; cnpj: string | null }>) {
    const cod = miolo(c.erp_id);
    if (cod) {
      idPorCodigo.set(cod, c.id);
      continue;
    }
    const d = digitos(c.cnpj);
    if (d && !semCodigoPorCnpj.has(d)) semCodigoPorCnpj.set(d, c.id);
  }

  const paraInserir: Record<string, unknown>[] = [];
  const paraAtualizar: Record<string, unknown>[] = [];
  const tabelasNaoAchadas = new Set<string>();
  let adotadosPorCnpj = 0;

  for (const raw of clientes) {
    const codigo = txt(raw.codigo);
    const nome = txt(raw.razao_social);
    if (!codigo) {
      ignorados.push({ codigo: null, motivo: 'sem código do ERP' });
      continue;
    }
    if (!nome) {
      ignorados.push({ codigo, motivo: 'sem razão social' });
      continue;
    }

    const codTabela = txt(raw.tabela_preco);
    let price_table_id: string | null = null;
    if (codTabela) {
      price_table_id = tabelaPorCodigo.get(codTabela) ?? null;
      if (!price_table_id) tabelasNaoAchadas.add(codTabela);
    }

    const linha: Record<string, unknown> = {
      company_id,
      erp_id: codigo,
      name: nome,
      trade_name: txt(raw.nome_fantasia),
      cnpj: txt(raw.cnpj_cpf),
      rep_erp_id: txt(raw.representante),
      price_table_id,
      blocked: flagSim(raw.bloqueado),
      credit_limit: typeof raw.limite_credito === 'number' ? raw.limite_credito : null,
      whatsapp: txt(raw.whatsapp),
      email: txt(raw.email),
      address: montarEndereco(raw.endereco),
      updated_at: new Date().toISOString(),
    };

    let existenteId = idPorCodigo.get(miolo(codigo) ?? '');
    if (!existenteId) {
      // Adoção por CNPJ: o cliente já existe sem código (veio da carga de
      // carteira) e agora aprende o código do Control — a linha já leva
      // `erp_id`, então daqui em diante ele casa pelo caminho normal.
      const d = digitos(raw.cnpj_cpf);
      if (d && semCodigoPorCnpj.has(d)) {
        existenteId = semCodigoPorCnpj.get(d);
        semCodigoPorCnpj.delete(d); // duas linhas não adotam o mesmo cadastro
        adotadosPorCnpj++;
      }
    }
    if (existenteId) paraAtualizar.push({ id: existenteId, ...linha });
    else paraInserir.push(linha);
  }

  // Nunca apagamos cliente — cliente com pedido tem histórico preso a ele. O ERP
  // desativa mandando bloqueado; o app respeita o bloqueio, não some com o dado.
  await emLotes(paraInserir, async (lote) => {
    const { error } = await supabase.from('customers').insert(lote);
    if (error) throw new Error(`Inserir clientes falhou: ${error.message}`);
  });
  for (const row of paraAtualizar) {
    const { id, ...campos } = row;
    const alvo = String(id);
    const { error } = await supabase.from('customers').update(campos).eq('id', alvo);
    if (error) throw new Error(`Atualizar cliente ${alvo} falhou: ${error.message}`);
  }

  if (tabelasNaoAchadas.size > 0) {
    avisos.push(
      `Tabelas de preço não encontradas (cliente ficou sem tabela): ${[...tabelasNaoAchadas].join(', ')}.`,
    );
  }
  if (adotadosPorCnpj > 0) {
    avisos.push(
      `${adotadosPorCnpj} cliente(s) já existiam sem código e foram casados pelo CNPJ — agora têm o código do Control.`,
    );
  }

  return {
    recebidos: clientes.length,
    criados: paraInserir.length,
    atualizados: paraAtualizar.length,
    ignorados,
    avisos,
  };
}

// ─── Representantes ──────────────────────────────────────────────────────────

/**
 * Atualiza os representantes que JÁ EXISTEM (nome, e-mail, ativo), casando pelo
 * código do ERP. Não cria login novo: conta de acesso nasce com senha, e uma
 * senha vinda de um POST externo é risco que ninguém pediu. Rep que o Control
 * tem mas o app ainda não vem na lista `novos`, para o admin criar à mão.
 */
export async function receberRepresentantes(
  company_id: string,
  reps: RepresentanteParceiro[],
): Promise<ResultadoSync & { novos: Array<{ codigo: string; nome: string | null }> }> {
  const ignorados: ResultadoSync['ignorados'] = [];
  const novos: Array<{ codigo: string; nome: string | null }> = [];

  const { data: existentes } = await supabase
    .from('users')
    .select('id, erp_rep_id')
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .not('erp_rep_id', 'is', null);
  const idPorCodigo = new Map<string, string>();
  for (const u of (existentes ?? []) as Array<{ id: string; erp_rep_id: string | null }>) {
    const cod = txt(u.erp_rep_id);
    if (cod) idPorCodigo.set(cod, u.id);
  }

  let atualizados = 0;
  for (const raw of reps) {
    const codigo = txt(raw.codigo);
    const nome = txt(raw.nome);
    if (!codigo) {
      ignorados.push({ codigo: null, motivo: 'sem código do ERP' });
      continue;
    }
    if (!nome) {
      ignorados.push({ codigo, motivo: 'sem nome' });
      continue;
    }

    const existenteId = idPorCodigo.get(codigo);
    if (!existenteId) {
      novos.push({ codigo, nome });
      continue;
    }

    const campos: Record<string, unknown> = { name: nome, updated_at: new Date().toISOString() };
    const email = txt(raw.email);
    if (email) campos['email'] = email.toLowerCase();
    if (raw.ativo != null) campos['active'] = flagSim(raw.ativo);

    const { error } = await supabase.from('users').update(campos).eq('id', existenteId);
    if (error) throw new Error(`Atualizar rep ${codigo} falhou: ${error.message}`);
    atualizados++;
  }

  const avisos: string[] = [];
  if (novos.length > 0) {
    avisos.push(
      `${novos.length} representante(s) do Control ainda não têm login no app — crie o acesso deles na tela de Representantes para receberem os dados.`,
    );
  }

  return { recebidos: reps.length, criados: 0, atualizados, ignorados, avisos, novos };
}
