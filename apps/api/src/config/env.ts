function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const env = {
  PORT: parseInt(process.env['PORT'] ?? '3001', 10),
  NODE_ENV: (process.env['NODE_ENV'] ?? 'development') as 'development' | 'production' | 'test',
  JWT_SECRET: requireEnv('JWT_SECRET'),
  JWT_EXPIRES_IN: process.env['JWT_EXPIRES_IN'] ?? '1h',
  JWT_REFRESH_EXPIRES_IN: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  CORS_ORIGIN: (process.env['CORS_ORIGIN'] ?? 'http://localhost:5173,http://localhost:5174')
    .split(',').map(s => s.trim()),

  /**
   * Chave da PLATAFORMA (dono do sistema) para criar novas empresas/fábricas.
   * Sem ela definida, o onboarding fica desligado. Nunca dar essa chave a clientes.
   */
  PLATFORM_ONBOARD_KEY: process.env['PLATFORM_ONBOARD_KEY'] ?? '',

  // ── ERP Firebird ────────────────────────────────────────────────────────────
  /** Host do servidor Firebird 2.5 do ERP (ex: 192.168.1.10) */
  ERP_DB_HOST: process.env['ERP_DB_HOST'] ?? '127.0.0.1',
  /** Porta Firebird (padrão 3050) */
  ERP_DB_PORT: parseInt(process.env['ERP_DB_PORT'] ?? '3050', 10),
  /** Caminho do arquivo .FDB no servidor Firebird */
  ERP_DB_PATH: process.env['ERP_DB_PATH'] ?? '',
  ERP_DB_USER: process.env['ERP_DB_USER'] ?? 'SYSDBA',
  ERP_DB_PASSWORD: process.env['ERP_DB_PASSWORD'] ?? 'masterkey',
  /** Intervalo de sync em minutos (padrão: 5) */
  ERP_SYNC_INTERVAL_MIN: parseInt(process.env['ERP_SYNC_INTERVAL_MIN'] ?? '5', 10),
  /** Habilitar sync automático (padrão: false em dev) */
  ERP_SYNC_ENABLED: process.env['ERP_SYNC_ENABLED'] === 'true',

  // ── E-mail (confirmação de pedido) ───────────────────────────────────────────
  /** Conta Gmail que envia (ex.: pedidos.corposensual@gmail.com). Vazio = envio desligado. */
  EMAIL_USER: process.env['EMAIL_USER'] ?? '',
  /** Senha de APP do Gmail (16 letras, gerada na conta Google — não é a senha normal). */
  EMAIL_APP_PASSWORD: process.env['EMAIL_APP_PASSWORD'] ?? '',
  /** Nome que aparece como remetente. */
  EMAIL_FROM_NAME: process.env['EMAIL_FROM_NAME'] ?? 'Corpo Sensual',
  /** Base pública do app, para montar o link do pedido no e-mail. */
  APP_PUBLIC_URL: process.env['APP_PUBLIC_URL'] ?? 'https://setorx-web-web.vercel.app',

  // ── Notificações push (Web Push / VAPID) ─────────────────────────────────────
  // Par de chaves gerado UMA vez (npx web-push generate-vapid-keys) e colado no
  // Railway. Vazio = push desligado: o app esconde o botão e a API responde 503.
  /** Chave pública — vai para o navegador assinar o aparelho. */
  VAPID_PUBLIC_KEY: process.env['VAPID_PUBLIC_KEY'] ?? '',
  /** Chave privada — NUNCA sai do servidor. */
  VAPID_PRIVATE_KEY: process.env['VAPID_PRIVATE_KEY'] ?? '',
  /** Contato do responsável, exigido pelo padrão (mailto:...). */
  VAPID_SUBJECT: process.env['VAPID_SUBJECT'] ?? 'mailto:pedidoscorposensual@gmail.com',
} as const;
