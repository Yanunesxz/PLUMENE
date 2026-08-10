-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 023 — A grade plus size das quatro referências que a têm
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- Quatro peças da malha PV são vendidas em DUAS grades. No catálogo impresso
-- elas vêm com o selo PLUS SIZE e as duas faixas escritas embaixo da foto:
--
--   0130 — PP ao GG  +  48 ao 54
--   0703 — P  ao GG  +  48 ao 54
--   0705 — P  ao GG  +  48 ao 54
--   0706 — P  ao GG  +  48 ao 54
--
-- Aqui só a grade de letras existe: o representante acha a referência, mas não
-- tem onde clicar o 48. Esta migração cria os quatro tamanhos que faltam.
--
-- O `sku` é comparado normalizado porque a mesma peça aparece na planilha da
-- fábrica em duas formas — "130" e "0130E" — e não dá para saber daqui qual
-- delas o catálogo importou. Tirar o "E" do fim e os zeros da frente faz as duas
-- caírem em "130", então a migração acerta o produto de qualquer jeito.
--
-- Estoque: cada tamanho plus nasce com o maior estoque entre os tamanhos que a
-- referência já tem. Enquanto o ERP não está plugado ninguém alimenta esse
-- número, e estoque 0 significa "esgotado" na tela — `in_stock: available > 0`
-- em catalog.service.ts, e o quadradinho do tamanho vem `disabled`. Ou seja: com
-- 0 a variante nasceria morta, visível e não clicável.
--
-- Preço: nada a fazer. `product_prices` é por produto, não por tamanho, e na
-- planilha oficial a linha plus repete a MESMA referência — o VLOOKUP devolve o
-- mesmo unitário para as duas grades.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO product_variants (
  product_id, company_id, erp_sku, size, stock_quantity, stock_committed, active
)
SELECT
  p.id,
  p.company_id,
  p.sku || '|' || t.size,
  t.size,
  COALESCE(atual.maior_estoque, 0),
  0,
  true
FROM products p
CROSS JOIN (VALUES ('48'), ('50'), ('52'), ('54')) AS t(size)
LEFT JOIN LATERAL (
  SELECT MAX(v.stock_quantity) AS maior_estoque
    FROM product_variants v
   WHERE v.product_id = p.id
) atual ON true
WHERE ltrim(regexp_replace(upper(btrim(p.sku)), 'E$', ''), '0') IN ('130', '703', '705', '706')
ON CONFLICT (company_id, erp_sku) DO NOTHING;

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Espera-se a grade de letras seguida de 48, 50, 52 e 54 em cada referência.
--
-- SELECT p.sku, v.size, v.stock_quantity
--   FROM product_variants v
--   JOIN products p ON p.id = v.product_id
--  WHERE ltrim(regexp_replace(upper(btrim(p.sku)), 'E$', ''), '0')
--        IN ('130', '703', '705', '706')
--  ORDER BY p.sku, v.size;
