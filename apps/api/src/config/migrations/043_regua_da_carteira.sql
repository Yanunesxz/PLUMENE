-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 043 — A régua da carteira passa a ser da fábrica
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (11/09/2026): "hoje temos os limites de clientes ativos,
-- inativos, e atenção mas a lista esta com 90 180 ou 180+ quero que o admin
-- possa mudar isso manualmente".
--
-- Os 90/180 estavam escritos no código (apps/web/src/lib/carteira.ts e
-- apps/api/src/modules/ia/ia.relatorio.ts). Viram coluna da empresa: cada
-- marca tem um giro diferente, e mudar a régua não pode depender de deploy.
--
-- O padrão é o que já valia, então rodar esta migração não muda cor de
-- ninguém — só abre a porta para o admin mexer.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS carteira_atencao_dias  INT NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS carteira_esfriado_dias INT NOT NULL DEFAULT 180;

COMMENT ON COLUMN companies.carteira_atencao_dias IS
  'Dias sem comprar para o cliente ficar AMARELO (atenção). Padrão 90.';
COMMENT ON COLUMN companies.carteira_esfriado_dias IS
  'Dias sem comprar para o cliente ficar VERMELHO (esfriado). Padrão 180. Tem de ser maior que carteira_atencao_dias.';

-- O amarelo antes do vermelho: fora dessa ordem a faixa do meio some e o
-- cliente pula de verde para vermelho sem ninguém ser avisado.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_regua_carteira_check;
ALTER TABLE companies ADD CONSTRAINT companies_regua_carteira_check
  CHECK (carteira_atencao_dias >= 1 AND carteira_esfriado_dias > carteira_atencao_dias);

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT name, carteira_atencao_dias, carteira_esfriado_dias FROM companies;
