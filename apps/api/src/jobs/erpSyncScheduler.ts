/**
 * Scheduler de sincronização ERP → Supabase.
 *
 * Roda dois jobs:
 *  - fullSync:  a cada ERP_SYNC_INTERVAL_MIN minutos (padrão 5 min)
 *    → atualiza tabelas de preço + produtos + clientes
 *  - stockSync: a cada 1 min (estoque muda com frequência)
 *    → só atualiza ESTOQUE_PRODUTO
 *
 * Ativado apenas quando ERP_SYNC_ENABLED=true.
 */
import { env } from '../config/env.js';
import { runFullSync, runStockSync } from '../erp/firebird/erpSyncService.js';
import { supabase } from '../config/supabase.js';

let fullSyncTimer: ReturnType<typeof setInterval> | null = null;
let stockSyncTimer: ReturnType<typeof setInterval> | null = null;

async function getCompanyIds(): Promise<string[]> {
  const { data } = await supabase.from('companies').select('id');
  return (data ?? []).map((c: { id: string }) => c.id);
}

async function runFullSyncAllCompanies(): Promise<void> {
  const companies = await getCompanyIds();
  for (const company_id of companies) {
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

async function runStockSyncAllCompanies(): Promise<void> {
  const companies = await getCompanyIds();
  for (const company_id of companies) {
    const result = await runStockSync(company_id);
    if (result.error) {
      console.error(`[ErpSync] Erro no stock sync: ${result.error}`);
    } else {
      console.log(`[ErpSync] Stock sync OK — ${result.records} variantes atualizadas (${result.duration_ms}ms)`);
    }
  }
}

export function startErpSyncScheduler(): void {
  if (!env.ERP_SYNC_ENABLED) {
    console.log('[ErpSync] Scheduler desabilitado (ERP_SYNC_ENABLED=false)');
    return;
  }

  const fullIntervalMs = env.ERP_SYNC_INTERVAL_MIN * 60 * 1000;
  const stockIntervalMs = 60 * 1000; // 1 minuto

  console.log(`[ErpSync] Iniciando scheduler — full sync a cada ${env.ERP_SYNC_INTERVAL_MIN}min, stock a cada 1min`);

  // Full sync inicial ao subir
  void runFullSyncAllCompanies();

  fullSyncTimer = setInterval(() => {
    void runFullSyncAllCompanies();
  }, fullIntervalMs);

  stockSyncTimer = setInterval(() => {
    void runStockSyncAllCompanies();
  }, stockIntervalMs);
}

export function stopErpSyncScheduler(): void {
  if (fullSyncTimer) { clearInterval(fullSyncTimer); fullSyncTimer = null; }
  if (stockSyncTimer) { clearInterval(stockSyncTimer); stockSyncTimer = null; }
  console.log('[ErpSync] Scheduler parado');
}
