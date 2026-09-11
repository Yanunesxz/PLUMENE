-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE)
--
-- Migração 046: o botão "Atualizar no ERP".
--
-- Sem isto, o botão não aparece e a API responde que a migração está pendente.
-- Nada mais muda: o app continua funcionando exatamente como hoje.
--
-- Cole tudo de uma vez e aperte Run. É idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS order_erp_sync (
  order_id       UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  erp_order_id   TEXT,
  total          NUMERIC(12,2),
  pecas          INTEGER NOT NULL DEFAULT 0,
  snapshot       JSONB NOT NULL,
  confirmado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  pedido_em      TIMESTAMPTZ,
  pedido_por     UUID REFERENCES users(id) ON DELETE SET NULL,
  observacao     TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_erp_sync_company ON order_erp_sync(company_id);
CREATE INDEX IF NOT EXISTS idx_order_erp_sync_pedido
  ON order_erp_sync(company_id, pedido_em) WHERE pedido_em IS NOT NULL;

COMMENT ON TABLE order_erp_sync IS
  'A fotografia do pedido como o Control o conhece. Migração 046. Divergência = comparar com os itens de hoje.';

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rode depois; se responder 0, a tabela existe e está vazia
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT count(*) FROM order_erp_sync;
