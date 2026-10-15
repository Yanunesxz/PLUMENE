-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE).
--
-- Migração 054 — o papel "visualizador": o login que vê tudo e não altera
-- nada. Cole TUDO de uma vez e aperte Run. É idempotente (rodar duas vezes não
-- faz mal) e só troca o CHECK da coluna users.role para aceitar um papel a
-- mais: nenhuma linha é gravada, alterada ou apagada, nenhum login existente
-- muda de papel.
--
-- Pedido do Yan (15/10/2026): "coloca o login como visualizador, cria ele, ele
-- pode ver tudo so nao pode alterar nada, nao pode mudar logins e etc.. deixa
-- ele pra ser visualizador e cria essa opção de login, ve cliente, produto ve
-- tudo tudo mas nao altera nada".
--
-- Sem este SQL, o admin escolhe "Visualizador" na tela de Logins e o banco
-- recusa o INSERT (violação de chk_users_role) — o login não nasce. A tela
-- DIZ isso: a API reconhece a recusa do CHECK (23514) e responde
--   503 {"error":"O banco ainda não aceita o papel Visualizador. Cole
--        _tools/SQL-PARA-RODAR-054.sql no SQL Editor dos dois bancos e tente
--        de novo. Nada foi criado nem alterado.","code":"MIGRACAO_PENDENTE"}
-- em vez do "Não foi possível concluir a operação" de antes (15/10/2026).
--
-- DEPOIS DE RODAR:
--   1. Confira aqui mesmo, no SQL Editor (tem de aparecer 'visualizador'):
--        SELECT pg_get_constraintdef(oid) FROM pg_constraint
--         WHERE conname = 'chk_users_role';
--   2. Da pasta do app:  node _tools/conferir-054.mjs
--   3. Crie o login em Logins → Novo login → papel "Visualizador". Ele passa a
--      aparecer em GET /usuarios — é essa a prova por GET.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── O CHECK da coluna users.role ────────────────────────────────────────────
--
-- Acha o CHECK atual pelo texto (o nome mudou ao longo das migrações: 001,
-- 014, 030, 038), derruba e recria com o papel novo. Mesmo padrão da 038.

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
  CHECK (role IN ('admin', 'manager', 'rep', 'store', 'financeiro', 'relacionamento', 'visualizador'));

COMMENT ON CONSTRAINT chk_users_role ON users IS
  'Os papéis que a coluna users.role aceita. visualizador (054, 15/10/2026): lê tudo o que o escritório lê e não grava nada — nenhuma rota de escrita aceita o papel.';


-- Recarrega o cache do Supabase. Sem isto o CHECK novo pode valer no banco e a
-- API continuar recusando o papel por causa do schema velho em cache.
NOTIFY pgrst, 'reload schema';
