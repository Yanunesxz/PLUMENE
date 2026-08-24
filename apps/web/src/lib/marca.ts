/**
 * A MARCA desta instalação.
 *
 * O sistema é um só, mas cada marca (Corpo Sensual, PLUMENE, …) roda numa
 * instalação própria: outro deploy, outro banco, outro endereço. O que veste
 * a instalação com a marca certa são estas variáveis de BUILD, definidas no
 * painel do Vercel de cada instalação. Sem nenhuma definida, tudo cai no
 * padrão Corpo Sensual — a instalação original continua igualzinha.
 *
 * A logo NÃO passa por aqui: é o arquivo `public/logo.png`, trocado por
 * instalação. O nome que o app instalado mostra vem do manifest, montado com
 * as mesmas variáveis em `vite.config.ts`.
 */

const env = import.meta.env;

export const MARCA = {
  /** Nome exibido em telas, títulos e mensagens de WhatsApp. */
  nome: (env['VITE_BRAND_NAME'] as string | undefined) || 'Corpo Sensual',

  /** WhatsApp do suporte: só dígitos com DDI, e o rótulo humano dele. */
  suporteWhatsapp: (env['VITE_BRAND_SUPPORT_WHATSAPP'] as string | undefined) || '5532998493177',
  suporteWhatsappLabel:
    (env['VITE_BRAND_SUPPORT_WHATSAPP_LABEL'] as string | undefined) || '(32) 9 9849-3177',

  /**
   * Esta instalação exporta a planilha do Control? O formulário oficial é o da
   * fábrica da Corpo Sensual; instalação de outra marca esconde o botão até
   * ter um formato próprio. Só a string 'false' desliga — ausência liga.
   */
  exportaControl: (env['VITE_BRAND_CONTROL_EXPORT'] as string | undefined) !== 'false',

  /**
   * A faixa "versão nova pronta" aparece nesta instalação? Ela existe porque
   * aparelho que fica o dia inteiro no app nunca chega ao momento da troca
   * automática (3 atualizações não chegaram ao Yan em 19/08/2026). O dono da
   * marca pode desligá-la; a troca automática continua funcionando por baixo.
   */
  avisoDeAtualizacao: (env['VITE_BRAND_UPDATE_BANNER'] as string | undefined) !== 'false',
} as const;
