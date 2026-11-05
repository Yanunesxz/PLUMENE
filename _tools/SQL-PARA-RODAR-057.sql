-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE).
--
-- Migração 057 — FRACIONAMENTO de pedidos: um pedido dividido em entregas,
-- cada uma com a sua data de envio. Cole TUDO de uma vez e aperte Run.
-- É idempotente (rodar duas vezes não faz mal) e só acrescenta: seis colunas
-- em orders, uma trava e dois índices parciais; nenhuma coluna que o CRM lê
-- muda, nenhuma linha é gravada ou apagada.
--
--   A → orders.split_group_id / split_index / split_count : a que grupo de
--       entregas o pedido pertence, a posição dele e em quantas foi fracionado
--       orders.ship_date : a data de envio da entrega
--       orders.split_at / split_by : quando e quem fracionou
--
-- Pedido do Yan (05/11/2026): o pedido que no Control sai em três, cada um
-- com a sua data de saída e a sua nota, é fracionado no app em três entregas —
-- cada entrega um pedido próprio, ligadas entre si.
--
-- Sem este SQL, "Fracionar em entregas" responde que falta a migração 057 e
-- não grava nada; a leitura segue normal (ninguém é fracionado).
--
-- Não depende de outra migração e não mexe no CHECK do rastro
-- (order_erp_events): pode rodar em qualquer ordem depois da 001.
--
-- DEPOIS DE RODAR, da pasta do app:
--   node _tools/conferir-057.mjs        (confere os DOIS bancos)
-- As conferências no SQL Editor estão no fim de
-- apps/api/src/config/migrations/057_fracionamento_de_pedidos.sql.
-- ═══════════════════════════════════════════════════════════════════════════

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
