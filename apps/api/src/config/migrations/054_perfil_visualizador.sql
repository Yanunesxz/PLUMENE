-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 054 — Papel "visualizador" (o login que só olha)
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (15/10/2026): "coloca o login como visualizador, cria ele, ele
-- pode ver tudo so nao pode alterar nada, nao pode mudar logins e etc.. deixa
-- ele pra ser visualizador e cria essa opção de login, ve cliente, produto ve
-- tudo tudo mas nao altera nada".
--
-- O papel só LÊ: pedidos de qualquer representante (lista, detalhe, excluídos,
-- cancelados), clientes de qualquer carteira, catálogo, painel, relatórios de
-- tela, representantes, a LISTA de logins (para saber quem tem acesso),
-- tarefas e a tela da integração com o Control. Exportar planilha e CSV
-- também, porque exportar só lê.
--
-- E não grava NADA: nenhuma rota de POST/PATCH/PUT/DELETE aceita o papel —
-- nem pedido, nem cliente, nem faturamento, nem login, nem importação, nem a
-- API de Parceiro. A recusa é por PAPEL na rota (requireRole), não por botão
-- escondido; tests/visualizador-inventario.test.ts quebra sozinho se alguém
-- criar rota de escrita nova e esquecer disso.
--
-- O CHECK de role nasceu na 001 com três papéis e foi recriado na 014
-- ('store'), na 030 ('financeiro') e na 038 ('relacionamento'); recria de
-- novo, no mesmo padrão da 038 (a mais nova).
--
-- ENQUANTO ESTE SQL NÃO RODA: criar (ou editar) um login com o papel novo
-- responde 503 MIGRACAO_PENDENTE com a frase que manda colar
-- _tools/SQL-PARA-RODAR-054.sql — a API reconhece a recusa do CHECK (23514 em
-- `role`) em users.service.ts. Não é 500: o admin tem de poder ler na tela o
-- que falta fazer.
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- No SQL Editor de CADA banco (tem de listar 'visualizador'):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_users_role';
--
-- Da pasta do app (confere o que a API consegue ver):
--   node _tools/conferir-054.mjs
--
-- A prova por GET é indireta e vem depois: o admin cria o login em
-- Logins → papel "Visualizador" e ele passa a aparecer em GET /usuarios.
