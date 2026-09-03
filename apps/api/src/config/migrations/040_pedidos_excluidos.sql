-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 040 — Pedidos excluídos (cópia antes de apagar)
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (03/09/2026): "cria uma aba apenas pro admin visualizar
-- pedidos excluídos". Até aqui, Excluir apagava o pedido do banco de vez —
-- linha e peças — e não havia como saber o que era nem quem apagou (os
-- 14632 e 14633 da CS sumiram assim).
--
-- A exclusão continua apagando o pedido (nada muda nas listas, filas, metas
-- e relatórios, que seguem lendo só `orders`). O que entra é uma CÓPIA
-- inteira do pedido — cabeçalho, peças com referência/tamanho, cliente e
-- representante — guardada aqui um instante antes do DELETE, com quem apagou
-- e quando. É o que a aba "Excluídos" do admin lê.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deleted_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  /** O id que o pedido tinha em `orders` (a linha de lá já não existe). */
  order_id UUID NOT NULL,
  order_number INTEGER,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  /** Quem apagou. O nome vai junto porque o login pode sumir depois. */
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_by_name TEXT,
  /** O pedido inteiro como estava: cabeçalho + items + customer + rep. */
  snapshot JSONB NOT NULL
);

-- A consulta da aba: "os excluídos desta empresa, os mais recentes primeiro".
CREATE INDEX IF NOT EXISTS idx_deleted_orders_da_empresa
  ON deleted_orders(company_id, deleted_at DESC);

COMMENT ON TABLE deleted_orders IS
  'Cópia de cada pedido no instante em que foi excluído pelo app. Só o admin lê (aba Excluídos).';

-- Como nas outras tabelas: só a API (service role) lê e grava.
ALTER TABLE deleted_orders ENABLE ROW LEVEL SECURITY;

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT order_number, deleted_at, deleted_by_name,
--        snapshot->>'status' AS status_na_hora, snapshot->>'total' AS total
--   FROM deleted_orders ORDER BY deleted_at DESC LIMIT 20;
