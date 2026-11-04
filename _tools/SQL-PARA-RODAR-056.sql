-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE).
--
-- Migração 056 — o papel "SAC": o atendimento, que monta pedido para qualquer
-- cliente, vê a carteira inteira e cadastra cliente novo. Cole TUDO de uma vez
-- e aperte Run. É idempotente (rodar duas vezes não faz mal) e só troca o
-- CHECK da coluna users.role para aceitar um papel a mais: nenhuma linha é
-- gravada, alterada ou apagada, nenhum login existente muda de papel. O
-- visualizador (054) continua aceito — a lista nova tem todos os papéis.
--
-- Pedido do Yan (04/11/2026): "cria um login pra SAC por favor, no SAC vai
-- poder criar pedido, ver todos os clientes, e vai ver criar cliente".
--
-- Sem este SQL, o admin escolhe "SAC" na tela de Logins e o banco recusa o
-- INSERT (violação de chk_users_role) — o login não nasce. A tela DIZ isso:
-- a API reconhece a recusa do CHECK (23514) e responde
--   503 {"error":"O banco ainda não aceita o papel SAC. Cole
--        _tools/SQL-PARA-RODAR-056.sql no SQL Editor dos dois bancos e tente
--        de novo. Nada foi criado nem alterado.","code":"MIGRACAO_PENDENTE"}
--
-- DEPOIS DE RODAR:
--   1. Confira aqui mesmo, no SQL Editor (tem de aparecer 'sac'):
--        SELECT pg_get_constraintdef(oid) FROM pg_constraint
--         WHERE conname = 'chk_users_role';
--   2. Da pasta do app:  node _tools/conferir-056.mjs
--   3. Crie o login em Logins → Novo login → papel "SAC". Ele passa a
--      aparecer em GET /usuarios — é essa a prova por GET.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── O CHECK da coluna users.role ────────────────────────────────────────────
--
-- Acha o CHECK atual pelo texto (o nome mudou ao longo das migrações: 001,
-- 014, 030, 038, 054), derruba e recria com o papel novo. Mesmo padrão da 054.

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
  CHECK (role IN ('admin', 'manager', 'rep', 'store', 'financeiro', 'relacionamento', 'visualizador', 'sac'));

COMMENT ON CONSTRAINT chk_users_role ON users IS
  'Os papéis que a coluna users.role aceita. sac (056, 04/11/2026): o atendimento — monta pedido para qualquer cliente (em nome próprio, vê só os seus), lê a carteira inteira e cadastra cliente novo; não decide, não fatura, não edita cadastro.';


-- Recarrega o cache do Supabase. Sem isto o CHECK novo pode valer no banco e a
-- API continuar recusando o papel por causa do schema velho em cache.
NOTIFY pgrst, 'reload schema';
