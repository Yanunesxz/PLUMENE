-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 032 — Desconto em REAIS, além do percentual
-- Executar no Supabase SQL Editor. Idempotente.
--
-- O representante nem sempre negocia em porcentagem: "tiro R$ 8,90" ou "deixo
-- em R$ 97,90 de desconto" é como a conversa acontece na frente do lojista.
--
-- O desconto continua sendo UM número guardado — o percentual —, porque é isso
-- que o formulário do Control entende (AB46 é a TAXA, e AB47 = AB45*AB46).
-- Quem digita em reais tem o percentual calculado pelo servidor a partir da
-- soma dos itens. Duas colunas (uma em % e outra em R$) dariam duas verdades
-- para a mesma coisa, e a planilha teria de escolher uma.
--
-- O que muda aqui é só a PRECISÃO. Em NUMERIC(5,2) o percentual só guarda duas
-- casas, e R$ 8,90 sobre R$ 1.234,56 dá 0,720915…% — arredondado para 0,72%
-- viraria R$ 8,89. Um centavo de diferença do que foi combinado com o lojista,
-- em todo pedido com desconto em valor.
--
-- Com seis casas o erro some: o pior caso num pedido de R$ 100 mil fica abaixo
-- de um centavo, e `taxaXml` (modeloOficial.ts) já grava seis casas na planilha.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ALTER COLUMN discount_percent TYPE NUMERIC(9, 6);

COMMENT ON COLUMN orders.discount_percent IS
  'Percentual de desconto no pedido inteiro (6 casas). Quem digita em R$ tem o percentual derivado da soma dos itens pelo servidor. Já aplicado em orders.total; os unit_price seguem preço de tabela (campo DESC % em AB46 da planilha).';

-- O CHECK antigo continua valendo (0 a 100), mas recriamos para garantir que
-- sobreviveu à troca de tipo.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_discount_percent_valido;

ALTER TABLE orders
  ADD CONSTRAINT orders_discount_percent_valido
  CHECK (discount_percent >= 0 AND discount_percent <= 100);

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT order_number, discount_percent, total
--   FROM orders WHERE discount_percent > 0 ORDER BY updated_at DESC LIMIT 10;
