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
  observacao     TEXT,
  -- A impressão do pedido (assinaturaDoPedido, em shared) no momento do aviso.
  -- É ela que diz, sem se confundir com carimbo ou correção de número, se a
  -- venda interna mudou o pedido DE NOVO depois de avisar.
  assinatura_pedida TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_erp_sync_company ON order_erp_sync(company_id);
CREATE INDEX IF NOT EXISTS idx_order_erp_sync_pedido
  ON order_erp_sync(company_id, pedido_em) WHERE pedido_em IS NOT NULL;

COMMENT ON TABLE order_erp_sync IS
  'A fotografia do pedido como o Control o conhece. Migração 046. Divergência = comparar com os itens de hoje.';

-- Acrescentada em 15/09/2026, antes de a 046 ficar visível em qualquer banco.
-- Para quem já tinha criado a tabela sem ela: idempotente.
ALTER TABLE order_erp_sync ADD COLUMN IF NOT EXISTS assinatura_pedida TEXT;

-- Recarrega o cache do Supabase: sem isto a tabela pode existir no banco e
-- continuar invisível para o app (erro PGRST205). Foi o que aconteceu entre
-- 11/09 e 15/09/2026 — o botão ficou desligado nas duas marcas.
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rode depois; se responder 0, a tabela existe e está vazia
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT count(*) FROM order_erp_sync;
-- E no app, quem confere é: node _tools/conferir-046.mjs (tem de dizer "OK, a API enxerga a 046").
