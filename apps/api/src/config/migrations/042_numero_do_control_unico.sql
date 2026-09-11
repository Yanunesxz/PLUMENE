-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 042 — O número do Control é de UM pedido só
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Desde 10/09/2026 a Larissa digita, ao lançar, o número que o Control deu ao
-- pedido ("CS17379"). A trava contra repetir esse número existia só no código
-- (lê antes de gravar), e há dois jeitos de furar isso:
--
--   • duas pessoas lançando ao mesmo tempo — as duas leem "livre" e as duas
--     gravam; o banco aceita, e dois pedidos passam a apontar para a mesma nota;
--   • a API de Parceiro (POST /pedidos/:id/confirmar) grava erp_order_id por
--     fora do app, sem checagem nenhuma.
--
-- Índice parcial porque a imensa maioria dos pedidos não tem número: NULL não
-- colide com NULL no Postgres, então os pedidos em aberto ficam livres.
--
-- Se este SQL falhar com "could not create unique index", existe número
-- repetido no banco — a consulta de conferência no fim mostra quais.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_company_erp_order
  ON orders(company_id, erp_order_id)
  WHERE erp_order_id IS NOT NULL;

COMMENT ON INDEX idx_orders_company_erp_order IS
  'O número do pedido no Control é único por empresa. Quem cunha é o ERP; o app só guarda.';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Antes de rodar, para achar repetidos (deve vir vazio):
-- SELECT company_id, erp_order_id, COUNT(*), array_agg(order_number)
--   FROM orders WHERE erp_order_id IS NOT NULL
--  GROUP BY 1, 2 HAVING COUNT(*) > 1;
