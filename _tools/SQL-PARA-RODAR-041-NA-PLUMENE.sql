-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE DA **PLUMENE**
-- (banco ovucbjylmzykcloikvnk — o da Corpo Sensual JÁ tem isto desde 10/09)
--
-- Cole tudo de uma vez e aperte Run. É idempotente: rodar duas vezes não faz
-- mal nenhum.
--
-- Enquanto isto não roda, o representante da PLUMENE preenche CEP, bairro,
-- cidade, UF, Inscrição Estadual e observações no cadastro do cliente e esses
-- campos são DESCARTADOS em silêncio — só a linha de endereço é guardada.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── Endereço em campos, IE, observações e o registro de quem atrelou ───────
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
  ADD COLUMN IF NOT EXISTS erp_linked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS erp_linked_at TIMESTAMPTZ;


-- ─── O CPF/CNPJ só em dígitos, calculado pelo banco ────────────────────────
-- As linhas antigas guardam "22.518.613/0001-58" e as novas "22518613000158".
-- É por esta coluna que o app acha duplicata e busca por CNPJ.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cnpj_digits TEXT
    GENERATED ALWAYS AS (regexp_replace(COALESCE(cnpj, ''), '[^0-9]', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS idx_customers_company_cnpj_digits
  ON customers(company_id, cnpj_digits)
  WHERE cnpj_digits <> '';


-- ─── Etiquetas, para quem abrir a tabela entender ──────────────────────────
COMMENT ON COLUMN customers.cep IS 'CEP só dígitos (8). Obrigatório no cadastro pelo app desde 10/09/2026.';
COMMENT ON COLUMN customers.observacoes IS 'Observações do cliente — o campo "será inserido no pedido" do Control.';
COMMENT ON COLUMN customers.erp_linked_at IS 'Quando o financeiro atrelou o código do ERP a um cliente nascido no app.';
COMMENT ON COLUMN customers.cnpj_digits IS 'Gerada: CPF/CNPJ só em dígitos. É por ela que se acha duplicata.';


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rode depois; se responder uma linha, deu certo
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT count(*) AS clientes,
--        count(*) FILTER (WHERE cep IS NOT NULL) AS com_cep,
--        count(*) FILTER (WHERE cnpj_digits <> '') AS com_documento
--   FROM customers;
