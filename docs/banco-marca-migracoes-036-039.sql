-- ─────────────────────────────────────────────────────────────────────────────
-- PLUMENE — pacote de migrações 036 a 039 (colar no SQL Editor do Supabase
-- DA PLUMENE, de uma vez). Idempotente. Espelha o que já rodou na Corpo
-- Sensual em 31/08/2026.
--
-- Depois de rodar, NÃO há carga de histórico aqui: a Plumene não tem retrato
-- do Control, então os selos de cor (verde/amarelo/vermelho) acendem conforme
-- os pedidos forem FATURADOS no app — que é o comportamento certo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 036: histórico de compra do cliente ─────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS last_purchase_at DATE,
  ADD COLUMN IF NOT EXISTS total_purchased NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS overdue_amount NUMERIC(12, 2);

CREATE INDEX IF NOT EXISTS idx_customers_ultima_compra
  ON customers(company_id, rep_erp_id, last_purchase_at);

-- ─── 037: tarefas do representante ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rep_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  rep_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  prazo TIMESTAMPTZ,
  local TEXT,
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'confirmada', 'feita')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rep_tasks_do_rep
  ON rep_tasks(company_id, rep_id, status, prazo);

-- ─── 038: papel "relacionamento" ─────────────────────────────────────────────
DO $$
DECLARE nome TEXT;
BEGIN
  SELECT conname INTO nome
    FROM pg_constraint
   WHERE conrelid = 'users'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF nome IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', nome);
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT chk_users_role
  CHECK (role IN ('admin', 'manager', 'rep', 'store', 'financeiro', 'relacionamento'));

-- ─── 039: controle de inatividade ────────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS inactivity_reason TEXT,
  ADD COLUMN IF NOT EXISTS inactivity_note TEXT,
  ADD COLUMN IF NOT EXISTS inactivity_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inactivity_updated_at TIMESTAMPTZ;

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_users_role';
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'customers' AND column_name LIKE 'inactivity%';
