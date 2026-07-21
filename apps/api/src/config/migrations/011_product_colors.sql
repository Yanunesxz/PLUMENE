-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 011 — Variações de COR por produto (multi-fábrica)
--
-- A fábrica manda cada cor como um produto SEPARADO (ex.: "0172 Azul", "0172
-- Cinza"), cada um com sua grade de tamanhos e estoque — então "estoque por cor
-- e tamanho" já sai de graça. Estas colunas só AGRUPAM esses produtos para o
-- catálogo mostrar um card único com as "bolinhas" de cor (estilo Mercado Livre).
--
--   • variant_group : chave que liga as cores do mesmo modelo (ex.: "0172").
--                     NULL = produto isolado (comportamento atual — Corpo Sensual
--                     continua "cores sortidas", sem agrupar).
--   • color_name    : nome da cor exibido (ex.: "Azul"). NULL = sem cor.
--   • color_hex     : cor da bolinha, calculada a partir da FOTO no upload
--                     (ex.: "#1E4FA3"). NULL = usa um cinza neutro de fallback.
--
-- Idempotente. Rodar no Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_group TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS color_name    TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS color_hex     TEXT;

CREATE INDEX IF NOT EXISTS idx_products_variant_group
  ON products(company_id, variant_group);
