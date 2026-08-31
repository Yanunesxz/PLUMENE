-- ============================================================================
-- 035 — Link temporário atrelado a um cliente
--
-- Regra do Yan (31/08/2026): "mesmo se for temporário tem que ter algum
-- cliente atrelado" — como a conta de loja. O link da vitrine passa a nascer
-- amarrado a um cliente da carteira: o pedido que sai dele já entra no
-- cadastro certo, com a tabela de preço do cliente, sem "visitante avulso".
--
-- A coluna é NULLABLE de propósito: links antigos (criados antes da regra)
-- continuam funcionando como visitante até expirarem sozinhos.
--
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ============================================================================

ALTER TABLE showcase_links
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN showcase_links.customer_id IS
  'O cliente dono do link. Pedido que nasce dele entra amarrado a este cadastro.';

-- Conferência:
-- SELECT COUNT(*) FROM showcase_links WHERE customer_id IS NOT NULL;  -- 0 logo após rodar
