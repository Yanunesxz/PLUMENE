/**
 * A 046 (order_erp_sync, o botão "Atualizar no ERP") está VISÍVEL para a API?
 *
 * Consulta de verdade (GET com uma linha), nunca `head: true`: com HEAD o
 * PostgREST não manda corpo, o erro PGRST205 ("tabela fora do schema cache")
 * some e o `count` volta null sem erro — foi assim que esta conferência disse
 * "aplicada" em 14/09/2026 com a tabela invisível nos dois bancos.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const RAIZ = process.argv[2] ?? path.resolve(import.meta.dirname, '..');
const envPath = path.join(RAIZ, 'apps/api/.env');
const require = createRequire(pathToFileURL(envPath));
const { createClient } = require('@supabase/supabase-js');
const env = {};
for (const l of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await db.from('order_erp_sync').select('order_id').limit(1);
if (error) {
  const ausente = ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code ?? '');
  console.log(env.SUPABASE_URL, '→', ausente ? `FALTA a 046 (${error.code}: ${error.message})` : `ERRO ${error.code} ${error.message}`);
  process.exitCode = 1;
} else {
  console.log(env.SUPABASE_URL, '→', `OK, a API enxerga a 046 (${data.length ? 'já tem foto' : 'ainda sem foto'})`);
}
