-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 052 — Cliente INATIVO (fora da régua, motivo de lista fechada)
-- Executar no Supabase SQL Editor (CS e PLUMENE). Idempotente.
--
-- Pedido do Yan (22/09/2026): "aba de clientes inativos; colocar que o cliente
-- é inativo deixa ele como não precisar reativar ou esfriado — são clientes
-- que não compram mais, que não trabalham com pijamas; o motivo precisa ser
-- selecionado, não escrito". Controle interno: não vai ao Control nem vem
-- dele. O CRM (CSP 360) tem o mesmo status como "Perdido manual" e lê estas
-- colunas direto (por updated_at); as chaves de motivo são as DELE.
--
-- Diferente da 039 (inactivity_reason = o rep explica por que o cliente
-- ESFRIOU, e ele continua na régua) e igual à 047 (varejo): inativo é status
-- definitivo — sai de Atenção/Esfriados, dos alertas e do relatório.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS inativo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inativo_motivo TEXT,
  ADD COLUMN IF NOT EXISTS inativo_nota TEXT,
  ADD COLUMN IF NOT EXISTS inativo_marcado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inativo_marcado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inativo_origem TEXT;

-- As chaves do CRM. Mudar aqui = mudar lá (packages/shared/src/constants/clienteInativo.ts).
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_inativo_motivo_valido;
ALTER TABLE customers
  ADD CONSTRAINT customers_inativo_motivo_valido CHECK (
    inativo_motivo IS NULL OR inativo_motivo IN (
      'fechou-a-loja', 'mudou-de-segmento', 'nao-quer-relacionamento', 'reativacao-esgotada', 'outro'
    )
  );

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_inativo_origem_valida;
ALTER TABLE customers
  ADD CONSTRAINT customers_inativo_origem_valida CHECK (inativo_origem IS NULL OR inativo_origem IN ('app', 'crm'));

COMMENT ON COLUMN customers.inativo IS
  'Cliente inativo (controle interno): não compra mais. Sai da régua da carteira, dos alertas e do relatório. Espelhado no CRM como "Perdido manual".';
COMMENT ON COLUMN customers.inativo_motivo IS
  'Chave do motivo, a mesma do CRM: fechou-a-loja | mudou-de-segmento | nao-quer-relacionamento | reativacao-esgotada | outro.';
COMMENT ON COLUMN customers.inativo_nota IS 'Nota curta — obrigatória quando o motivo é "outro".';
COMMENT ON COLUMN customers.inativo_origem IS 'Quem marcou por último: app ou crm.';

-- Lista "Inativos" da empresa, sem varrer a tabela inteira.
CREATE INDEX IF NOT EXISTS idx_customers_inativos ON customers(company_id) WHERE inativo;

NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT name, inativo_motivo, inativo_marcado_em, inativo_origem FROM customers WHERE inativo LIMIT 20;
