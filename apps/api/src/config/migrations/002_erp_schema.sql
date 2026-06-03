-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 002 — Schema ERP real (Firebird Corpo Sensual)
-- Executar no Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Atualizar price_tables com campos do ERP
ALTER TABLE price_tables
  ADD COLUMN IF NOT EXISTS erp_code        TEXT,
  ADD COLUMN IF NOT EXISTS price_column    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS col_descriptions JSONB,
  -- Faixa comercial do preço escalonado por valor do pedido:
  --   1 = Tabela 1 (atacado/melhor preço) · 2 = intermediária · 3 = base/varejo
  --   NULL = tabela não participa do escalonamento.
  -- Regra: pedido <500 → tier 3 · 500–1200 → tier 2 · >1200 → tier 1.
  ADD COLUMN IF NOT EXISTS commercial_tier INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_tables_erp_code
  ON price_tables(company_id, erp_code)
  WHERE erp_code IS NOT NULL;

-- 2. Atualizar products com campos ERP
-- image_url: foto do modelo vinda dos catálogos PDF (não vem do ERP)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS collection  TEXT,
  ADD COLUMN IF NOT EXISTS brand       TEXT,
  ADD COLUMN IF NOT EXISTS group_name  TEXT,
  ADD COLUMN IF NOT EXISTS image_url   TEXT;

-- 3. Tabela de variantes de produto (produto × tamanho)
-- Cores são sortidas: o estoque é a soma de todas as cores do tamanho.
CREATE TABLE IF NOT EXISTS product_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id),
  erp_sku          TEXT NOT NULL,       -- "{PRODUTO}|{TAMANHO}"
  size             TEXT NOT NULL,
  stock_quantity   INTEGER NOT NULL DEFAULT 0,
  stock_committed  INTEGER NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, erp_sku)
);

CREATE INDEX IF NOT EXISTS idx_variants_product_id
  ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_company_id
  ON product_variants(company_id);
CREATE INDEX IF NOT EXISTS idx_variants_updated_at
  ON product_variants(updated_at);

-- 4. Vincular product_prices também a variantes (opcional, mais granular)
ALTER TABLE product_prices
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

-- 5. Atualizar customers com campos ERP
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS trade_name   TEXT,
  ADD COLUMN IF NOT EXISTS rep_erp_id   TEXT,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS whatsapp     TEXT,
  ADD COLUMN IF NOT EXISTS email        TEXT;

-- Índice para busca por rep_erp_id (representante pode filtrar seus clientes)
CREATE INDEX IF NOT EXISTS idx_customers_rep_erp_id
  ON customers(company_id, rep_erp_id)
  WHERE rep_erp_id IS NOT NULL;

-- 6. Log de sincronização ERP
CREATE TABLE IF NOT EXISTS erp_sync_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES companies(id),
  sync_type      TEXT NOT NULL,          -- 'full' | 'stock' | 'prices' | 'customers'
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  records_synced INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'error'
  error_message  TEXT
);

CREATE INDEX IF NOT EXISTS idx_erp_sync_log_company
  ON erp_sync_log(company_id, started_at DESC);

-- 7. Atualizar orders: adicionar tabela + coluna de preço usada
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS price_table_erp_code TEXT,
  ADD COLUMN IF NOT EXISTS price_column         INTEGER DEFAULT 1;

-- 8. Atualizar order_items: referência à variante
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

-- ─── RLS (Row Level Security) para product_variants ──────────────────────────
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Variantes visíveis dentro da empresa" ON product_variants
  FOR SELECT USING (
    company_id = (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  );

-- ─── RLS para erp_sync_log ───────────────────────────────────────────────────
ALTER TABLE erp_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sync log visível para admin/manager" ON erp_sync_log
  FOR SELECT USING (
    company_id = (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  );
