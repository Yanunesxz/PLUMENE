/**
 * Envio de e-mail — hoje só a confirmação de pedido, pelo Gmail.
 *
 * Config por env (EMAIL_USER + EMAIL_APP_PASSWORD). Sem elas, o envio fica
 * DESLIGADO: as funções viram no-op e nunca derrubam o fluxo do pedido. Assim
 * o app roda igual antes de o Gmail estar configurado, e ativa sozinho quando
 * as variáveis entram no Railway.
 *
 * Gmail exige "senha de app" (2FA ligado na conta). A troca para um serviço
 * profissional (Resend etc.) mexe só neste arquivo.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

let transporte: Transporter | null = null;
let avisou = false;

function obterTransporte(): Transporter | null {
  if (!env.EMAIL_USER || !env.EMAIL_APP_PASSWORD) {
    if (!avisou) {
      console.log('[Email] EMAIL_USER/EMAIL_APP_PASSWORD não definidos — envio de e-mail desligado.');
      avisou = true;
    }
    return null;
  }
  if (!transporte) {
    transporte = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_APP_PASSWORD.replace(/\s+/g, '') },
    });
  }
  return transporte;
}

export interface Email {
  para: string;
  assunto: string;
  html: string;
}

/**
 * Envia e nunca lança: e-mail é acessório, não pode quebrar o pedido. Devolve
 * true/false só para log.
 */
export async function enviarEmail({ para, assunto, html }: Email): Promise<boolean> {
  const t = obterTransporte();
  if (!t) return false;
  const destino = para.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) {
    console.error(`[Email] destino inválido, descartado: "${destino}"`);
    return false;
  }
  try {
    await t.sendMail({
      from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_USER}>`,
      to: destino,
      subject: assunto,
      html,
    });
    // Sucesso também aparece no log. O silêncio no sucesso escondeu por dois
    // dias uma senha de app errada: o erro era logado, mas ninguém procura erro
    // de uma coisa que "está funcionando" — a linha de sucesso que NÃO aparece
    // é o que entrega o problema.
    console.log(`[Email] enviado para ${destino}: ${assunto}`);
    return true;
  } catch (err) {
    console.error(`[Email] falhou para ${destino}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
