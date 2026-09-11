-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE)
--
-- Cole tudo de uma vez e aperte Run. É idempotente: rodar duas vezes não faz
-- mal nenhum. O app já está no ar e funciona sem isto — só que os três
-- recursos abaixo ficam desligados até rodar.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 042 · Dois pedidos nunca com o mesmo número do Control ─────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_company_erp_order
  ON orders(company_id, erp_order_id) WHERE erp_order_id IS NOT NULL;


-- ─── 043 · A régua da carteira vira da fábrica (o admin muda no Painel) ─────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS carteira_atencao_dias  INT NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS carteira_esfriado_dias INT NOT NULL DEFAULT 180;

COMMENT ON COLUMN companies.carteira_atencao_dias IS
  'Dias sem comprar para o cliente ficar AMARELO (atenção). Padrão 90.';
COMMENT ON COLUMN companies.carteira_esfriado_dias IS
  'Dias sem comprar para o cliente ficar VERMELHO (esfriado). Padrão 180.';

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_regua_carteira_check;
ALTER TABLE companies ADD CONSTRAINT companies_regua_carteira_check
  CHECK (carteira_atencao_dias >= 1 AND carteira_esfriado_dias > carteira_atencao_dias);


-- ─── 044 · A cópia do pedido original, antes do corte de peça ───────────────
CREATE TABLE IF NOT EXISTS order_originals (
  order_id     UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  total        NUMERIC(12,2),
  pecas        INTEGER NOT NULL DEFAULT 0,
  snapshot     JSONB NOT NULL,
  motivo       TEXT,
  guardado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  guardado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_originals_company ON order_originals(company_id);

COMMENT ON TABLE order_originals IS
  'O pedido como o representante fechou, antes do primeiro corte de peça. Migração 044.';


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rode depois e veja se as três linhas respondem
-- ═══════════════════════════════════════════════════════════════════════════
-- 042:
--   SELECT indexname FROM pg_indexes WHERE indexname = 'idx_orders_company_erp_order';
-- 043:
--   SELECT name, carteira_atencao_dias, carteira_esfriado_dias FROM companies;
-- 044:
--   SELECT count(*) FROM order_originals;
