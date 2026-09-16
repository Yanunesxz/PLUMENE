/**
 * Scheduler de sincronização ERP → Supabase.
 *
 * Roda dois jobs:
 *  - fullSync:  a cada ERP_SYNC_INTERVAL_MIN minutos (padrão 5 min)
 *    → atualiza tabelas de preço + produtos + clientes
 *  - stockSync: a cada 1 min (estoque muda com frequência)
 *    → só atualiza ESTOQUE_PRODUTO
 *
 * Ativado apenas quando ERP_SYNC_ENABLED=true. E, mesmo ligado, só age nas
 * empresas cujo canal é 'firebird' (migração 048): o full, com canal_catalogo
 * ou canal_cadastro em 'firebird'; o estoque, com canal_catalogo. Sem a 048
 * nenhuma empresa tem canal 'firebird' e nada roda — que é o seguro. A empresa
 * pulada fica no log uma vez por mudança de canal, não a cada minuto.
 */
import { env } from '../config/env.js';
import { runFullSync, runStockSync } from '../erp/firebird/erpSyncService.js';
import { supabase } from '../config/supabase.js';
import { lerCanais } from '../lib/canais.js';
import type { Canais } from '../lib/canais.js';

let fullSyncTimer: ReturnType<typeof setInterval> | null = null;
let stockSyncTimer: ReturnType<typeof setInterval> | null = null;

/** Último motivo de pulo registrado por job e empresa (para não repetir o log). */
const puloAvisado = new Map<string, string>();

function avisarPulo(job: 'full' | 'stock', company_id: string, canais: Canais): void {
  const chave = `${job}:${company_id}`;
  const motivo = job === 'full'
    ? `canal_catalogo='${canais.catalogo}', canal_cadastro='${canais.cadastro}'`
    : `canal_catalogo='${canais.catalogo}'`;
  if (puloAvisado.get(chave) === motivo) return;
  puloAvisado.set(chave, motivo);
  console.warn(`[ErpSync] ${job} sync pulado na empresa ${company_id}: ${motivo} (precisa 'firebird')`);
}

function esquecerPulo(job: 'full' | 'stock', company_id: string): void {
  puloAvisado.delete(`${job}:${company_id}`);
}

async function getCompanyIds(): Promise<string[]> {
  const { data, error } = await supabase.from('companies').select('id');
  if (error) {
    console.error(`[ErpSync] Falha ao listar empresas: ${error.message}`);
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((c) => c.id);
}

/** Os canais da empresa, ou `null` (com log) quando o banco não respondeu. */
async function canaisOuNada(company_id: string): Promise<Canais | null> {
  try {
    return await lerCanais(company_id);
  } catch (err) {
    console.error(
      `[ErpSync] Canal da empresa ${company_id} não lido; sync pulado nesta rodada: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function runFullSyncAllCompanies(): Promise<void> {
  const companies = await getCompanyIds();
  for (const company_id of companies) {
    const canais = await canaisOuNada(company_id);
    if (!canais) continue;
    if (canais.catalogo !== 'firebird' && canais.cadastro !== 'firebird') {
      avisarPulo('full', company_id, canais);
      continue;
    }
    esquecerPulo('full', company_id);

    const results = await runFullSync(company_id);
    const total = results.reduce((s, r) => s + r.records, 0);
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      console.error('[ErpSync] Erros no full sync:', errors.map((e) => e.error));
    } else {
      console.log(`[ErpSync] Full sync OK — ${total} registros, empresa: ${company_id}`);
    }
  }
}

export async function runStockSyncAllCompanies(): Promise<void> {
  const companies = await getCompanyIds();
  for (const company_id of companies) {
    const canais = await canaisOuNada(company_id);
    if (!canais) continue;
    if (canais.catalogo !== 'firebird') {
      avisarPulo('stock', company_id, canais);
      continue;
    }
    esquecerPulo('stock', company_id);

    const result = await runStockSync(company_id);
    if (result.error) {
      console.error(`[ErpSync] Erro no stock sync: ${result.error}`);
    } else {
      console.log(`[ErpSync] Stock sync OK — ${result.records} variantes atualizadas (${result.duration_ms}ms)`);
    }
  }
}

/** Um job que falha inteiro não pode virar promessa rejeitada solta no processo. */
function rodar(job: () => Promise<void>, nome: string): void {
  job().catch((err: unknown) => {
    console.error(`[ErpSync] ${nome} falhou: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export function startErpSyncScheduler(): void {
  if (!env.ERP_SYNC_ENABLED) {
    console.log('[ErpSync] Scheduler desabilitado (ERP_SYNC_ENABLED=false)');
    return;
  }

  const fullIntervalMs = env.ERP_SYNC_INTERVAL_MIN * 60 * 1000;
  const stockIntervalMs = 60 * 1000; // 1 minuto

  console.log(
    `[ErpSync] Iniciando scheduler — full sync a cada ${env.ERP_SYNC_INTERVAL_MIN}min, stock a cada 1min, só em empresa com canal 'firebird'`,
  );

  // Full sync inicial ao subir
  rodar(runFullSyncAllCompanies, 'full sync');

  fullSyncTimer = setInterval(() => {
    rodar(runFullSyncAllCompanies, 'full sync');
  }, fullIntervalMs);

  stockSyncTimer = setInterval(() => {
    rodar(runStockSyncAllCompanies, 'stock sync');
  }, stockIntervalMs);
}

export function stopErpSyncScheduler(): void {
  if (fullSyncTimer) { clearInterval(fullSyncTimer); fullSyncTimer = null; }
  if (stockSyncTimer) { clearInterval(stockSyncTimer); stockSyncTimer = null; }
  console.log('[ErpSync] Scheduler parado');
}
