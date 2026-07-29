import type { UserRole } from '@csb/shared';
import { getProducts } from '../catalog/catalog.service.js';
import { getCustomers } from '../customers/customers.service.js';
import { getOrders } from '../orders/orders.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Assistente de IA — versão MOCK (sem custo, sem chave da Anthropic ainda).
//
// O "cérebro" aqui é um roteador simples por palavra-chave que consulta os DADOS
// REAIS através das mesmas funções de serviço do catálogo/clientes/pedidos. Quando
// plugarmos o Claude Fable 5, essas mesmas funções viram as "ferramentas" (tool use)
// e o modelo passa a decidir qual chamar — o resto da rota não muda.
// ─────────────────────────────────────────────────────────────────────────────

export interface AssistantContext {
  company_id: string;
  rep_id: string;
  role: UserRole;
  price_table_id: string | null;
  name: string;
}

export interface AssistantReply {
  reply: string;
  provider: 'mock' | 'fable-5';
}

const brl = (n: number | null | undefined): string =>
  n == null ? 'sob consulta' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// Plumene (SKUs 2xxx) está fora deste catálogo — igual ao app.
const isPlumene = (sku: string): boolean => /^2/.test(sku);

const availableOf = (p: Awaited<ReturnType<typeof getProducts>>[number]): number =>
  (p.variants ?? []).reduce((s, v) => s + (v.available ?? 0), 0);

// ─── "Ferramentas" (viram tool use do Claude depois) ─────────────────────────

async function findProducts(ctx: AssistantContext, term: string) {
  // O assistente é exclusivo de gerente/admin (ver assistant.router), então pode
  // receber a quantidade em estoque — é justamente uma das perguntas que atende.
  const all = await getProducts(ctx.company_id, {
    price_table_id: ctx.price_table_id ?? undefined,
    includeStock: true,
  });
  const q = norm(term);
  return all
    .filter((p) => p.active && !isPlumene(p.sku))
    .filter((p) => norm(p.name).includes(q) || p.sku.includes(term.trim()))
    .slice(0, 8);
}

async function findCustomers(ctx: AssistantContext, term: string) {
  return (await getCustomers(ctx.company_id, ctx.role, ctx.rep_id, term)).slice(0, 8);
}

async function ordersSummary(ctx: AssistantContext) {
  const orders = await getOrders(ctx.company_id, ctx.role, ctx.rep_id);
  const total = orders.reduce((s, o) => s + (o.total ?? 0), 0);
  const pendentes = orders.filter((o) => o.status === 'draft' || o.status === 'pending_approval').length;
  return { count: orders.length, total, pendentes };
}

// ─── Cérebro mock: roteia por intenção ───────────────────────────────────────

const firstName = (n: string): string => n.trim().split(' ')[0] ?? '';

const HELP = (name: string): string =>
  `Oi, ${firstName(name)}! 👋 Sou o assistente do Corpo Sensual (versão de testes). Posso te ajudar com:\n\n` +
  `• *Estoque* — ex.: "quanto tem da 0015?" ou "estoque camisola liganete"\n` +
  `• *Preço* — ex.: "qual o preço da 0070?"\n` +
  `• *Clientes* — ex.: "buscar cliente Dieny"\n` +
  `• *Meus pedidos* — ex.: "resumo dos meus pedidos"\n\n` +
  `Manda sua pergunta que eu consulto os dados reais pra você.`;

export async function answer(ctx: AssistantContext, message: string): Promise<AssistantReply> {
  const text = message.trim();
  const q = norm(text);
  const provider: AssistantReply['provider'] = 'mock';

  if (!text) return { reply: HELP(ctx.name), provider };

  // Saudações / ajuda
  if (/^(oi|ola|ola!|bom dia|boa tarde|boa noite|ajuda|help|menu)\b/.test(q) || q.length < 3) {
    return { reply: HELP(ctx.name), provider };
  }

  // Resumo de pedidos
  if (/(meus? pedidos?|resumo.*pedidos?|pedidos?.*resumo|como.*vendas)/.test(q)) {
    const s = await ordersSummary(ctx);
    return {
      reply:
        `📋 Você tem *${s.count}* pedido(s) no total, somando *${brl(s.total)}*.` +
        (s.pendentes > 0 ? `\n${s.pendentes} ainda em rascunho/aguardando.` : ''),
      provider,
    };
  }

  // Clientes
  if (/(cliente|clientes|buscar cliente|procurar cliente)/.test(q)) {
    const term = text.replace(/.*cliente[s]?/i, '').trim() || text;
    const cs = await findCustomers(ctx, term);
    if (cs.length === 0) return { reply: `Não achei nenhum cliente com "${term}". 🤔`, provider };
    const list = cs
      .map((c) => `• *${c.name}*${c.cnpj ? ` — ${c.cnpj}` : ''}${c.blocked ? ' ⚠️ bloqueado' : ''}`)
      .join('\n');
    return { reply: `Encontrei ${cs.length} cliente(s):\n\n${list}`, provider };
  }

  // Estoque / preço / produto — tenta por código ou por nome
  const codeMatch = text.match(/\b(\d{3,5})\b/);
  const asksStock = /(estoque|quanto tem|disponiv|dispon[íi]vel|tem em)/.test(q);
  const asksPrice = /(preco|preço|valor|quanto custa|custa)/.test(q);
  const looksProduct =
    codeMatch || asksStock || asksPrice || /(camisola|pijama|short|baby|conjunto|produto)/.test(q);

  if (looksProduct) {
    const term = codeMatch?.[1] ?? text;
    const ps = await findProducts(ctx, term);
    if (ps.length === 0) {
      return { reply: `Não encontrei produto pra "${term}". Tenta o código (ex.: 0015) ou o nome.`, provider };
    }
    // Resposta detalhada quando há 1 match claro; senão lista
    if (ps.length === 1 || codeMatch) {
      const p = ps[0]!;
      const av = availableOf(p);
      const parts = [`*${p.sku} — ${p.name}*`];
      if (asksPrice || !asksStock) parts.push(`💰 Preço: ${brl(p.price)}`);
      if (asksStock || !asksPrice) parts.push(`📦 Disponível: ${av} un.`);
      return { reply: parts.join('\n'), provider };
    }
    const list = ps.map((p) => `• *${p.sku}* ${p.name} — ${brl(p.price)} · ${availableOf(p)} un.`).join('\n');
    return { reply: `Achei ${ps.length} produtos:\n\n${list}`, provider };
  }

  // Fallback
  return {
    reply:
      `Ainda não entendi essa (sou a versão de testes 🙂). ` +
      `Tenta perguntar sobre *estoque*, *preço*, *cliente* ou *seus pedidos* — ou digite "ajuda".`,
    provider,
  };
}
