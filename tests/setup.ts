/**
 * Variáveis mínimas para `config/env.ts` subir sem um .env de verdade.
 * São valores de mentira de propósito: nenhum teste fala com Supabase.
 */
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'segredo-de-teste-nao-usar-em-producao';
process.env['SUPABASE_URL'] = 'http://localhost:54321';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'chave-de-teste';
process.env['CORS_ORIGIN'] = 'http://localhost:5173';
