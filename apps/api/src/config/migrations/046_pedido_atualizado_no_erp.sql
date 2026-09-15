-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 046 — "Atualizar no ERP": o que o Control conhece de cada pedido
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (11/09/2026): "depois que o pedido for enviado pelas vendedoras
-- internas e elas alterarem ele, temos que ter um botão depois que editou as
-- peças como 'atualizar no ERP', porque se ela mudar por lá tem que mudar no
-- ERP principal também".
--
-- O buraco: a venda interna (Simone, Nicoli) pode mexer nas peças do PRÓPRIO
-- pedido até o carimbo de faturado — inclusive DEPOIS de a Larissa lançar no
-- Control (regra da 031). Quando ela mexe, o Control fica com a versão velha e
-- ninguém na fábrica fica sabendo: a nota sai pelo pedido errado.
--
-- Esta tabela é a fotografia do que o Control CONHECE. Ela é tirada quando o
-- pedido é lançado e tirada de novo quando alguém confirma que atualizou lá.
-- "Está desatualizado" NÃO é uma coluna: é a comparação entre as peças de hoje
-- e esta foto. Coluna booleana desencontra do fato; comparação, não.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_erp_sync (
  order_id       UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- O número do Control no momento da foto, para a tela dizer qual pedido de lá.
  erp_order_id   TEXT,
  total          NUMERIC(12,2),
  pecas          INTEGER NOT NULL DEFAULT 0,
  -- O pedido como o Control o conhece: itens já com referência e tamanho.
  snapshot       JSONB NOT NULL,
  -- Quando o Control passou a conhecer ESTA versão (lançamento ou confirmação).
  confirmado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Quem pediu a atualização depois de editar, e quando. Limpo a cada foto nova.
  pedido_em      TIMESTAMPTZ,
  pedido_por     UUID REFERENCES users(id) ON DELETE SET NULL,
  -- O recado de quem pediu ("tirei 6 peças da 0124, faltou no estoque").
  observacao     TEXT,
  -- A impressão do pedido (assinaturaDoPedido, em shared) no momento do aviso.
  -- É ela que diz, sem se confundir com carimbo ou correção de número, se a
  -- venda interna mudou o pedido DE NOVO depois de avisar.
  assinatura_pedida TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_erp_sync_company ON order_erp_sync(company_id);
-- A fila "precisa atualizar no Control": quem pediu e ainda não foi confirmado.
CREATE INDEX IF NOT EXISTS idx_order_erp_sync_pedido
  ON order_erp_sync(company_id, pedido_em) WHERE pedido_em IS NOT NULL;

-- Acrescentada em 15/09/2026, antes de a 046 ficar visível em qualquer banco.
-- Para quem já tinha criado a tabela sem ela: idempotente.
ALTER TABLE order_erp_sync ADD COLUMN IF NOT EXISTS assinatura_pedida TEXT;

COMMENT ON TABLE order_erp_sync IS
  'A fotografia do pedido como o Control o conhece. Migração 046. Divergência = comparar com os itens de hoje.';
COMMENT ON COLUMN order_erp_sync.confirmado_em IS
  'Quando o Control passou a conhecer esta versão: no lançamento, ou quando alguém confirmou que atualizou lá.';
COMMENT ON COLUMN order_erp_sync.pedido_em IS
  'Quando alguém apertou "Atualizar no ERP" depois de editar. NULL = nada pedido.';

-- Recarrega o cache do Supabase: sem isto a tabela pode existir no banco e
-- continuar invisível para o app (erro PGRST205).
NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT o.order_number, s.erp_order_id, s.pecas AS pecas_no_control,
--        s.confirmado_em, s.pedido_em
--   FROM order_erp_sync s JOIN orders o ON o.id = s.order_id
--  ORDER BY s.pedido_em DESC NULLS LAST LIMIT 20;
