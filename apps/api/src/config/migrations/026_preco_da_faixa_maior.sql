-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 026 — O preço da faixa maior (EG / XG / 48-54)
-- Executar no Supabase SQL Editor. Idempotente.
--
-- A tabela oficial da fábrica sempre teve DOIS preços por referência:
--
--     0706  Pijama De Manga Feminino   P AO GG        R$ 41,90
--     0706  Pijama De Manga Feminino   48-50-52-54    R$ 52,90
--
-- O sistema só guardava o primeiro. Resultado: 213 variantes EG, 32 de grade
-- plus (48/50/52/54) e 2 XG estavam sendo vendidas pelo preço do tamanho normal
-- — de R$ 2 a R$ 10 a menos por peça, em 138 das 193 referências ativas.
--
-- O preço maior nunca foi carregado porque não havia onde: `product_prices` tem
-- uma linha por (produto × tabela). Esta migração acrescenta a segunda faixa NA
-- MESMA LINHA, em vez de criar uma segunda linha por variante.
--
-- Por que na mesma linha, já que existe `product_prices.variant_id`?
--
--   1. Segurança. `catalog.service.ts` e `orders.service.ts` leem os preços com
--      `.select('product_id, price')`, sem olhar variant_id, e montam um Map por
--      product_id. Uma segunda LINHA por produto faria esse Map ficar com a que
--      chegasse por último — preço sorteado entre normal e maior, no catálogo e
--      no pedido. Uma segunda COLUNA não tem como colidir.
--   2. Fidelidade. A fábrica precifica por FAIXA, não por tamanho: as quatro
--      peças plus têm um preço só para 48, 50, 52 e 54. Quatro linhas idênticas
--      seriam quatro chances de divergirem.
--
-- `variant_id` continua existindo e continua NULL. O dia em que a fábrica
-- precificar tamanho a tamanho, é por lá que isso entra.
--
-- Quais tamanhos são "faixa maior" está em packages/shared/src/pricing/
-- faixaDeTamanho.ts — a MESMA regra que a API e o app usam.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE product_prices
  ADD COLUMN IF NOT EXISTS price_larger NUMERIC(10, 2);

COMMENT ON COLUMN product_prices.price_larger IS
  'Preço da faixa maior (EG/XG/48-54) da tabela oficial. NULL = referência de preço único, como os infantis e juvenis.';

-- Preço negativo não existe; zero seria "de graça", que também não. Sem isto, um
-- erro de carga viraria pedido faturado a menos, e ninguém repara em silêncio.
ALTER TABLE product_prices
  DROP CONSTRAINT IF EXISTS product_prices_price_larger_positivo;

ALTER TABLE product_prices
  ADD CONSTRAINT product_prices_price_larger_positivo
  CHECK (price_larger IS NULL OR price_larger > 0);

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Quantas referências ficaram com as duas faixas, por tabela:
--
-- SELECT pt.name AS tabela,
--        COUNT(*)                                        AS refs,
--        COUNT(pp.price_larger)                          AS com_faixa_maior,
--        COUNT(*) - COUNT(pp.price_larger)               AS preco_unico
--   FROM product_prices pp
--   JOIN price_tables pt ON pt.id = pp.price_table_id
--  GROUP BY pt.name
--  ORDER BY pt.name;
--
-- Esperado depois da carga: 193 refs por tabela, 138 com faixa maior.
