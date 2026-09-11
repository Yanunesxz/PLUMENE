/** Que cara tem o código do Control nos clientes: só número, ou tem letra? */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba';
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');
const env = {};
for (const l of readFileSync(path.join(RAIZ, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const todos = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('customers')
    .select('erp_id')
    .eq('company_id', EMPRESA)
    .not('erp_id', 'is', null)
    .range(de, de + 999);
  if (error) throw error;
  todos.push(...data);
  if (data.length < 1000) break;
}

const comLetra = todos.filter((c) => /[a-z]/i.test(c.erp_id));
const comSimbolo = todos.filter((c) => /[^0-9a-z]/i.test(c.erp_id));
const tamanhos = {};
for (const c of todos) tamanhos[c.erp_id.length] = (tamanhos[c.erp_id.length] ?? 0) + 1;

console.log('clientes com código:', todos.length);
console.log('com LETRA:', comLetra.length, comLetra.slice(0, 10).map((c) => c.erp_id));
console.log('com símbolo:', comSimbolo.length, comSimbolo.slice(0, 10).map((c) => c.erp_id));
console.log('tamanhos:', tamanhos);
console.log('exemplos:', todos.slice(0, 8).map((c) => c.erp_id));
