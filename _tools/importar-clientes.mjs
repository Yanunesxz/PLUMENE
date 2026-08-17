/**
 * Carga em massa de clientes a partir do Excel do Control.
 *
 * POR QUE ISTO EXISTE: nosso banco tem um retrato velho e parcial (1.357 de
 * ~3.721 clientes), com o vínculo cliente↔representante furado em massa. A API
 * do Fábio conserta isso continuamente, mas esta carga faz o mesmo de uma vez,
 * a partir de um Excel — para não esperar a integração ficar de pé.
 *
 * O QUE ELE FAZ:
 *   • lê o Excel (detecta a aba e as colunas pelo cabeçalho, tolerante a formato);
 *   • casa cada linha por CÓDIGO DO CLIENTE — atualiza quem existe, cria quem falta;
 *   • atribui o representante pelo CÓDIGO; se o rep existe no app, grava o código
 *     canônico DELE (senão o carteira, que casa exato, não acha);
 *   • monta o endereço numa linha só;
 *   • NUNCA apaga, e NUNCA toca em cliente sem código (os criados no app).
 *
 * Uso:
 *   node _tools/importar-clientes.mjs "arquivo.xlsx"             → PRÉVIA (não grava)
 *   node _tools/importar-clientes.mjs "arquivo.xlsx" --aplicar   → grava
 *
 * ⚠️ Rode `pnpm backup` ANTES de --aplicar. Supabase Free não tem backup.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const ENV = path.join(RAIZ, 'apps/api/.env');
const require = createRequire(pathToFileURL(ENV));
const { createClient } = require('@supabase/supabase-js');
const XLSX = require(path.join(RAIZ, 'apps/web/node_modules/xlsx'));

// Corpo Sensual Ltda. É a única empresa real; a outra ("Demonstração Cores") é demo.
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba';

const arquivo = process.argv[2];
const aplicar = process.argv.includes('--aplicar');
if (!arquivo) {
  console.error('Uso: node _tools/importar-clientes.mjs "arquivo.xlsx" [--aplicar]');
  process.exit(1);
}

const env = {};
for (const linha of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── Normalização ────────────────────────────────────────────────────────────
const txt = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
/** Tira "#" e espaços do código; devolve o que sobrou, ou null. */
const limpaCodigo = (v) => {
  const s = txt(v);
  return s == null ? null : (s.replace(/#/g, '').trim() || null);
};
/** Miolo p/ CASAR códigos de formatos diferentes: sem "#", sem zeros à frente. */
const miolo = (v) => {
  const s = limpaCodigo(v);
  if (s == null) return null;
  const semZero = s.toUpperCase().replace(/^0+/, '');
  return semZero === '' ? '0' : semZero;
};
const flagSim = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'S' || s === 'SIM' || s === '1' || s === 'TRUE' || s === 'BLOQUEADO';
};

// ─── Detecta aba + colunas pelo cabeçalho ─────────────────────────────────────
const CAMPOS = {
  codigo:    [/c[oó]d.*cliente/i, /^cliente$/i, /^c[oó]digo$/i, /^cod$/i],
  razao:     [/raz.*social/i, /nome.*cliente/i, /^nome$/i],
  cnpj:      [/cnpj/i, /\bcpf\b/i],
  rep:       [/c[oó]d.*represent/i, /represent/i, /vendedor/i],
  tabela:    [/tabela/i],
  endereco:  [/endere/i],
  cidade:    [/cidade/i, /munic[ií]/i],
  uf:        [/^u\.?\s*f\.?$/i, /estado/i],
  bairro:    [/bairro/i],
  cep:       [/cep/i],
  whatsapp:  [/whats|zap/i],
  fantasia:  [/fantasia/i],
  email:     [/mail/i],
  bloqueado: [/bloq/i],
};
function mapearColunas(headerRow) {
  const mapa = {};
  headerRow.forEach((cel, c) => {
    const h = txt(cel);
    if (!h) return;
    for (const [campo, regs] of Object.entries(CAMPOS)) {
      if (mapa[campo] == null && regs.some((r) => r.test(h))) mapa[campo] = c;
    }
  });
  return mapa;
}
/** Escolhe a aba+linha de cabeçalho com mais campos reconhecidos (precisa ter código E rep). */
function acharTabela(wb) {
  let melhor = null;
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null, raw: false });
    for (let i = 0; i < Math.min(linhas.length, 12); i++) {
      const mapa = mapearColunas(linhas[i] || []);
      const qtd = Object.keys(mapa).length;
      const temChave = mapa.codigo != null && mapa.rep != null;
      if (temChave && (!melhor || qtd > melhor.qtd)) {
        melhor = { nome, linhaHeader: i, mapa, qtd, linhas };
      }
    }
  }
  return melhor;
}

