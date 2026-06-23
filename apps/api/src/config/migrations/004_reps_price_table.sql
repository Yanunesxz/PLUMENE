-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 004 — Tabela de preço POR REPRESENTANTE + dados do rep
-- Executar no Supabase SQL Editor (depois da 001/002/003).
--
-- Decisão (2026-06-23): cada representante atua em UMA tabela de preço fixa,
-- escolhida pelo gerente comercial no cadastro. O catálogo passa a precificar
-- pela tabela do representante logado. (Substitui a regra escalonada por total.)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_name     TEXT;   -- razão social
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS price_table_id UUID
  REFERENCES price_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_price_table ON users(price_table_id);
