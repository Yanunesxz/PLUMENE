-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 008 — Chaves únicas para o sync conseguir re-rodar (upsert)
-- Executar no Supabase SQL Editor.
--
-- O sync faz upsert (merge-duplicates) e precisa de uma chave única por tabela.
-- products / price_tables / product_variants já têm. Faltavam estas duas, por
-- isso re-rodar o sync duplicava (ou dava 409). Com elas, sync.py re-roda limpo.
--
-- Se alguma falhar por "could not create unique index ... duplicate key",
-- existem linhas duplicadas de uma carga anterior — me avise para limpar antes.
-- ─────────────────────────────────────────────────────────────────────────────

-- Preço é por (produto, tabela) — o sync grava no nível do produto.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_prices_prod_table
  ON product_prices (product_id, price_table_id);

-- Cliente do ERP é único por (empresa, código ERP). Clientes criados no app
-- têm erp_id nulo e não colidem (NULLs são distintos no índice).
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_company_erp
  ON customers (company_id, erp_id);
