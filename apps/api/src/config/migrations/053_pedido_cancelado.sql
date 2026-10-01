-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 053 — Pedido CANCELADO com motivo
-- Executar no Supabase SQL Editor (CS e PLUMENE). Idempotente.
--
-- Pedido da Larissa pelo Yan (30/09/2026): "um pedido que chegou no app será
-- cancelado — já existe uma opção que eu possa marcar e informar o motivo?"
-- Yan: "cria um campo de cancelados, como o de faturados; ela coloca dentro do
-- pedido uma observação. Os motivos, deixe que o admin crie e escolha — mas já
-- pode criar estes": CLIENTE CANCELOU · CLIENTE COM PROTESTO - REPRESENTANTE
-- NÃO AUTORIZOU · CLIENTE COM PARCELA VENCIDA · PEDIDO EM DUPLICIDADE.
--
-- Cancelar NÃO cria status novo: o pedido vai para 'rejected', que todas as
-- filas, a meta e o CRM já tratam como fora do caminho. O que entra é o
-- PORQUÊ, o quem e o quando — colunas aditivas, nada renomeado.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_cancel_reasons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label       TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 120),
  -- Desativar em vez de apagar: pedido antigo guarda o motivo pelo texto
  -- (orders.cancel_reason_label), mas a lista do admin continua honesta.
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_cancel_reasons_company ON order_cancel_reasons(company_id, active, sort_order);

-- Os quatro do Yan, em toda empresa que ainda não tiver motivo nenhum.
INSERT INTO order_cancel_reasons (company_id, label, sort_order)
SELECT c.id, m.label, m.ordem
  FROM companies c
 CROSS JOIN (VALUES
   ('CLIENTE CANCELOU', 1),
   ('CLIENTE COM PROTESTO - REPRESENTANTE NÃO AUTORIZOU', 2),
   ('CLIENTE COM PARCELA VENCIDA', 3),
   ('PEDIDO EM DUPLICIDADE', 4)
 ) AS m(label, ordem)
 WHERE NOT EXISTS (SELECT 1 FROM order_cancel_reasons r WHERE r.company_id = c.id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancel_reason_id UUID REFERENCES order_cancel_reasons(id) ON DELETE SET NULL,
  -- O texto do motivo NA HORA: o admin pode renomear ou desativar depois.
  ADD COLUMN IF NOT EXISTS cancel_reason_label TEXT,
  ADD COLUMN IF NOT EXISTS cancel_note TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON TABLE order_cancel_reasons IS 'Motivos de cancelamento de pedido — o admin cria, renomeia e desativa.';
COMMENT ON COLUMN orders.cancelled_at IS 'Quando o pedido foi cancelado (status vai a rejected). NULL = não foi cancelado por este caminho.';
COMMENT ON COLUMN orders.cancel_reason_label IS 'O motivo escolhido, pelo texto que tinha na hora.';
COMMENT ON COLUMN orders.cancel_note IS 'Observação de quem cancelou (opcional).';

NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT label, active FROM order_cancel_reasons ORDER BY company_id, sort_order;
