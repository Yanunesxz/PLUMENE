-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 003 — Alinha o schema ao que o ERP sync (sync.py) grava
-- As migrations 001/002 não criaram estas duas colunas, que o sync.py envia:
--   • price_tables.updated_at   (as demais tabelas já têm updated_at)
--   • product_prices.company_id (multiempresa em todas as tabelas)
-- Executar no Supabase SQL Editor (idempotente).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE price_tables
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE product_prices
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_product_prices_company
  ON product_prices(company_id);
