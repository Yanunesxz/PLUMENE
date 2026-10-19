-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE),
-- DEPOIS da 050.
--
-- Migração 055 — Pedido INATIVO: o carimbo de quem foi aprovado pelo
-- financeiro e depois inativado no Control. Cole TUDO de uma vez e aperte Run.
-- É idempotente (rodar duas vezes não faz mal) e só acrescenta: quatro colunas
-- em orders, um índice parcial e o CHECK de tipo do rastro com dois tipos a
-- mais; nenhuma coluna que o CRM lê muda, nenhuma linha é gravada ou apagada.
--
--   A → orders.inactive / inactive_at / inactive_by / inactive_note : o
--       carimbo "Pedido inativo" (financeiro/admin). O pedido continua na
--       lista, no status que tinha, e sai da bonificação do mês do envio
--   B → order_erp_events.tipo ganha 'pedido_inativado' e 'pedido_reativado'
--
-- Pedido do Yan (15/10/2026): "se o pedido for aprovado e depois inativado a
-- pessoa não recebe a bonificação".
--
-- Sem este SQL, "Inativar pedido" responde que falta a migração 055 e não
-- grava nada; a leitura segue normal (ninguém está inativo).
--
-- Depois da 055, NÃO rerode a 048, a 049 nem a 050 (recolocariam a lista
-- antiga no CHECK de tipo). O bloco 0 para com mensagem clara se a 050 ainda
-- não rodou neste banco — nada muda nesse caso.
--
-- DEPOIS DE RODAR, da pasta do app:
--   node _tools/conferir-055.mjs        (confere os DOIS bancos)
-- As conferências no SQL Editor estão no fim de
-- apps/api/src/config/migrations/055_pedido_inativo.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. A 050 precisa estar aplicada ─────────────────────────────────────────
-- B recria o CHECK da 050 com dois tipos a mais. Uma 055 aplicada antes da 050
-- deixaria o banco com as colunas novas (a API lê como "055 rodou") e, quando
-- a 050 viesse depois, ela recolocaria a lista SEM 'pedido_inativado' — e todo
-- inativar passaria a gravar rastro "falhou" em silêncio. Aqui o Postgres para
-- ANTES de mudar qualquer coisa e diz o que falta (16/10/2026; o mesmo bloco 0
-- que a 050 tem para a 049). O que se confere é o que só a 050 deixa: a
-- tabela deleted_customers e 'solicitacao_cancelada' no CHECK de tipo.

DO $$
DECLARE
  trava TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO trava
    FROM pg_constraint
   WHERE conname = 'chk_order_erp_events_tipo';
  IF to_regclass('public.deleted_customers') IS NULL
     OR trava IS NULL
     OR position('solicitacao_cancelada' IN trava) = 0 THEN
    RAISE EXCEPTION 'A 050 ainda nao rodou neste banco (falta deleted_customers ou solicitacao_cancelada no CHECK de order_erp_events.tipo). Cole _tools/SQL-PARA-RODAR-050.sql antes da 055.';
  END IF;
END $$;


-- ─── A. O carimbo no pedido ──────────────────────────────────────────────────
--
--   inactive       true = aprovado e depois inativado (no Control). Sai da
--                  bonificação; continua na lista, no status que tinha
--   inactive_at    quando foi marcado. NULL ao reativar
--   inactive_by    quem marcou (financeiro/admin). SET NULL se o login sumir
--   inactive_note  a observação de quem marcou (opcional, até 500 letras)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inactive BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inactive_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inactive_note TEXT;

-- Os inativos de uma empresa são poucos: índice parcial, só sobre eles.
CREATE INDEX IF NOT EXISTS idx_orders_inativos ON orders (company_id) WHERE inactive;

COMMENT ON COLUMN orders.inactive IS
  'Pedido inativo (migração 055): aprovado pelo financeiro e depois inativado no Control. Não é status — o pedido continua na lista — mas sai da bonificação do mês do envio. Marcado à mão por financeiro/admin; reativável.';
COMMENT ON COLUMN orders.inactive_at IS
  'Quando o pedido foi marcado como inativo. NULL = não está inativo (ou foi reativado).';
COMMENT ON COLUMN orders.inactive_by IS
  'Quem marcou o pedido como inativo (financeiro ou admin). O rastro completo fica em order_erp_events (pedido_inativado / pedido_reativado).';
COMMENT ON COLUMN orders.inactive_note IS
  'Observação de quem inativou (opcional, até 500 letras). Apagada ao reativar; o texto sobrevive em order_erp_events.motivo.';

-- ─── B. Rastro: inativado e reativado ────────────────────────────────────────
-- A lista da 050 inteira MAIS:
--   pedido_inativado   financeiro/admin marcou "Pedido inativo" na tela
--   pedido_reativado   desfez o carimbo
-- A lista vive aqui e em eventosErp.service.ts (TIPOS_DE_EVENTO_ERP) —
-- tests/migracao-055.test.ts confere que são as mesmas. DROP + ADD para que
-- rerodar este arquivo sempre deixe esta lista valendo. Só quando a tabela do
-- rastro existe (048): sem ela não há CHECK a recriar, e o carimbo funciona
-- do mesmo jeito (o evento não é gravado).

DO $$
BEGIN
  IF to_regclass('public.order_erp_events') IS NOT NULL THEN
    ALTER TABLE order_erp_events DROP CONSTRAINT IF EXISTS chk_order_erp_events_tipo;
    ALTER TABLE order_erp_events ADD CONSTRAINT chk_order_erp_events_tipo
      CHECK (tipo IN ('numero_gravado', 'numero_corrigido', 'numero_conciliado',
                      'faturado', 'faturamento_alterado', 'faturamento_desfeito',
                      'nota_registrada', 'nota_cancelada', 'excluido',
                      'recusado_pelo_erp', 'alterado_antes_da_confirmacao',
                      'solicitado_ao_erp', 'nota_substituida', 'excluido_pelo_erp',
                      'solicitacao_cancelada',
                      'pedido_inativado', 'pedido_reativado'));
  END IF;
END $$;

-- Recarrega o cache do Supabase. Sem isto as colunas podem existir no banco e
-- continuar invisíveis para a API (erro PGRST204), e o carimbo segue
-- respondendo "precisa da migração 055" com ela já rodada.
NOTIFY pgrst, 'reload schema';
