-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 024 — Comissão sai do sistema
-- Executar no Supabase SQL Editor. Idempotente.
--
-- ⚠️ DESTRUTIVA E IRREVERSÍVEL. `users.commission_rate` guarda o percentual de
-- cada representante, e o DROP apaga esses números para sempre. Não há como
-- recuperar sem backup do banco. O Yan pediu a remoção total em 10/08/2026,
-- ciente disso.
--
-- Antes de rodar, se quiser guardar o que existe hoje:
--
--   SELECT name, email, commission_rate
--     FROM users
--    WHERE role = 'rep'
--    ORDER BY name;
--
-- A tecla `ver_comissoes` também some. Ela vive dentro do array
-- `users.permissions` (migração 022), então não é uma coluna: é um valor a ser
-- retirado de cada linha que o tenha. Um gerente que só tinha essa tecla fica
-- com um array vazio, que é o correto — ele não ganha nem perde nada além.
--
-- O que NÃO sai, de propósito: `orders.invoiced` e `orders.invoiced_at`. Eram a
-- base do cálculo da comissão, mas valem sozinhos — é como o gerente marca que
-- o pedido virou nota. E `rep_bonus_tiers` (meta e bônus) fica inteira: bônus é
-- valor fixo por meta batida, não percentual sobre faturamento.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users DROP COLUMN IF EXISTS commission_rate;

UPDATE users
   SET permissions = array_remove(permissions, 'ver_comissoes')
 WHERE permissions IS NOT NULL
   AND 'ver_comissoes' = ANY (permissions);

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- As duas consultas têm de voltar vazias.
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'users' AND column_name = 'commission_rate';
--
-- SELECT email, permissions FROM users
--  WHERE permissions IS NOT NULL AND 'ver_comissoes' = ANY (permissions);
