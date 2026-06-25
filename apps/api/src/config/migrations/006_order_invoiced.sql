-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 006 — Faturamento do pedido (base da comissão)
-- Executar no Supabase SQL Editor.
--
-- invoiced     = pedido foi faturado (boleto/NF emitido)
-- invoiced_at  = quando foi faturado (define o MÊS em que a comissão entra)
--
-- A marcação será automática (a partir do que o ERP informar). Até lá, o
-- gerente pode marcar manualmente na tela de detalhe do pedido.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoiced    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_invoiced_at ON orders(invoiced_at);