function montarEndereco(l, mapa) {
  const g = (k) => (mapa[k] != null ? txt(l[mapa[k]]) : null);
  const base = g('endereco');
  const bairro = g('bairro');
  const cidadeUf = [g('cidade'), g('uf')].filter(Boolean).join('/');
  const cep = g('cep');
  const partes = [base, bairro, cidadeUf, cep ? `CEP ${cep}` : null].filter(Boolean);
  return partes.length ? partes.join(' - ') : null;
}

async function baixarTudo(tabela, select, filtro = '') {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from(tabela).select(select).range(de, de + 999);
    if (filtro) q = q.eq('company_id', EMPRESA);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < 1000) break;
  }
  return linhas;
}

// ─── Programa ─────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nArquivo: ${arquivo}`);
  const wb = XLSX.readFile(arquivo, { cellDates: false });
  const achado = acharTabela(wb);
  if (!achado) {
    console.error('\n❌ Não achei uma aba com colunas de CÓDIGO DO CLIENTE e CÓDIGO DO REPRESENTANTE.');
    console.error('   Cabeçalhos esperados: "Codigo Cliente" e "Codigo Representante".');
    process.exit(1);
  }
  const { nome, linhaHeader, mapa, linhas } = achado;
  console.log(`Aba escolhida: "${nome}" (cabeçalho na linha ${linhaHeader + 1})`);
  console.log('Colunas reconhecidas:', Object.fromEntries(
    Object.entries(mapa).map(([k, c]) => [k, XLSX.utils.encode_col(c)]),
  ));

  const dados = linhas.slice(linhaHeader + 1).filter((l) => l && l.some((v) => txt(v) != null));

  // Mapas do que já existe no app
  const [custExist, reps] = await Promise.all([
    baixarTudo('customers', 'id, erp_id, cnpj', true),
    baixarTudo('users', 'erp_rep_id, name, role', true),
  ]);
  const idPorMiolo = new Map();
  // Clientes SEM código, indexados por CNPJ (dígitos): vieram das cargas de
  // carteira (Curva ABC, sem código). Quando a linha com código chegar, é
  // ADOÇÃO — atualiza aquele cadastro e grava o código —, nunca criação, senão
  // a mesma loja vira duas.
  const semCodigoPorCnpj = new Map();
  const soDigitos = (v) => {
    const s = txt(v);
    if (!s) return null;
    const d = s.replace(/\D/g, '');
    return d.length >= 11 ? d : null;
  };
  for (const c of custExist) {
    const m = miolo(c.erp_id);
    if (m) { idPorMiolo.set(m, c.id); continue; }
    const d = soDigitos(c.cnpj);
    if (d && !semCodigoPorCnpj.has(d)) semCodigoPorCnpj.set(d, c.id);
  }
  const repPorMiolo = new Map();
  for (const u of reps) { if (u.role === 'rep' && u.erp_rep_id) { const m = miolo(u.erp_rep_id); if (m) repPorMiolo.set(m, u.erp_rep_id); } }

  // Plano
  const paraCriar = [], paraAtualizar = [];
  const problemas = { semCodigo: 0, semRazao: 0 };
  const repsNaoAchados = new Map(); // codigo -> quantos clientes

  for (const l of dados) {
    const codigo = limpaCodigo(mapa.codigo != null ? l[mapa.codigo] : null);
    const razao = mapa.razao != null ? txt(l[mapa.razao]) : null;
    if (!codigo) { problemas.semCodigo++; continue; }
    if (!razao) { problemas.semRazao++; continue; }

    const repMiolo = miolo(mapa.rep != null ? l[mapa.rep] : null);
    let rep_erp_id = null;
    if (repMiolo) {
      rep_erp_id = repPorMiolo.get(repMiolo) ?? limpaCodigo(l[mapa.rep]);
      if (!repPorMiolo.has(repMiolo)) {
        const cod = limpaCodigo(l[mapa.rep]);
        repsNaoAchados.set(cod, (repsNaoAchados.get(cod) ?? 0) + 1);
      }
    }

    const linha = {
      company_id: EMPRESA,
      erp_id: codigo,
      name: razao,
      trade_name: mapa.fantasia != null ? txt(l[mapa.fantasia]) : null,
      cnpj: mapa.cnpj != null ? txt(l[mapa.cnpj]) : null,
      rep_erp_id,
      whatsapp: mapa.whatsapp != null ? txt(l[mapa.whatsapp]) : null,
      email: mapa.email != null ? txt(l[mapa.email]) : null,
      address: montarEndereco(l, mapa),
      blocked: mapa.bloqueado != null ? flagSim(l[mapa.bloqueado]) : false,
      updated_at: new Date().toISOString(),
    };

    let existeId = idPorMiolo.get(miolo(codigo));
    if (!existeId) {
      const d = soDigitos(linha.cnpj);
      if (d && semCodigoPorCnpj.has(d)) {
        existeId = semCodigoPorCnpj.get(d);
        semCodigoPorCnpj.delete(d); // duas linhas não adotam o mesmo cadastro
        problemas.adotadosPorCnpj = (problemas.adotadosPorCnpj ?? 0) + 1;
      }
    }
    if (existeId) paraAtualizar.push({ id: existeId, ...linha });
    else paraCriar.push(linha);
  }

  // ── PRÉVIA ──
  console.log('\n═══════════════ PRÉVIA (nada foi gravado) ═══════════════');
  console.log(`Linhas de dados lidas:     ${dados.length}`);
  console.log(`  → criar (código novo):   ${paraCriar.length}`);
  console.log(`  → atualizar (já existe): ${paraAtualizar.length}`);
  console.log(`  → ignorar sem código:    ${problemas.semCodigo}`);
  console.log(`  → ignorar sem razão:     ${problemas.semRazao}`);
  if (problemas.adotadosPorCnpj) {
    console.log(`  → adotados pelo CNPJ:    ${problemas.adotadosPorCnpj} (existiam sem código; agora ganham o código do Control)`);
  }
  console.log(`Representantes casados:     ${repPorMiolo.size} no app`);
  if (repsNaoAchados.size) {
    console.log(`\n⚠️  Códigos de representante que NÃO existem no app (cliente fica atribuído ao código, mas só aparece quando o rep for cadastrado):`);
    [...repsNaoAchados.entries()].sort((a, b) => b[1] - a[1]).forEach(([cod, n]) => console.log(`     ${cod}: ${n} cliente(s)`));
  }
  console.log('\nAmostra do que seria criado (3):');
  paraCriar.slice(0, 3).forEach((c) => console.log(`   ${c.erp_id} | ${c.name} | rep=${c.rep_erp_id} | ${c.address ?? '(sem endereço)'}`));
  console.log('Amostra do que seria atualizado (3):');
  paraAtualizar.slice(0, 3).forEach((c) => console.log(`   ${c.erp_id} | ${c.name} | rep=${c.rep_erp_id}`));

  if (!aplicar) {
    console.log('\n(Isto foi só a prévia. Para gravar: adicione --aplicar. Rode `pnpm backup` antes.)');
    return;
  }

  // ── APLICAR ──
  console.log('\n═══════════════ APLICANDO ═══════════════');
  for (let i = 0; i < paraCriar.length; i += 500) {
    const lote = paraCriar.slice(i, i + 500);
    const { error } = await sb.from('customers').insert(lote);
    if (error) throw new Error(`insert: ${error.message}`);
    console.log(`  criados ${Math.min(i + 500, paraCriar.length)}/${paraCriar.length}`);
  }
  let n = 0;
  for (const row of paraAtualizar) {
    const { id, ...campos } = row;
    const { error } = await sb.from('customers').update(campos).eq('id', id);
    if (error) throw new Error(`update ${id}: ${error.message}`);
    if (++n % 200 === 0) console.log(`  atualizados ${n}/${paraAtualizar.length}`);
  }
  console.log(`\n✅ Concluído: ${paraCriar.length} criados, ${paraAtualizar.length} atualizados.`);
})().catch((e) => { console.error('\n❌ ERRO:', e.message); process.exit(1); });
