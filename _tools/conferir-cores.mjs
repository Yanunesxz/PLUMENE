/** Conferência rápida da carga: quantos clientes em cada cor. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const l of readFileSync(path.join(RAIZ, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba';

const cont = { verde: 0, amarelo: 0, vermelho: 0, sem: 0 };
let vencido = 0;
const hoje = Date.now();
for (let de = 0; ; de += 1000) {
  const { data } = await db
    .from('customers')
    .select('last_purchase_at, overdue_amount')
    .eq('company_id', EMPRESA)
    .range(de, de + 999);
  for (const c of data ?? []) {
    if (!c.last_purchase_at) { cont.sem++; continue; }
    const d = Math.floor((hoje - new Date(c.last_purchase_at).getTime()) / 864e5);
    if (d >= 180) cont.vermelho++;
    else if (d >= 90) cont.amarelo++;
    else cont.verde++;
    vencido += c.overdue_amount ?? 0;
  }
  if (!data || data.length < 1000) break;
}
console.log('🟢 Verde (ativo):        ', cont.verde);
console.log('🟡 Amarelo (atenção):    ', cont.amarelo);
console.log('🔴 Vermelho (desativado):', cont.vermelho);
console.log('⚪ Sem registro:         ', cont.sem);
console.log('R$ vencido total:        ', Math.round(vencido).toLocaleString('pt-BR'));
