-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE).
--
-- Migração 051 — edição do cadastro do cliente: o histórico e a fila para o
-- Control. Cole TUDO de uma vez e aperte Run. É idempotente (rodar duas vezes
-- não faz mal) e só acrescenta: cria a tabela customer_changes; nenhuma coluna
-- que o CRM lê muda, nenhuma linha é gravada ou apagada.
--
--   A → customer_changes : cada edição do cadastro feita pelo app, com antes
--       e depois de cada campo. A edição de cliente que já está no Control
--       nasce pendente — é a fila do que precisa ser atualizado lá
--
-- Sem este SQL, "Editar cadastro" responde que falta a migração 051 e não
-- grava nada.
--
-- DEPOIS DE RODAR, da pasta do app:
--   node _tools/conferir-051.mjs        (confere os DOIS bancos)
-- As conferências no SQL Editor estão no fim de
-- apps/api/src/config/migrations/051_edicao_do_cadastro_do_cliente.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. O histórico das edições do cadastro ──────────────────────────────────
--
--   customer_id              o cliente editado. CASCADE: excluir o cliente
--                            (050) leva o histórico junto — a cópia da linha
--                            inteira fica em deleted_customers
--   alterado_por(_nome)      quem editou; o nome vai junto porque o login pode
--                            ser apagado (aí alterado_por vira NULL)
--   alterado_em              quando a edição foi gravada
--   campos                   {"whatsapp": {"antes": "3299…", "depois": "3298…"}, …}
--                            valores NORMALIZADOS (documento e CEP só em
--                            dígitos, UF maiúscula, vazio = null). Inclui
--                            "address" quando a linha do endereço foi
--                            recalculada a partir das peças
--   erp_pendente             true = o cliente já tinha erp_id na hora da
--                            edição, então o Control precisa receber a
--                            mudança. false = cliente nascido no app ainda não
--                            incluído: o financeiro inclui com os dados de hoje.
--                            Vira true quando o Control adota o cliente pelo
--                            CNPJ (API de Parceiro) mandando outro valor: ele
--                            já tinha puxado o cliente antes da edição
--   erp_atualizado_em        quando o Control ficou em dia com esta edição.
--                            NULL + erp_pendente = ainda na fila
--   erp_atualizado_por(_nome) quem confirmou "Já atualizei no Control" (NULL
--                            quando foi o Control, pela API)
--   erp_atualizado_via       'app' = alguém confirmou na ficha; 'api' = o
--                            Control devolveu o mesmo valor pela API de Parceiro

CREATE TABLE IF NOT EXISTS customer_changes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id             UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  alterado_por            UUID REFERENCES users(id) ON DELETE SET NULL,
  alterado_por_nome       TEXT,
  alterado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  campos                  JSONB NOT NULL,
  erp_pendente            BOOLEAN NOT NULL DEFAULT false,
  erp_atualizado_em       TIMESTAMPTZ,
  erp_atualizado_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  erp_atualizado_por_nome TEXT,
  erp_atualizado_via      TEXT CHECK (erp_atualizado_via IN ('app', 'api'))
);

-- A ficha do cliente: "as edições deste cliente, as mais novas primeiro".
CREATE INDEX IF NOT EXISTS idx_customer_changes_do_cliente
  ON customer_changes (company_id, customer_id, alterado_em DESC);

-- A fila do Control: só as que ainda esperam. Parcial porque, com o tempo,
-- quase todas as linhas estarão resolvidas — a fila é sempre pequena.
CREATE INDEX IF NOT EXISTS idx_customer_changes_pendentes
  ON customer_changes (company_id, customer_id)
  WHERE erp_pendente AND erp_atualizado_em IS NULL;

-- Como nas outras tabelas: só a API (service role) lê e grava.
ALTER TABLE customer_changes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE customer_changes IS
  'Cada edição do cadastro do cliente feita pelo app (PATCH /customers/:id/cadastro), com antes e depois de cada campo. Pendente (erp_pendente e erp_atualizado_em nulo) = o Control ainda não recebeu a mudança. Migração 051.';
COMMENT ON COLUMN customer_changes.campos IS
  'Campo → {antes, depois}, valores normalizados (documento e CEP só dígitos). Inclui address quando a linha do endereço foi recalculada. Migração 051.';
COMMENT ON COLUMN customer_changes.erp_pendente IS
  'A mudança precisa chegar ao Control: o cliente já tinha erp_id quando foi editado, ou o Control o adotou pelo CNPJ (API de Parceiro) com outro valor. Migração 051.';
COMMENT ON COLUMN customer_changes.erp_atualizado_via IS
  'app = alguém confirmou na ficha que atualizou o Control; api = o Control devolveu o mesmo valor pela API de Parceiro. Migração 051.';


-- Recarrega o cache do Supabase. Sem isto a tabela pode existir no banco e
-- continuar invisível para a API (erro PGRST205).
NOTIFY pgrst, 'reload schema';
