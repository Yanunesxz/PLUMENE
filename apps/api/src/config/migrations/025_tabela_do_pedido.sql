-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 025 — A tabela de preço fica gravada no pedido
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Até aqui o pedido não guardava em que tabela foi precificado. Dava para
-- adivinhar pelo cadastro do cliente, mas era só isso: adivinhação. Se a tabela
-- do cliente mudasse depois, o pedido antigo passava a "pertencer" a uma tabela
-- que não é a dele, e o preço gravado nos itens não batia com nada.
--
-- Isso apareceu de verdade na exportação para o Control, que escolhe o modelo de
-- planilha pela tabela: ela tinha de deduzir do cliente e cair para a do
-- representante quando o cliente não tem uma — o que acontece em 536 dos 1.000
-- clientes.
--
-- Agora o representante com duas ou mais tabelas escolhe qual usar em CADA
-- pedido, e é essa escolha que fica registrada aqui.
--
-- Fica NULL nos pedidos antigos, de propósito: ninguém sabe de verdade qual foi,
-- e escrever um palpite seria pior do que admitir que não se sabe. Quem lê trata
-- NULL como "deduza do cliente", que é o comportamento de hoje.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS price_table_id UUID REFERENCES price_tables(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.price_table_id IS
  'Tabela que precificou ESTE pedido. NULL em pedido anterior à migração 025 — nesse caso, deduza pelo cadastro do cliente.';

-- A consulta quente é "pedidos desta tabela", sempre dentro da empresa.
CREATE INDEX IF NOT EXISTS idx_orders_price_table
  ON orders(company_id, price_table_id)
  WHERE price_table_id IS NOT NULL;

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT o.order_number, pt.name AS tabela, o.total
--   FROM orders o
--   LEFT JOIN price_tables pt ON pt.id = o.price_table_id
--  ORDER BY o.created_at DESC
--  LIMIT 20;
