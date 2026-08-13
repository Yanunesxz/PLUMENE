/**
 * Confirmação de pedido por e-mail, para o CLIENTE e para o REPRESENTANTE.
 *
 * O e-mail é curto de propósito: número, total, status e um botão para a página
 * pública do pedido (onde ficam as fotos e o detalhe). Assim pedido gigante
 * nunca estoura o limite do Gmail — o peso mora na página, não no e-mail.
 */
import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import { enviarEmail } from '../../lib/email.js';
import { tokenDoPedido } from './publicToken.js';
import type { Order, OrderWithItems } from '@csb/shared';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Status amigável para o cliente — os três passos combinados com o Yan. */
function statusCliente(status: Order['status']): string {
  if (status === 'approved' || status === 'sent_erp') return 'Aprovado';
  if (status === 'rejected') return 'Recusado';
  return 'Enviado para a fábrica';
}

function corpoHtml(opts: {
  saudacao: string;
  intro: string;
  numero: string;
  data: string;
  status: string;
  pecas: number;
  total: number;
  link: string;
  rodape: string;
}): string {
  const { saudacao, intro, numero, data, status, pecas, total, link, rodape } = opts;
  return `<!doctype html><html><body style="margin:0;background:#efe9e6;font-family:Segoe UI,Arial,sans-serif;color:#2a2224;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px 40px;">
    <div style="background:#fff;border:1px solid #e7ded9;border-radius:6px;overflow:hidden;">
      <div style="text-align:center;padding:30px 24px 22px;border-bottom:1px solid #e7ded9;">
        <div style="font-family:Georgia,serif;font-size:27px;letter-spacing:.05em;">Corpo Sensual</div>
        <div style="font-size:10px;letter-spacing:.36em;text-transform:uppercase;color:#a98b5a;margin-top:7px;font-weight:600;">Representantes</div>
      </div>
      <div style="padding:30px 32px 6px;">
        <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#6d2740;font-weight:700;">${status}</div>
        <div style="font-family:Georgia,serif;font-size:23px;margin:10px 0 12px;">${saudacao}</div>
        <p style="font-size:15px;line-height:1.6;color:#7c6f71;margin:0;">${intro}</p>
      </div>
      <div style="margin:22px 32px;padding:16px 20px;background:#faf7f5;border:1px solid #efe6e1;border-radius:6px;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr><td style="color:#7c6f71;padding:4px 0;">Pedido</td><td style="text-align:right;font-weight:700;">#${numero}</td></tr>
          <tr><td style="color:#7c6f71;padding:4px 0;">Data</td><td style="text-align:right;">${data}</td></tr>
          <tr><td style="color:#7c6f71;padding:4px 0;">Peças</td><td style="text-align:right;">${pecas}</td></tr>
          <tr><td style="color:#7c6f71;padding:10px 0 0;border-top:1px solid #efe6e1;font-weight:700;">Total</td><td style="text-align:right;padding-top:10px;border-top:1px solid #efe6e1;font-family:Georgia,serif;font-size:18px;font-weight:700;">${brl(total)}</td></tr>
        </table>
      </div>
      <div style="text-align:center;padding:8px 32px 34px;">
        <a href="${link}" style="display:inline-block;background:#6d2740;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;border-radius:4px;">Ver o pedido com as fotos</a>
        <p style="font-size:12.5px;color:#7c6f71;margin:14px 0 0;">Abra o link para ver as fotos de cada peça e acompanhar o pedido.</p>
      </div>
    </div>
    <p style="text-align:center;font-size:12px;color:#9a8d8f;margin:18px 0 0;line-height:1.6;">${rodape}</p>
  </div>
</body></html>`;
}

/**
 * Dispara os e-mails de um pedido recém-fechado. Nunca lança — e-mail é
 * acessório. Roda em segundo plano; falha aqui não pode custar o pedido.
 */
export async function enviarConfirmacaoDoPedido(order: OrderWithItems): Promise<void> {
  try {
    const link = `${env.APP_PUBLIC_URL}/pedido/${tokenDoPedido(order.id)}`;
    const numero = String(order.order_number ?? order.id.slice(0, 8));
    const data = new Date(order.created_at).toLocaleDateString('pt-BR');
    const status = statusCliente(order.status);
    const pecas = order.items.reduce((s, i) => s + i.quantity, 0);
    const total = order.total ?? order.items.reduce((s, i) => s + i.total, 0);

    // Cliente e representante em paralelo.
    const [cli, rep] = await Promise.all([
      order.customer_id
        ? supabase.from('customers').select('name, email').eq('id', order.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('users').select('name, email').eq('id', order.rep_id).maybeSingle(),
    ]);
    const cliente = cli.data as { name: string; email: string | null } | null;
    const representante = rep.data as { name: string; email: string | null } | null;
    const nomeCliente = cliente?.name ?? order.guest_name ?? 'cliente';
    const nomeRep = representante?.name ?? 'seu representante';

    const base = { numero, data, status, pecas, total, link };

    // Para o CLIENTE
    if (cliente?.email) {
      await enviarEmail({
        para: cliente.email,
        assunto: `Pedido #${numero} recebido — Corpo Sensual`,
        html: corpoHtml({
          ...base,
          saudacao: `Recebemos o seu pedido!`,
          intro: `Olá! Registramos o seu pedido e ele já foi enviado para a fábrica. Veja tudo que você escolheu, com as fotos, no link abaixo.`,
          rodape: `Pedido feito com ${nomeRep}, seu representante Corpo Sensual.`,
        }),
      });
    }

    // Para o REPRESENTANTE
    if (representante?.email) {
      await enviarEmail({
        para: representante.email,
        assunto: `Novo pedido #${numero} — ${nomeCliente}`,
        html: corpoHtml({
          ...base,
          saudacao: `Novo pedido de ${nomeCliente}`,
          intro: `Um pedido foi fechado no seu nome. Veja o detalhe com as fotos no link abaixo.`,
          rodape: `Corpo Sensual · Representantes`,
        }),
      });
    }
  } catch (err) {
    console.error('[Email] confirmação de pedido falhou:', err instanceof Error ? err.message : err);
  }
}
