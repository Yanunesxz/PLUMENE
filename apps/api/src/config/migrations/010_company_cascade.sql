-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 010 — ON DELETE CASCADE nas FKs que apontam para companies
--
-- Problema descoberto no multi-fábrica: excluir uma empresa (tenant) falhava
-- porque product_variants.company_id e product_prices.company_id referenciam
-- companies SEM cascade — deixando o DELETE travado (FK 23503) e podendo gerar
-- órfãos. Esta migração recria essas FKs com ON DELETE CASCADE, para que apagar
-- uma empresa remova limpo todo o catálogo dela.
--
-- Idempotente. Executar no Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fk RECORD;
BEGIN
  -- Descobre e recria as FKs (company_id -> companies) que não são CASCADE.
  FOR fk IN
    SELECT c.conname, t.relname AS tbl
    FROM pg_constraint c
    JOIN pg_class t       ON t.oid = c.conrelid
    JOIN pg_class ref     ON ref.oid = c.confrelid
    WHERE c.contype = 'f'
      AND ref.relname = 'companies'
      AND c.confdeltype <> 'c'                         -- 'c' = CASCADE
      AND t.relname IN ('product_variants', 'product_prices')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.tbl, fk.conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) '
      || 'REFERENCES companies(id) ON DELETE CASCADE',
      fk.tbl, fk.conname
    );
    RAISE NOTICE 'FK % em % recriada com ON DELETE CASCADE', fk.conname, fk.tbl;
  END LOOP;
END $$;
