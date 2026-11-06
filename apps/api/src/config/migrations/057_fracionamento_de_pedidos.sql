-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 057 — FRACIONAMENTO de pedidos (um pedido, várias entregas)
-- Executar no Supabase SQL Editor, nos DOIS bancos (CS e PLUMENE). Idempotente
-- e aditiva: nenhuma coluna existente muda de nome, de tipo ou de valor, e
-- nenhuma linha é gravada ou apagada.
--
-- Pedido do Yan (05/11/2026), com o exemplo do pedido #57 da S H J Moda Íntima:
-- no app era um pedido só (R$ 21.227,70) e no Control saiu em três — PL02727,
-- PL02728 e PL02729 —, cada um com a sua data de saída e a sua nota. "Quando
-- ele for clicado em fracionado vai ser quando ele vai ter 3 datas de envios."
--
-- Fracionar DIVIDE o pedido em entregas, e cada entrega é um PEDIDO próprio:
-- número do app próprio (a sequência de sempre), número do Control próprio,
-- status e faturamento próprios. O que liga as entregas é o grupo — o id do
-- pedido que foi fracionado, que continua existindo como a entrega 1. Preço,
-- tabela, desconto, condição e cliente não mudam; as peças só mudam de pedido.
--
-- Quem fraciona e até quando é a regra de mexer no pedido (podeMexerNoPedido,
-- no shared): o representante enquanto o pedido está com ele; o escritório até
-- lançar no Control; faturado, ninguém.
--
-- A API sobe ANTES deste SQL: sem as colunas ninguém é fracionado (a leitura
-- usa `*`) e "Fracionar em entregas" responde 503 MIGRACAO_PENDENTE sem gravar
-- nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A. As entregas no pedido ────────────────────────────────────────────────
--
--   split_group_id  o grupo: o id do pedido que foi fracionado. Sem FK de
--                   propósito — excluir a entrega 1 não pode desfazer o
--                   vínculo das outras. NULL = pedido não fracionado
--   split_index     a posição da entrega no grupo (1 = o pedido de origem)
--   split_count     em quantas entregas o pedido foi fracionado
--   ship_date       a data de envio da entrega
--   split_at        quando foi fracionado
--   split_by        quem fracionou. SET NULL se o login sumir

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS split_group_id UUID,
  ADD COLUMN IF NOT EXISTS split_index SMALLINT,
  ADD COLUMN IF NOT EXISTS split_count SMALLINT,
  ADD COLUMN IF NOT EXISTS ship_date DATE,
  ADD COLUMN IF NOT EXISTS split_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS split_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- As três colunas do grupo andam juntas, e a posição cabe na contagem. Pedido
-- nenhum tem valor nelas antes deste SQL, então a trava nasce válida.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_fracionamento;
ALTER TABLE orders ADD CONSTRAINT chk_orders_fracionamento
  CHECK (
    (split_group_id IS NULL AND split_index IS NULL AND split_count IS NULL)
    OR (split_group_id IS NOT NULL
        AND split_count BETWEEN 2 AND 12
        AND split_index BETWEEN 1 AND split_count)
  );

-- As entregas de um grupo, para os botões "ir para a entrega 2".
CREATE INDEX IF NOT EXISTS idx_orders_fracionados
  ON orders (company_id, split_group_id) WHERE split_group_id IS NOT NULL;

-- Uma entrega por posição: dois toques em "Fracionar" ao mesmo tempo não
-- criam duas "entrega 2" — o segundo esbarra aqui (23505) e nada dobra.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_entrega_unica
  ON orders (split_group_id, split_index) WHERE split_group_id IS NOT NULL;

COMMENT ON COLUMN orders.split_group_id IS
  'Pedido fracionado em entregas (migração 057): o id do pedido que foi fracionado, igual em todas as entregas do grupo. Sem FK de propósito. NULL = não fracionado.';
COMMENT ON COLUMN orders.split_index IS
  'A posição desta entrega no grupo (1 = o pedido de origem). NULL = não fracionado.';
COMMENT ON COLUMN orders.split_count IS
  'Em quantas entregas o pedido foi fracionado, na hora do clique. Uma entrega excluída depois não muda este número.';
COMMENT ON COLUMN orders.ship_date IS
  'A data de envio desta entrega (migração 057). Só em pedido fracionado; muda pela tela enquanto o pedido ainda pode ser alterado.';
COMMENT ON COLUMN orders.split_at IS
  'Quando o pedido foi fracionado.';
COMMENT ON COLUMN orders.split_by IS
  'Quem fracionou o pedido. O nome se resolve na leitura (GET /orders/:id).';

-- Recarrega o cache do Supabase. Sem isto as colunas podem existir no banco e
-- continuar invisíveis para a API (erro PGRST204), e fracionar segue
-- respondendo "precisa da migração 057" com ela já rodada.
NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Pela API (GET de verdade, nunca HEAD): node _tools/conferir-057.mjs
-- (sem argumento mede os DOIS bancos).
--
-- No SQL Editor:
--   SELECT order_number, split_index, split_count, ship_date, status, total
--     FROM orders WHERE split_group_id IS NOT NULL
--    ORDER BY split_at DESC, split_index LIMIT 30;
--
--   SELECT count(*) FROM pg_indexes
--    WHERE indexname IN ('idx_orders_fracionados', 'idx_orders_entrega_unica');
--   (deve dar 2)
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'chk_orders_fracionamento';
