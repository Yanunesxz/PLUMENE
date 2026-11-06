-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 056 — Papel "sac" (o atendimento: monta pedido, vê e cadastra cliente)
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (04/11/2026): "cria um login pra SAC por favor, no SAC vai
-- poder criar pedido, ver todos os clientes, e vai ver criar cliente".
--
-- O papel:
--   • MONTA pedido para qualquer cliente da empresa (POST /orders). O preço é
--     o do cadastro do cliente — ele não tem tabela própria, como o
--     financeiro. O pedido nasce em nome DELE, em rascunho; ele manda para a
--     fábrica, altera peças, condição e observação enquanto o pedido está com
--     ele e cancela antes do financeiro — igual ao representante. Vê SÓ os
--     próprios pedidos (orders.service filtra por rep_id, como para o rep).
--   • LÊ a carteira inteira (GET /customers e a ficha de qualquer cliente).
--   • CADASTRA cliente novo (POST /customers) com qualquer tabela ativa da
--     empresa — o cadastro chega para a Larissa incluir no Control, como os
--     outros.
--
-- E não faz o resto: desconto (a % é do representante), aprovar, recusar,
-- faturar, lançar no Control, editar cadastro, trocar tabela de cliente,
-- tarefas, representantes, painel, logins. A recusa é por PAPEL na rota
-- (requireRole), e as telas escondem o botão.
--
-- O CHECK de role nasceu na 001 com três papéis e foi recriado na 014
-- ('store'), na 030 ('financeiro'), na 038 ('relacionamento') e na 054
-- ('visualizador'); recria de novo, no mesmo padrão da 054 (a mais nova).
--
-- ENQUANTO ESTE SQL NÃO RODA: criar (ou editar) um login com o papel novo
-- responde 503 MIGRACAO_PENDENTE com a frase que diz qual papel o banco
-- recusou e manda colar _tools/SQL-PARA-RODAR-056.sql — a API reconhece a
-- recusa do CHECK (23514 em `role`) em users.service.ts. Não é 500: o admin
-- tem de poder ler na tela o que falta fazer. Nada é criado.
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
  CHECK (role IN ('admin', 'manager', 'rep', 'store', 'financeiro', 'relacionamento', 'visualizador', 'sac'));

COMMENT ON CONSTRAINT chk_users_role ON users IS
  'Os papéis que a coluna users.role aceita. sac (056, 04/11/2026): o atendimento — monta pedido para qualquer cliente (em nome próprio, vê só os seus), lê a carteira inteira e cadastra cliente novo; não decide, não fatura, não edita cadastro.';

-- Recarrega o cache do Supabase. Sem isto o CHECK novo pode valer no banco e a
-- API continuar recusando o papel por causa do schema velho em cache.
NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- No SQL Editor de CADA banco (tem de listar 'sac'):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_users_role';
--
-- Da pasta do app (confere o que a API consegue ver):
--   node _tools/conferir-056.mjs
--
-- A prova por GET é indireta e vem depois: o admin cria o login em
-- Logins → papel "SAC" e ele passa a aparecer em GET /usuarios.
