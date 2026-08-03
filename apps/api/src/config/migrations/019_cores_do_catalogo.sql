-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 019 — Cores por produto (lidas do catálogo impresso)
-- Executar no Supabase SQL Editor. Idempotente.
--
-- A migração 011 já tinha products.color_name/color_hex, mas modela UMA cor por
-- produto (o caso em que a fábrica manda cada cor como produto separado). Aqui é
-- o contrário: um produto tem N cores, e elas só existem no catálogo impresso —
-- no ERP a Corpo Sensual trabalha só com sortido.
--
-- O pedido continua indo ao ERP como sortido. A cor escolhida viaja na
-- observação do pedido.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_colors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  -- Número da bolinha no catálogo ("01", "02"). É por ele que a fábrica confere.
  codigo     TEXT NOT NULL,
  -- Nome legível, derivado do hex ("azul marinho"). NULL quando é variadas.
  nome       TEXT,
  hex        TEXT,
  -- Bolinha rotulada VARIADAS no catálogo: o lojista escolhe "sortido dentro
  -- desta peça". Nunca chamar de "sortidas" na interface — o Yan foi explícito.
  variadas   BOOLEAN NOT NULL DEFAULT false,
  ordem      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_product_colors_produto
  ON product_colors(company_id, product_id);

ALTER TABLE product_colors ENABLE ROW LEVEL SECURITY;
