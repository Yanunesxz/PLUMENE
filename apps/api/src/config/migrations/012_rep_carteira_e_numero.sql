-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 012 — Carteira do representante + número do pedido
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- Duas coisas que a auditoria de 2026-07-29 encontrou em PRODUÇÃO:
--
-- 1. A migração 009 (order_number) NUNCA foi aplicada — `orders.order_number`
--    não existe no banco. O código de parceiro já contorna isso checando a
--    coluna antes de usar. Aqui ela é criada de vez (bloco A).
--
-- 2. 1.352 dos 1.353 clientes estão com `rep_id` nulo, então o representante
--    logado enxergava UM cliente. Os clientes vindos do ERP trazem a carteira em
--    `customers.rep_erp_id` (1.130 preenchidos, 46 códigos distintos), mas não
--    havia onde guardar o código ERP do representante para casar as duas pontas.
--    O bloco B cria `users.erp_rep_id` e faz o vínculo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A. Número sequencial do pedido (substitui a 009, caso não tenha rodado) ──
CREATE SEQUENCE IF NOT EXISTS orders_number_seq START WITH 14534;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number INTEGER;

-- Numera os pedidos já existentes na ordem em que foram criados.
WITH ordenados AS (
  SELECT id, 14534 + (ROW_NUMBER() OVER (ORDER BY created_at) - 1) AS num
  FROM orders
  WHERE order_number IS NULL
)
UPDATE orders o
SET order_number = ordenados.num
FROM ordenados
WHERE o.id = ordenados.id;

ALTER TABLE orders ALTER COLUMN order_number SET DEFAULT nextval('orders_number_seq');

-- Aponta a sequência para depois do maior número já usado.
SELECT setval('orders_number_seq', GREATEST(14533, (SELECT COALESCE(MAX(order_number), 0) FROM orders)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);

-- ─── B. Código ERP do representante (liga o usuário do app à carteira) ───────
-- É o código que o ERP usa no cadastro do cliente (customers.rep_erp_id),
-- ex.: "00779". A API resolve a carteira por ele; `customers.rep_id` continua
-- valendo para cliente cadastrado dentro do app (que não existe no ERP).
ALTER TABLE users ADD COLUMN IF NOT EXISTS erp_rep_id TEXT;

COMMENT ON COLUMN users.erp_rep_id IS
  'Código do representante no ERP. Casa com customers.rep_erp_id para montar a carteira.';

-- Dois representantes não podem dividir o mesmo código na mesma empresa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_erp_rep
  ON users(company_id, erp_rep_id)
  WHERE erp_rep_id IS NOT NULL;

-- Busca da carteira: customers por (empresa, código do rep).
CREATE INDEX IF NOT EXISTS idx_customers_company_rep_erp
  ON customers(company_id, rep_erp_id)
  WHERE rep_erp_id IS NOT NULL;

-- Vínculo em massa: roda sozinho e casa cada cliente com o representante cujo
-- código ERP bate. Enquanto nenhum rep tiver `erp_rep_id` preenchido, não faz
-- nada (é esse o estado hoje) — e volta a valer sozinho toda vez que você rodar
-- de novo depois de cadastrar os códigos na tela de Representantes.
--
-- Não é obrigatório para a carteira funcionar: a API também resolve por
-- rep_erp_id em tempo de consulta. Isto só deixa o banco coerente.
UPDATE customers c
SET rep_id = u.id
FROM users u
WHERE u.company_id = c.company_id
  AND u.role = 'rep'
  AND u.erp_rep_id IS NOT NULL
  AND u.erp_rep_id = c.rep_erp_id
  AND c.rep_id IS NULL;

-- ─── C. Conferência ──────────────────────────────────────────────────────────
-- Depois de rodar, isto deve devolver 0 na primeira linha e a carteira por rep
-- na segunda:
--
--   SELECT COUNT(*) AS pedidos_sem_numero FROM orders WHERE order_number IS NULL;
--   SELECT u.name, u.erp_rep_id, COUNT(c.id) AS clientes
--   FROM users u LEFT JOIN customers c
--     ON c.company_id = u.company_id AND c.rep_erp_id = u.erp_rep_id
--   WHERE u.role = 'rep' GROUP BY u.name, u.erp_rep_id ORDER BY clientes DESC;
