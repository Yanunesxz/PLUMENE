-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 030 — O papel FINANCEIRO
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Quem recebe o que a fábrica aprovou e cuida do faturamento. O acesso é
-- "quase gerente": cria e altera pedido (mesmo os já aprovados), fatura, vê o
-- catálogo e todos os clientes — mas NÃO tem a parte de representantes. A
-- lista de pedidos dele mostra só o que a fábrica já mandou (aprovados), mais
-- os que ele próprio criar.
--
-- O CHECK de role foi criado na 001 com três papéis e recriado na 014 com o
-- 'store'; recria de novo incluindo 'financeiro' — o mesmo padrão da 014.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  nome_constraint TEXT;
BEGIN
  SELECT c.conname INTO nome_constraint
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'users'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%role%admin%';

  IF nome_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', nome_constraint);
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT chk_users_role
  CHECK (role IN ('admin', 'manager', 'rep', 'store', 'financeiro'));

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Depois de rodar, o admin cria o login em Logins → papel "Financeiro".
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'users'::regclass AND contype = 'c';
