-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 009 — Número sequencial do pedido (começando em 14534)
-- Executar no Supabase SQL Editor.
--
-- Cria order_number (inteiro, único, legível) — substitui o "#uuid" na tela.
-- Pedidos existentes recebem números em ordem de criação; novos pedidos
-- pegam o próximo da sequência automaticamente.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS orders_number_seq START WITH 14534;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number INTEGER;

-- Backfill dos pedidos existentes, em ordem de criação, a partir de 14534.
WITH ordenados AS (
  SELECT id, 14534 + (ROW_NUMBER() OVER (ORDER BY created_at) - 1) AS num
  FROM orders
  WHERE order_number IS NULL
)
UPDATE orders o
SET order_number = ordenados.num
FROM ordenados
WHERE o.id = ordenados.id;

-- Novos pedidos pegam o próximo número automaticamente.
ALTER TABLE orders ALTER COLUMN order_number SET DEFAULT nextval('orders_number_seq');

-- Aponta a sequência para depois do maior número já usado.
SELECT setval('orders_number_seq', GREATEST(14533, (SELECT COALESCE(MAX(order_number), 0) FROM orders)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
