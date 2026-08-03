-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 018 — Tabelas de preço por representante
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- Até aqui cada representante tinha UMA tabela (users.price_table_id, migração
-- 004). A fábrica atribui tabela por região e alguns reps atendem mais de uma:
-- João só a 1, Maria só a 2, Wesley as duas — e é o Wesley quem decide qual
-- tabela cada cliente dele usa.
--
-- A regra que organiza o resto:
--   • o PREÇO de um cliente é customers.price_table_id;
--   • o conjunto aqui não define preço, define o que o rep PODE ATRIBUIR.
--
-- users.price_table_id continua existindo com um significado só: a tabela que o
-- representante vê no catálogo quando não há cliente em jogo. Invariante
-- garantida pela aplicação: ela sempre pertence ao conjunto do rep.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rep_price_tables (
  company_id     UUID NOT NULL REFERENCES companies(id)    ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  price_table_id UUID NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, price_table_id)
);

COMMENT ON TABLE rep_price_tables IS
  'Tabelas que o representante PODE atribuir a um cliente ou a uma vitrine. Não define preço — o preço do cliente é customers.price_table_id.';

-- A consulta quente é "quais tabelas são deste rep", sempre com company_id.
CREATE INDEX IF NOT EXISTS idx_rep_price_tables_rep
  ON rep_price_tables(company_id, user_id);

ALTER TABLE rep_price_tables ENABLE ROW LEVEL SECURITY;

-- ─── Semeadura ───────────────────────────────────────────────────────────────
-- Cada rep existente recebe exatamente a tabela que já tinha. Depois desta
-- migração o comportamento é idêntico ao de antes: ninguém ganha nem perde
-- acesso. O gerente amplia quando quiser, pela tela de Representantes.
INSERT INTO rep_price_tables (company_id, user_id, price_table_id)
SELECT u.company_id, u.id, u.price_table_id
  FROM users u
 WHERE u.role = 'rep'
   AND u.price_table_id IS NOT NULL
ON CONFLICT (user_id, price_table_id) DO NOTHING;

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT u.name, u.email, pt.name AS tabela
--   FROM rep_price_tables rpt
--   JOIN users u        ON u.id  = rpt.user_id
--   JOIN price_tables pt ON pt.id = rpt.price_table_id
--  ORDER BY u.name, pt.name;
