/**
 * Relatório da carteira feito por IA — SÓ quando pedem.
 *
 * O motor é a chave que estiver no Railway: Claude (ANTHROPIC_API_KEY) ou
 * ChatGPT (OPENAI_API_KEY) — chave de API, nunca assinatura de chat. Não
 * existe rotina, agendamento nem análise de fundo: o custo nasce do toque no
 * botão e morre com a resposta. Sem chave nenhuma a rota responde 503 com o
 * motivo — o app continua inteiro sem IA, que é acessório, não fundação.
 */
import { env } from '../../config/env.js';
import { supabase } from '../../config/supabase.js';
import {
  linhasDaCarteira,
  linhasDaEmpresa,
  resumirCarteira,
  instrucoesDoRelatorio,
  montarPedido,
  escolherProvedor,
  type ClienteParaRelatorio,
} from './ia.relatorio.js';

const PAGE_SIZE = 1000;

// Só o que o relatório usa — a carteira inteira viaja, então cada coluna pesa.
const COLUNAS =
  'name, trade_name, last_purchase_at, total_purchased, overdue_amount, rep_erp_id, rep_id';

export type RelatorioResult =
  | { ok: true; relatorio: string; clientes: number }
  | { ok: false; reason: 'sem_chave' | 'sem_migracao' | 'sem_clientes' | 'falha_ia' };

export async function relatorioDaCarteira(
  company_id: string,
  escopo: { rep_id: string; erp_rep_id?: string | null; irrestrito: boolean },
): Promise<RelatorioResult> {
  const provedor = escolherProvedor({
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
    preferencia: env.IA_PROVEDOR,
  });
  if (!provedor) return { ok: false, reason: 'sem_chave' };

  const clientes: ClienteParaRelatorio[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase
      .from('customers')
      .select(COLUNAS)
      .eq('company_id', company_id)
      .range(from, from + PAGE_SIZE - 1);
    if (!escopo.irrestrito) {
      q = escopo.erp_rep_id
        ? q.or(`rep_id.eq.${escopo.rep_id},rep_erp_id.eq.${escopo.erp_rep_id}`)
        : q.eq('rep_id', escopo.rep_id);
    }
    const { data, error } = await q;
    // Erro logo na primeira página = as colunas da 036 não existem ainda; é a
    // única leitura que esta rota faz fora do padrão da lista de clientes.
    if (error) return from === 0 ? { ok: false, reason: 'sem_migracao' } : { ok: false, reason: 'falha_ia' };
    clientes.push(...((data ?? []) as unknown as ClienteParaRelatorio[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  if (clientes.length === 0) return { ok: false, reason: 'sem_clientes' };

  const resumo = resumirCarteira(clientes);
  let linhas: string[];
  let alcance: 'minha carteira' | 'empresa inteira';
  if (escopo.irrestrito) {
    const { data: reps } = await supabase
      .from('users')
      .select('erp_rep_id, name')
      .eq('company_id', company_id)
      .eq('role', 'rep');
    const nomeDoRep = new Map(
      ((reps ?? []) as { erp_rep_id: string | null; name: string }[])
        .filter((r) => r.erp_rep_id)
        .map((r) => [r.erp_rep_id as string, r.name]),
    );
    linhas = linhasDaEmpresa(clientes, nomeDoRep);
    alcance = 'empresa inteira';
  } else {
    linhas = linhasDaCarteira(clientes);
    alcance = 'minha carteira';
  }

  const instrucoes = instrucoesDoRelatorio(env.EMAIL_FROM_NAME);
  const pedido = montarPedido(alcance, resumo, linhas);
  const texto =
    provedor === 'openai'
      ? await perguntarAoChatGPT(instrucoes, pedido)
      : await perguntarAoClaude(instrucoes, pedido);
  if (!texto) return { ok: false, reason: 'falha_ia' };
  return { ok: true, relatorio: texto, clientes: clientes.length };
}

/** Uma pergunta, uma resposta — sem streaming, sem histórico, sem ferramenta. */
async function perguntarAoClaude(instrucoes: string, pedido: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.IA_MODELO,
        max_tokens: 1000,
        system: instrucoes,
        messages: [{ role: 'user', content: pedido }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const texto = json.content?.find((b) => b.type === 'text')?.text?.trim();
    return texto || null;
  } catch {
    return null; // rede, timeout, JSON torto — para o app é tudo "IA não respondeu"
  }
}

/** O mesmo contrato, no formato da OpenAI (chat completions). */
async function perguntarAoChatGPT(instrucoes: string, pedido: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODELO,
        max_completion_tokens: 1000,
        messages: [
          { role: 'system', content: instrucoes },
          { role: 'user', content: pedido },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const texto = json.choices?.[0]?.message?.content?.trim();
    return texto || null;
  } catch {
    return null;
  }
}
