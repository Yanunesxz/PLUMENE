-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 041 — Cadastro de cliente "mais real", igual ao do Control
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (10/09/2026): "vamos começar a cobrar CNPJ verdadeiro ou CPF
-- que os números condizem; cobrar melhor o endereço, sendo obrigatório o CEP;
-- deixar igual ao sistema do Fábio o que é obrigatório ou não; e quando
-- conectar no sistema vai ter que ter número dos clientes, e esses números vão
-- ter que ser incluídos e atrelados aos do sistema — já monta a estrutura".
--
-- A tela Cadastro > Clientes do Control tem o endereço em campos separados
-- (End. p/ Faturamento, Número, Complemento, Bairro, Cidade, U.F., CEP),
-- Inscrição Estadual e "Observações (será inserido no pedido)". O app guardava
-- tudo numa linha (033). Daqui em diante guarda os campos; a linha `address`
-- continua sendo escrita (planilha do Control, célula C4) — montada deles.
--
-- Nada aqui é NOT NULL de propósito: ~2.600 clientes vieram do ERP/cargas sem
-- esses campos, e a API do parceiro (POST /partner/v1/clientes) continua
-- gravando o que o Control mandar. Quem obriga é o schema do cadastro pelo app.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS logradouro TEXT,
  ADD COLUMN IF NOT EXISTS numero TEXT,
  ADD COLUMN IF NOT EXISTS complemento TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS cidade TEXT,
  ADD COLUMN IF NOT EXISTS uf TEXT,
  ADD COLUMN IF NOT EXISTS inscricao_estadual TEXT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT,
  -- O atrelamento do número do ERP a um cliente nascido no app: quem e quando.
  ADD COLUMN IF NOT EXISTS erp_linked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS erp_linked_at TIMESTAMPTZ;

-- O CPF/CNPJ só em dígitos, calculado pelo banco: as linhas antigas guardam
-- "22.518.613/0001-58" e as novas "22518613000158" — a busca e a checagem de
-- duplicidade precisam enxergar as duas como o mesmo documento.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cnpj_digits TEXT
    GENERATED ALWAYS AS (regexp_replace(COALESCE(cnpj, ''), '[^0-9]', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS idx_customers_company_cnpj_digits
  ON customers(company_id, cnpj_digits)
  WHERE cnpj_digits <> '';

COMMENT ON COLUMN customers.cep IS 'CEP só dígitos (8). Obrigatório no cadastro pelo app desde 10/09/2026.';
COMMENT ON COLUMN customers.observacoes IS 'Observações do cliente — o campo "será inserido no pedido" do Control.';
COMMENT ON COLUMN customers.erp_linked_at IS 'Quando o financeiro atrelou o código do ERP a um cliente nascido no app.';
COMMENT ON COLUMN customers.cnpj_digits IS 'Gerada: CPF/CNPJ só em dígitos. É por ela que se acha duplicata.';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FILTER (WHERE erp_id IS NULL) AS nascidos_no_app,
--        COUNT(*) FILTER (WHERE cep IS NOT NULL) AS com_cep
--   FROM customers;
