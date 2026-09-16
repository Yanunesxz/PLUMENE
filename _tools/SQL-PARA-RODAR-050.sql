-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE),
-- DEPOIS da 049 (o bloco 0 para com mensagem clara se ela ainda não rodou).
--
-- Migração 050 — cliente excluído e solicitação ao Control cancelada. Cole
-- TUDO de uma vez e aperte Run. É idempotente (rodar duas vezes não faz mal) e
-- só acrescenta: nenhuma coluna que o CRM lê muda, nenhuma linha é apagada.
--
--   0 → trava: para antes de mudar qualquer coisa se a 049 não rodou
--   A → deleted_customers : a cópia do cliente antes do DELETE, com o cadastro
--       em que foi juntado (juntado_em), quantos pedidos mudaram de dono, quem
--       excluiu e o motivo. É a tabela que o CRM pode ler
--   B → order_erp_events : 'solicitacao_cancelada' no CHECK de tipo
--
-- DEPOIS DE RODAR, da pasta do app:
--   node _tools/conferir-050.mjs                      (banco da Corpo Sensual)
--   node _tools/conferir-050.mjs <raiz da PLUMENE>    (banco da PLUMENE)
-- As conferências no SQL Editor estão no fim de
-- apps/api/src/config/migrations/050_cliente_excluido_e_solicitacao.sql.
--
-- Depois da 050, NÃO rerode a 048 nem a 049: o CHECK de order_erp_events.tipo
-- delas recolocaria a lista antiga.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. A 049 precisa estar aplicada ─────────────────────────────────────────
-- B recria o CHECK da 049 com um tipo a mais, e o código do cancelamento da
-- solicitação usa orders.erp_requested_at (049). Uma 050 aplicada sem a 049
-- deixaria o banco com a tabela nova (que a API lê como "050 rodou") e sem as
-- colunas de que ela depende. Aqui o Postgres para ANTES de mudar qualquer
-- coisa e diz o que falta.

DO $$
BEGIN
  IF to_regclass('public.order_erp_events') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'orders'
          AND column_name  = 'erp_requested_at'
     ) THEN
    RAISE EXCEPTION 'A 049 ainda nao rodou neste banco (falta orders.erp_requested_at ou order_erp_events). Cole _tools/SQL-PARA-RODAR-049.sql antes da 050.';
  END IF;
END $$;


-- ─── A. Cliente excluído ─────────────────────────────────────────────────────
-- "Excluir cliente" (só admin) apaga a linha de `customers`. Antes do DELETE a
-- API grava aqui a linha inteira como estava, e move pedidos, convites,
-- vitrines, tarefas e o login de loja para o cadastro que fica (juntado_em).
-- Nada some sem rastro: o pedido que tinha o cliente excluído aponta para o
-- que ficou, e esta linha diz de qual cadastro ele veio.
--
--   customer_id      o id que o cliente tinha em `customers` (a linha de lá já
--                    não existe — por isso sem chave estrangeira)
--   erp_id           o código do cliente no Control, como estava
--   cnpj_digits      o documento só em dígitos (a coluna gerada da 041), para o
--                    CRM achar o cadastro que ficou sem abrir o snapshot
--   juntado_em       o cadastro que ficou; NULL = excluído sem juntar (não
--                    tinha pedido nem vínculo). Sem chave estrangeira: se o que
--                    ficou for excluído depois, este rastro continua
--   snapshot         a linha de `customers` inteira, como estava
--   pedidos_movidos  quantos pedidos passaram para juntado_em
--   deleted_by(_name) quem excluiu; o nome vai junto porque o login pode sumir
--   motivo           o que o admin escreveu no diálogo

CREATE TABLE IF NOT EXISTS deleted_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL,
  erp_id          TEXT,
  cnpj_digits     TEXT,
  juntado_em      UUID,
  snapshot        JSONB NOT NULL,
  pedidos_movidos INTEGER NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_by_name TEXT,
  motivo          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A consulta do CRM e do admin: "os excluídos desta empresa, os mais recentes primeiro".
CREATE INDEX IF NOT EXISTS idx_deleted_customers_da_empresa
  ON deleted_customers (company_id, deleted_at DESC);

-- Como nas outras tabelas: só a API (service role) lê e grava.
ALTER TABLE deleted_customers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE deleted_customers IS
  'Cópia de cada cliente no instante em que foi excluído pelo app (só admin), com o cadastro em que foi juntado. Sem FK em customer_id e juntado_em: sobrevive à exclusão. Migração 050.';
COMMENT ON COLUMN deleted_customers.juntado_em IS
  'O cliente que ficou com os pedidos, convites, vitrines, tarefas e o login de loja deste. NULL = excluído sem juntar. Migração 050.';


-- ─── B. Rastro: a solicitação ao Control cancelada ───────────────────────────
-- A lista da 049 inteira MAIS:
--   solicitacao_cancelada  o financeiro tirou da fila do Control um pedido
--                          solicitado que ainda não tinha número
--                          (PATCH /orders/:id/cancelar-solicitacao)
-- A lista vive aqui e em eventosErp.service.ts (TIPOS_DE_EVENTO_ERP) —
-- tests/migracao-050.test.ts confere que são as mesmas. DROP + ADD para que
-- rerodar este arquivo sempre deixe esta lista valendo. As linhas de hoje só
-- têm tipos da 049, então o CHECK novo as aceita.

ALTER TABLE order_erp_events DROP CONSTRAINT IF EXISTS chk_order_erp_events_tipo;
ALTER TABLE order_erp_events ADD CONSTRAINT chk_order_erp_events_tipo
  CHECK (tipo IN ('numero_gravado', 'numero_corrigido', 'numero_conciliado',
                  'faturado', 'faturamento_alterado', 'faturamento_desfeito',
                  'nota_registrada', 'nota_cancelada', 'excluido',
                  'recusado_pelo_erp', 'alterado_antes_da_confirmacao',
                  'solicitado_ao_erp', 'nota_substituida', 'excluido_pelo_erp',
                  'solicitacao_cancelada'));


-- Recarrega o cache do Supabase. Sem isto a tabela pode existir no banco e
-- continuar invisível para a API (erro PGRST205).
NOTIFY pgrst, 'reload schema';
