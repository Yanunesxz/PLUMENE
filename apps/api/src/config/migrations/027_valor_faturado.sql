-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 027 — O valor que a fábrica realmente faturou
-- Executar no Supabase SQL Editor. Idempotente.
--
-- `orders.total` é o valor do PEDIDO: o que o representante montou e o lojista
-- aceitou. O valor FATURADO é outro número — o financeiro corta item que faltou
-- no estoque, corrige preço e fecha a nota. Os dois quase nunca batem, e o que
-- conta como venda é o segundo.
--
-- Até aqui só existia o primeiro, então o painel somava pedido e chamava de
-- venda. Guardar os dois separados permite dizer a verdade nas duas pontas:
-- o lojista vê o que pediu, a fábrica vê o que faturou, e a diferença fica
-- visível em vez de sumir numa sobrescrita.
--
-- Fica NULL até o ERP informar. Quem lê trata NULL como "use o total do
-- pedido" — que é o comportamento de hoje.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoiced_total NUMERIC(12, 2);

COMMENT ON COLUMN orders.invoiced_total IS
  'Valor que a fábrica faturou de fato, informado pelo ERP. NULL = ainda não informado; nesse caso vale orders.total.';

-- Nota negativa não existe. Zero também não seria nota — seria cancelamento,
-- e cancelamento se diz com invoiced = false, não com valor zerado.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_invoiced_total_positivo;

ALTER TABLE orders
  ADD CONSTRAINT orders_invoiced_total_positivo
  CHECK (invoiced_total IS NULL OR invoiced_total > 0);

-- A consulta quente do painel é "o que foi faturado neste mês", sempre dentro
-- da empresa.
CREATE INDEX IF NOT EXISTS idx_orders_faturamento
  ON orders(company_id, invoiced_at)
  WHERE invoiced = true;

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Diferença entre o que foi pedido e o que foi faturado:
--
-- SELECT order_number,
--        total                      AS pedido,
--        invoiced_total             AS faturado,
--        invoiced_total - total     AS diferenca
--   FROM orders
--  WHERE invoiced = true AND invoiced_total IS NOT NULL
--  ORDER BY invoiced_at DESC
--  LIMIT 20;
