-- ============================================================================
-- 034 — Notificações push (Web Push)
--
-- Cada linha é UM aparelho que aceitou receber avisos do app. O `endpoint` é
-- o endereço que o navegador dá para aquele aparelho; `p256dh` e `auth` são as
-- chaves que cifram a mensagem para ele (padrão Web Push — sem Firebase, sem
-- serviço pago). A mesma pessoa pode ter vários aparelhos; aparelho que
-- desativar, trocar de navegador ou expirar é apagado pelo servidor na hora do
-- envio (resposta 404/410 do navegador).
--
-- Rodar no SQL Editor do Supabase. Idempotente: rodar duas vezes não dói.
-- ============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_company
  ON push_subscriptions(company_id);

-- A API usa a service_role; com RLS ligada e sem policy, nenhum outro caminho lê.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Conferência:
-- SELECT COUNT(*) FROM push_subscriptions;   -- 0 logo após criar
