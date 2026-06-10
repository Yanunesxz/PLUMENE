-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 001 — Schema base (tabelas núcleo do app)
-- Executar no Supabase SQL Editor ANTES da 002_erp_schema.sql
-- Cria as tabelas que o seed e a 002 assumem já existir.
-- ─────────────────────────────────────────────────────────────────────────────

-- Necessário para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Empresas (tenant) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabelas de preço ─────────────────────────────────────────────────────────
-- erp_code / price_column / commercial_tier são adicionados pela 002.
CREATE TABLE IF NOT EXISTS price_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_tables_company ON price_tables(company_id);

-- 3. Usuários ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('admin', 'manager', 'rep')),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

-- 4. Produtos ─────────────────────────────────────────────────────────────────
-- collection / brand / group_name / image_url são adicionados pela 002.
CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  erp_id       TEXT,
  sku          TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at);

-- 5. Preços de produto ────────────────────────────────────────────────────────
-- variant_id é adicionado pela 002.
CREATE TABLE IF NOT EXISTS product_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_table_id  UUID NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
  price           NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_prices_product ON product_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_product_prices_table ON product_prices(price_table_id);

-- 6. Clientes ─────────────────────────────────────────────────────────────────
-- trade_name / rep_erp_id / credit_limit / whatsapp / email são adicionados pela 002.
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  erp_id          TEXT,
  name            TEXT NOT NULL,
  cnpj            TEXT,
  price_table_id  UUID REFERENCES price_tables(id) ON DELETE SET NULL,
  blocked         BOOLEAN NOT NULL DEFAULT false,
  block_reason    TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);

-- 7. Pedidos ──────────────────────────────────────────────────────────────────
-- price_table_erp_code / price_column são adicionados pela 002.
CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rep_id        UUID NOT NULL REFERENCES users(id),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','pending_approval','approved','rejected','sent_erp','error_erp')),
  total         NUMERIC(12,2),
  notes         TEXT,
  local_id      TEXT,
  synced_at     TIMESTAMPTZ,
  erp_order_id  TEXT,
  created_by    UUID NOT NULL REFERENCES users(id),
  approved_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_rep ON orders(rep_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
-- Evita duplicar pedido reenviado da fila offline
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_local_id
  ON orders(company_id, local_id) WHERE local_id IS NOT NULL;

-- 8. Itens do pedido ──────────────────────────────────────────────────────────
-- variant_id é adicionado pela 002.
CREATE TABLE IF NOT EXISTS order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total       NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- O app acessa o banco somente via API (service role), que ignora RLS.
-- Habilitamos RLS para bloquear acesso anônimo/direto; sem policies de anon.
ALTER TABLE companies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_tables   ENABLE ROW LEVEL SECURITY;
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items    ENABLE ROW LEVEL SECURITY;
