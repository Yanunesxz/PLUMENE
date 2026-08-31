-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 036 — Histórico de compra do cliente (a carteira inteligente)
-- Executar no Supabase SQL Editor. Idempotente.
--
-- O representante precisa saber QUEM parou de comprar — hoje a lista de
-- clientes não diz nada sobre isso. Três colunas resolvem:
--
--   last_purchase_at  quando o cliente comprou pela última vez. Nasce do
--                     retrato do Control (relatório Curva ABC, coluna
--                     Últ.Compra) e daí em diante todo pedido FATURADO no app
--                     empurra a data para frente. Para quem vende pelo app,
--                     nunca envelhece; para quem vende por fora, vale o
--                     retrato até a próxima carga ou a API do parceiro.
--   total_purchased   R$ Total Comprado do Control — o tamanho do cliente.
--   overdue_amount    R$ Vencido do Control — o que o rep precisa cobrar.
--
-- A tela mostra a DATA junto do selo ("última compra em 12/03/26"), então o
-- retrato desatualizado nunca engana: está escrito de quando é.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS last_purchase_at DATE,
  ADD COLUMN IF NOT EXISTS total_purchased NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS overdue_amount NUMERIC(12, 2);

COMMENT ON COLUMN customers.last_purchase_at IS
  'Última compra: retrato do Control (Curva ABC) empurrado para frente por todo pedido faturado no app. NULL = sem registro de compra.';
COMMENT ON COLUMN customers.total_purchased IS
  'R$ Total Comprado, do relatório Curva ABC do Control. Retrato, não é atualizado pelo app.';
COMMENT ON COLUMN customers.overdue_amount IS
  'R$ Vencido, do relatório Curva ABC do Control. Retrato, não é atualizado pelo app.';

-- A consulta quente é "clientes do rep ordenados por última compra".
CREATE INDEX IF NOT EXISTS idx_customers_ultima_compra
  ON customers(company_id, rep_erp_id, last_purchase_at);

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT rep_erp_id, COUNT(*) FILTER (WHERE last_purchase_at < now() - interval '6 months') AS parados
--   FROM customers GROUP BY rep_erp_id ORDER BY parados DESC;
