-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE).
--
-- Migração 058 — CASHBACK da venda interna. Cole TUDO de uma vez e aperte Run.
-- É idempotente (rodar duas vezes não faz mal) e só acrescenta: uma coluna em
-- companies e uma tabela nova; nenhum pedido é tocado.
--
--   A → companies.cashback_inicio : só pedido faturado a partir daqui gera
--       cashback (fica com a hora em que este SQL rodou)
--   B → cashback_usos : o cashback abatido em cada pedido (um por pedido)
--
-- Pedido do Yan (12/11/2026): 3% do valor faturado dos pedidos da venda
-- interna, válido 90 dias a partir do faturamento, abatido no próximo pedido
-- com a linha "Utilizado R$ X do cashback" na observação.
--
-- Sem este SQL, a área Cashback mostra que falta a migração 058 e os cartões
-- de cashback (no pedido e na Minha área da loja) simplesmente não aparecem.
--
-- Não depende de outra migração além da 031 (venda interna) e não mexe no
-- CHECK do rastro (order_erp_events): pode rodar em qualquer ordem.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Quando o programa começou ────────────────────────────────────────────
-- Só pedido faturado A PARTIR daqui gera cashback — senão os faturados dos
-- últimos 90 dias virariam saldo de uma vez. O DEFAULT now() preenche as
-- empresas que já existem com a hora em que este SQL rodou (a mesma para
-- todas) e a empresa nova com a hora em que nasceu.
--
-- Para começar de outra data (contar um mês para trás, por exemplo):
--   UPDATE companies SET cashback_inicio = '2026-11-01 00:00-03';

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS cashback_inicio TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN companies.cashback_inicio IS
  'Cashback da venda interna (migração 058): só pedido faturado a partir deste momento gera crédito (3% do valor faturado, válido 90 dias).';


-- ─── B. O uso do cashback num pedido ─────────────────────────────────────────
--
--   order_id        o pedido em que o cashback foi abatido. UM uso por pedido
--                   (UNIQUE): mudar o valor = desfazer e usar de novo.
--                   CASCADE: pedido excluído devolve o cashback ao cliente.
--                   O cliente é o DO PEDIDO — trocar o cliente do pedido leva
--                   o uso junto, e a exclusão de cliente com junção (050), que
--                   move os pedidos, também.
--   valor           quanto foi abatido (o que está escrito na observação)
--   usado_em        quando — o uso consome os créditos que valiam nesse dia
--   usado_por(_nome) quem usou (venda interna, financeiro ou admin)

CREATE TABLE IF NOT EXISTS cashback_usos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  valor           NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
  usado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  usado_por       UUID REFERENCES users(id) ON DELETE SET NULL,
  usado_por_nome  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cashback_usos_pedido UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_cashback_usos_empresa ON cashback_usos (company_id, usado_em DESC);

-- A API usa a service role (ignora RLS); a trava é para qualquer outro acesso.
ALTER TABLE cashback_usos ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE cashback_usos IS
  'Cashback abatido num pedido (migração 058). Um por pedido; a linha "Utilizado R$ X do cashback" vai na observação. O crédito não fica aqui: é lido dos pedidos faturados da venda interna.';

-- Recarrega o cache do Supabase. Sem isto a tabela existe e a API continua
-- sem enxergá-la (PGRST205) — e a tela segue dizendo que falta a 058.
NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT id, name, cashback_inicio FROM companies;
-- SELECT u.valor, u.usado_em, u.usado_por_nome, o.order_number
--   FROM cashback_usos u JOIN orders o ON o.id = u.order_id
--  ORDER BY u.usado_em DESC LIMIT 20;
