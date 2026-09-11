/**
 * Notificações push (Web Push) — o aviso que chega no celular com o app fechado.
 *
 * Sem Firebase e sem serviço pago: o padrão Web Push do navegador, com o par
 * de chaves VAPID no Railway. Cada aparelho que aceitou receber vira uma linha
 * em `push_subscriptions` (migração 034); o envio cifra a mensagem para cada
 * aparelho e o navegador entrega — app fechado inclusive.
 *
 * Duas regras de sobrevivência:
 *  • enviar NUNCA derruba o fluxo que avisou: falha de push é silenciosa
 *    (registrada no console), o pedido segue o caminho dele;
 *  • aparelho morto (404/410 — pessoa revogou, trocou de navegador, expirou)
 *    é apagado na hora, senão a lista só cresce com endereço furado.
 */
import { webpush } from './webpush.js';
import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { env } from '../../config/env.js';

export interface AvisoPush {
  /** Título da notificação (ex.: "Pedido #14620 faturado"). */
  title: string;
  /** O texto embaixo do título. */
  body: string;
  /** Rota interna que o toque abre (ex.: "/orders/<id>"). */
  url: string;
  /** Avisos com a mesma tag se substituem em vez de empilhar. */
  tag?: string;
}

export function pushConfigurado(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

let vapidAplicado = false;
function garantirVapid(): void {
  if (vapidAplicado || !pushConfigurado()) return;
  vapidAplicado = true;
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  } catch (err) {
    // Chave colada errada no Railway não pode derrubar quem só quis avisar.
    console.error('[push] chaves VAPID inválidas:', err);
  }
}

// A tabela vem da migração 034, que pode não estar aplicada — mesmo cuidado
// das outras: o deploy pode chegar antes do SQL, e nada pode quebrar por isso.
async function detectarTabela(): Promise<boolean> {
  return detectar('push_subscriptions', 'id');
}

export interface AssinaturaRecebida {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Grava (ou renova) o aparelho de um usuário. Upsert pelo endpoint. */
export async function salvarAssinatura(
  company_id: string,
  user_id: string,
  assinatura: AssinaturaRecebida,
  user_agent?: string | null,
): Promise<boolean> {
  if (!(await detectarTabela())) return false;
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      company_id,
      user_id,
      endpoint: assinatura.endpoint,
      p256dh: assinatura.keys.p256dh,
      auth: assinatura.keys.auth,
      user_agent: user_agent ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw new Error(`Falha ao gravar a assinatura: ${error.message}`);
  return true;
}

/** Tira UM aparelho — só do próprio usuário, para ninguém desligar o alheio. */
export async function removerAssinatura(user_id: string, endpoint: string): Promise<void> {
  if (!(await detectarTabela())) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user_id);
}

async function apagarEndpoint(endpoint: string): Promise<void> {
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

interface LinhaAssinatura {
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function enviarParaLinhas(linhas: LinhaAssinatura[], aviso: AvisoPush): Promise<number> {
  garantirVapid();
  const corpo = JSON.stringify(aviso);
  let entregues = 0;
  await Promise.all(
    linhas.map(async (l) => {
      try {
        await webpush.sendNotification(
          { endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } },
          corpo,
        );
        entregues += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 = o navegador diz que aquele aparelho não existe mais.
        if (status === 404 || status === 410) await apagarEndpoint(l.endpoint);
        else console.error('[push] falha ao enviar:', status ?? err);
      }
    }),
  );
  return entregues;
}

/** Envia o aviso para TODOS os aparelhos destes usuários. */
export async function enviarParaUsuarios(
  company_id: string,
  userIds: string[],
  aviso: AvisoPush,
): Promise<number> {
  if (!pushConfigurado() || userIds.length === 0) return 0;
  if (!(await detectarTabela())) return 0;
  const { data } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('company_id', company_id)
    .in('user_id', userIds);
  const linhas = (data ?? []) as LinhaAssinatura[];
  if (linhas.length === 0) return 0;
  return enviarParaLinhas(linhas, aviso);
}

/**
 * O público de um AVISO manual (a tela "Enviar aviso" do Painel):
 *
 *   todos           → todo login ativo da empresa
 *   reps            → só os representantes
 *   lojas           → só as contas de loja
 *   lojas_compraram → lojas cujo cliente fez pedido nos últimos N dias
 *   escritorio      → só a gerência comercial e o financeiro
 */
export type PublicoDoAviso = 'todos' | 'reps' | 'lojas' | 'lojas_compraram' | 'escritorio';

export async function resolverPublico(
  company_id: string,
  publico: PublicoDoAviso,
  dias = 90,
): Promise<string[]> {
  if (publico === 'lojas_compraram') {
    const corte = new Date(Date.now() - dias * 86400_000).toISOString();
    const { data: pedidos } = await supabase
      .from('orders')
      .select('customer_id')
      .eq('company_id', company_id)
      .gte('created_at', corte)
      .not('customer_id', 'is', null)
      .limit(1000);
    const clientes = [...new Set(((pedidos ?? []) as Array<{ customer_id: string }>).map((p) => p.customer_id))];
    if (clientes.length === 0) return [];
    const { data: usuarios } = await supabase
      .from('users')
      .select('id')
      .eq('company_id', company_id)
      .eq('active', true)
      .eq('role', 'store')
      .in('customer_id', clientes);
    return ((usuarios ?? []) as Array<{ id: string }>).map((u) => u.id);
  }

  const papeis =
    publico === 'reps'
      ? ['rep']
      : publico === 'lojas'
        ? ['store']
        : publico === 'escritorio'
          ? ['manager', 'financeiro']
          : ['rep', 'store', 'manager', 'admin', 'financeiro', 'relacionamento'];
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('company_id', company_id)
    .eq('active', true)
    .in('role', papeis);
  return ((data ?? []) as Array<{ id: string }>).map((u) => u.id);
}

/** Envia para todos os usuários ativos destes papéis (ex.: a mesa do financeiro). */
export async function enviarParaPapeis(
  company_id: string,
  papeis: string[],
  aviso: AvisoPush,
  exceto?: string,
): Promise<number> {
  if (!pushConfigurado()) return 0;
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('company_id', company_id)
    .eq('active', true)
    .in('role', papeis);
  const ids = ((data ?? []) as Array<{ id: string }>)
    .map((u) => u.id)
    .filter((id) => id !== exceto);
  return enviarParaUsuarios(company_id, ids, aviso);
}
