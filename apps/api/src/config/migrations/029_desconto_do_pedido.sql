-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 029 — Desconto do pedido, dado pelo representante
-- Executar no Supabase SQL Editor. Idempotente.
--
-- O representante fecha negócio na frente do lojista e às vezes precisa dar um
-- percentual no pedido inteiro para a venda sair. Até aqui não havia onde
-- registrar isso: ou ele vendia pelo preço de tabela, ou combinava por fora e o
-- sistema nunca ficava sabendo.
--
-- O percentual fica no PEDIDO, e o `unit_price` de cada item continua sendo o
-- preço de tabela. Isso não é detalhe de implementação: é o que o formulário do
-- Control espera.
--
-- O rodapé do formulário oficial tem o campo pronto:
--
--     AA45 "Valor Parcial"   AB45 =SUM(AB13:AB44)
--     AA46 "DESC  %"         AB46  (vazia — é aqui que o percentual entra)
--     AA47                   AB47 =AB45*AB46
--     AA48 "TOTAL"           AB48 =AB45-AB47
--
-- Ou seja, a fábrica quer o desconto declarado à parte, com a coluna UNIT
-- mostrando o preço de tabela. Diluir o desconto no preço unitário esconderia
-- dele que houve desconto e ainda faria a planilha divergir da tabela oficial.
--
-- `orders.total` já guarda o valor COM o desconto aplicado — é o que o lojista
-- deve, e o que conta como venda enquanto a nota não sai.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.discount_percent IS
  'Percentual de desconto no pedido inteiro, dado pelo representante. Já está aplicado em orders.total; os unit_price dos itens seguem sendo o preço de tabela (é assim que o formulário do Control espera, campo DESC % em AB46).';

-- Desconto negativo seria acréscimo disfarçado; acima de 100 seria a fábrica
-- pagando para vender. O limite comercial (quanto o representante PODE dar) é
-- outra conversa e mora na aplicação — aqui fica só o que é impossível.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_discount_percent_valido;

ALTER TABLE orders
  ADD CONSTRAINT orders_discount_percent_valido
  CHECK (discount_percent >= 0 AND discount_percent <= 100);

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Pedidos que saíram com desconto:
--
-- SELECT o.order_number, u.name AS representante,
--        o.discount_percent AS pct, o.total, o.status
--   FROM orders o
--   LEFT JOIN users u ON u.id = o.rep_id
--  WHERE o.discount_percent > 0
--  ORDER BY o.created_at DESC;
