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
} as const;
