-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 038 — Papel "relacionamento" (a conta da Bruna)
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (31/08/2026): a Bruna cuida do relacionamento com clientes
-- inativos, mas é interna — ela NÃO vende. A conta dela "tem que ser limitada
-- apenas para selecionar o cliente e encaminhar para aquele representante:
-- marcar local, observações sobre o cliente, entre outras coisas".
--
-- O papel só abre: ler clientes (qualquer carteira) e criar/acompanhar
-- tarefas de visita. Pedidos, catálogo, faturamento e cadastros ficam fora —
-- as rotas da API negam por papel, e o app nem mostra os menus.
--
-- O CHECK de role nasceu na 001 com três papéis e foi recriado na 014
-- ('store') e na 030 ('financeiro'); recria de novo, no mesmo padrão.
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
  CHECK (role IN ('admin', 'manager', 'rep', 'store', 'financeiro', 'relacionamento'));

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_users_role';
