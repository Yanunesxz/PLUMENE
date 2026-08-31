-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 033 — Endereço do cliente cadastrado no app
-- Executar no Supabase SQL Editor. Idempotente.
--
-- A coluna existia no banco da Corpo Sensual criada À MÃO (fora das migrações)
-- e o cadastro de cliente sempre gravou nela. Numa instalação nova (Plumene),
-- que nasce só das migrações, a coluna não existia — e todo POST /customers
-- morria em 500 "Não foi possível criar o cliente", mesmo com o formulário
-- inteiro certo. Bug encontrado quando a Simone (rep Plumene) não conseguia
-- cadastrar ninguém, em 28/08/2026.
--
-- Regra que fica: coluna nova em produção SÓ entra por migração numerada.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN customers.address IS
  'Endereço completo, texto livre — preenchido no cadastro pelo app. Cliente do ERP chega sem endereço (o sync não traz).';
