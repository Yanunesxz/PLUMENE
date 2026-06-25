-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 005 — Comissão por representante
-- Executar no Supabase SQL Editor.
--
-- commission_rate = percentual de comissão do representante (ex.: 10 = 10%).
-- Média/padrão dos representantes = 10%.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10;
