/**
 * A 054 (papel "visualizador") passou nos DOIS bancos?
 *
 *   node _tools/conferir-054.mjs                        → Corpo Sensual (apps/api/.env deste app)
 *                                                         e PLUMENE (C:/Users/Yan/Desktop/PLUMENE)
 *   node _tools/conferir-054.mjs <raiz> [<raiz> …]      → só as instalações dadas
 *
 * ATENÇÃO — o que esta conferência pode e o que NÃO pode provar.
 *
 * A 054 não cria tabela nem coluna: ela troca o CHECK de `users.role` para
 * aceitar um valor a mais. CHECK não é dado — o PostgREST não serve
 * `pg_constraint`, então NÃO EXISTE GET que leia a regra. Pedir
 * `users?select=id&role=eq.visualizador` responde 200 com lista vazia tanto
 * com a migração aplicada quanto sem ela: isso não prova nada, e é exatamente
 * o tipo de "conferência" que deu a 046 como aplicada estando invisível
 * (15/09/2026). Por isso aqui nunca se usa HEAD e nunca se afirma mais do que
 * o GET mostrou.
 *
 * O que o script faz, então:
 *
 *   1. Confere que a API ALCANÇA `users.role` (GET de verdade, limit 0) — se
 *      isto falhar, nem vale olhar o resto.
 *   2. Procura um login JÁ GRAVADO com role='visualizador'. Achou? Isso é
 *      prova DEFINITIVA de que o CHECK aceita o papel: a linha não poderia
 *      existir se não aceitasse. É o caminho por GET que PROVA.
 *   3. Não achou? Fica INCONCLUSIVO — e o script imprime o SELECT exato para
 *      colar no SQL Editor de cada banco, que é onde a resposta está.
 *
 * O caminho completo, na prática: colar _tools/SQL-PARA-RODAR-054.sql nos dois
 * bancos → rodar o SELECT do passo 3 em cada um (tem de listar 'visualizador')
 * → o admin cria o login em Logins → papel "Visualizador" → rodar este script
 * de novo, que agora acha a linha e fecha a prova por GET.
 *
 * Tentou criar antes de colar o SQL? A tela responde 503 MIGRACAO_PENDENTE e
 * diz este mesmo caminho — a API reconhece a recusa do CHECK (15/10/2026). Não
 * é erro de programa: é o SQL que falta.
 *
 * Só lê. Não imprime nome, e-mail nem id de ninguém.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const PADRAO = [
  { marca: 'Corpo Sensual', raiz: path.resolve(import.meta.dirname, '..') },
  { marca: 'PLUMENE', raiz: 'C:/Users/Yan/Desktop/PLUMENE' },
];
const instalacoes =
  process.argv.length > 2
    ? process.argv.slice(2).map((raiz) => ({ marca: raiz, raiz }))
    : PADRAO;

const AUSENCIA = ['42703', '42P01', 'PGRST204', 'PGRST205'];

const PAPEL = 'visualizador';

const SELECT_NO_EDITOR =
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_users_role';";

function lerEnv(envPath) {
  const env = {};
  for (const linha of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/**
 * Confere uma instalação.
 * Devolve 'provado' (achou login do papel), 'inconclusivo' (API responde, mas
 * ninguém com o papel ainda) ou 'erro' (nem a coluna respondeu).
 */
async function conferir({ marca, raiz }) {
  console.log(`\n── ${marca}`);
  const envPath = path.join(raiz, 'apps/api/.env');
  if (!existsSync(envPath)) {
    console.log('  SEM .env em', envPath);
    return 'erro';
  }
  const require = createRequire(pathToFileURL(envPath));
  const { createClient } = require('@supabase/supabase-js');
  const env = lerEnv(envPath);
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  console.log('  banco:', env.SUPABASE_URL);

  // 1. A API alcança users.role? limit(0): o PostgREST responde sobre o schema
  //    sem devolver linha nenhuma.
  const { error: erroColuna } = await db.from('users').select('role').limit(0);
  if (erroColuna) {
    const falta = AUSENCIA.includes(erroColuna.code ?? '');
    console.log(
      `  ${falta ? 'FALTA' : 'ERRO '} users.role (${erroColuna.code ?? '?'}): ${erroColuna.message}`,
    );
    return 'erro';
  }
  console.log('  OK    users.role responde');

  // 2. Existe login gravado com o papel? Se existe, o CHECK aceita — não há
  //    como a linha estar lá se não aceitasse. select('role') de propósito: não
  //    traz nome, e-mail nem id.
  const { data, error } = await db.from('users').select('role').eq('role', PAPEL).limit(1);
  if (error) {
    console.log(`  ERRO  ao procurar login ${PAPEL} (${error.code ?? '?'}): ${error.message}`);
    return 'erro';
  }
  if ((data?.length ?? 0) > 0) {
    console.log(`  OK    existe login com role='${PAPEL}' → o CHECK ACEITA o papel. 054 aplicada.`);
    return 'provado';
  }

  console.log(`  —     nenhum login com role='${PAPEL}' ainda.`);
  console.log('        INCONCLUSIVO por GET: lista vazia aqui acontece com e sem a migração.');
  console.log('        Cole no SQL Editor DESTE banco (tem de listar \'visualizador\'):');
  console.log(`          ${SELECT_NO_EDITOR}`);
  return 'inconclusivo';
}

const resultado = [];
for (const instalacao of instalacoes) {
  resultado.push({ marca: instalacao.marca, estado: await conferir(instalacao) });
}

console.log('');
const erros = resultado.filter((r) => r.estado === 'erro');
const provados = resultado.filter((r) => r.estado === 'provado');
const inconclusivos = resultado.filter((r) => r.estado === 'inconclusivo');

if (erros.length > 0) {
  console.log('A API não conseguiu ler users.role em:', erros.map((r) => r.marca).join(', '));
  console.log("Se acabou de colar o SQL, confira se ele terminou com NOTIFY pgrst, 'reload schema'.");
  process.exitCode = 1;
} else if (inconclusivos.length === 0) {
  console.log(`054 PROVADA nos ${provados.length} banco(s): existe login '${PAPEL}' em cada um.`);
} else {
  console.log(
    `054 provada em ${provados.length} banco(s); INCONCLUSIVA em: ${inconclusivos
      .map((r) => r.marca)
      .join(', ')}.`,
  );
  console.log('O CHECK só se lê no SQL Editor — rode em cada um dos inconclusivos:');
  console.log(`  ${SELECT_NO_EDITOR}`);
  console.log(
    `Saiu com 'visualizador' na lista? A migração está lá; este script fecha a prova depois que o admin criar o primeiro login do papel.`,
  );
  console.log('Saiu SEM? Cole _tools/SQL-PARA-RODAR-054.sql nesse banco.');
  // Não é falha: a migração pode estar certa e ninguém ter criado o login
  // ainda. Sair 1 aqui ensinaria a ignorar o vermelho deste script.
}
