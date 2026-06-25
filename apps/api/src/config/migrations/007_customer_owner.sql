-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 007 — Dono do cliente (acesso por representante)
-- Executar no Supabase SQL Editor.
--
-- rep_id = usuário (representante) que cadastrou o cliente no app.
-- O representante só enxerga os clientes onde rep_id = ele; gerente/admin veem
-- todos. Clientes vindos do ERP têm rep_id nulo (só gerente/admin os veem).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS rep_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_rep ON customers(rep_id);
