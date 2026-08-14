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
      // O padrão do nodemailer espera DOIS MINUTOS por conexão. Quando a saída
      // SMTP está bloqueada (o Railway bloqueia as portas 25/465/587 no plano
      // Trial), cada envio pendurava o processo por 2 min e morria calado.
      // Com 10s, a falha aparece no log — e no /public/health-email — em vez
      // de virar espera infinita.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
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
 * O e-mail está de pé? Testa a AUTENTICAÇÃO no Gmail sem enviar nada.
 *
 * Existe porque a falha de SMTP é silenciosa por desenho (e-mail nunca derruba
 * pedido) — e uma senha de app errada ficou dois dias invisível por causa
 * disso. Não expõe segredo: devolve só o endereço remetente (que já vai em
 * todo e-mail enviado) e o motivo da recusa do Gmail.
 */
export async function diagnosticoDoEmail(): Promise<{
  configurado: boolean;
  usuario: string | null;
  autentica: boolean;
  erro: string | null;
}> {
  if (!env.EMAIL_USER || !env.EMAIL_APP_PASSWORD) {
    return {
      configurado: false,
      usuario: env.EMAIL_USER ?? null,
      autentica: false,
      erro: 'EMAIL_USER e/ou EMAIL_APP_PASSWORD não definidos no ambiente.',
    };
  }
  const t = obterTransporte();
  if (!t) {
    return { configurado: false, usuario: env.EMAIL_USER, autentica: false, erro: 'Transporte não criado.' };
  }
  try {
    // Corrida com um teto próprio: mesmo com os timeouts do transporte, a rota
    // de diagnóstico nunca pode pendurar quem consulta.
    await Promise.race([
      t.verify(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Tempo esgotado conectando ao Gmail — a saída SMTP está bloqueada ou lenta. ' +
                  'No Railway, o plano Trial bloqueia as portas de e-mail; o plano Hobby libera.',
              ),
            ),
          12_000,
        ),
      ),
    ]);
    return { configurado: true, usuario: env.EMAIL_USER, autentica: true, erro: null };
  } catch (err) {
    return {
      configurado: true,
      usuario: env.EMAIL_USER,
      autentica: false,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
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
