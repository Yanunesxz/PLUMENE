-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 015 — Triagem do representante e dono do login da loja
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- Duas coisas que faltavam para o acesso da loja (014) funcionar de verdade:
--
--  • TRIAGEM — pedido que a loja ou a vitrine monta não vai mais direto para a
--    fila do gerente. Ele para primeiro no REPRESENTANTE, que decide se aquilo
--    vira pedido de fábrica. Status novo: 'pending_rep'.
--
--  • DONO DO LOGIN — o usuário 'store' não tinha como apontar para o
--    representante que o convidou. Sem isso o token da loja sai sem dono, o
--    catálogo não acha tabela de preço e o pedido não sabe para quem ir.
--
-- Rodar esta migração é o que liga a triagem: enquanto ela não roda, a API
-- detecta a ausência e o pedido da loja segue caindo direto em
-- 'pending_approval' (comportamento da 014), sem quebrar nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A. orders.status aceita 'pending_rep' ───────────────────────────────────
-- O CHECK nasceu inline na 001 (nome gerado pelo Postgres). Acha pelo conteúdo
-- em vez de chutar o nome, que muda entre bancos criados em épocas diferentes.
DO $$
DECLARE nome TEXT;
BEGIN
  SELECT c.conname INTO nome
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'orders' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%pending_approval%';
  IF nome IS NOT NULL THEN
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', nome);
  END IF;
END $$;

ALTER TABLE orders ADD CONSTRAINT chk_orders_status
  CHECK (status IN (
    'draft',
    'pending_rep',        -- na mesa do representante (loja/vitrine)
    'pending_approval',   -- na mesa do gerente
    'approved',
    'rejected',
    'sent_erp',
    'error_erp'
  ));

COMMENT ON COLUMN orders.status IS
  'draft → pending_rep (loja/vitrine) → pending_approval → approved → sent_erp. '
  'O representante só passa de pending_rep; o gerente só passa de pending_approval.';

-- A fila da triagem é lida a cada abertura da área do representante.
CREATE INDEX IF NOT EXISTS idx_orders_triagem
  ON orders(company_id, rep_id, status)
  WHERE status = 'pending_rep';

-- ─── B. users.rep_id — o representante dono do login da loja ─────────────────
-- Quem convidou a loja é quem recebe o pedido dela e quem responde por ela.
-- Fica gravado no usuário para o login não precisar redescobrir a carteira a
-- cada token (a carteira do ERP casa por código, não por id — resolver isso no
-- login custaria duas consultas por autenticação).
ALTER TABLE users ADD COLUMN IF NOT EXISTS rep_id UUID
  REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN users.rep_id IS
  'Loja: representante que convidou e que recebe os pedidos dela. NULL nos demais papéis.';

CREATE INDEX IF NOT EXISTS idx_users_rep ON users(rep_id) WHERE rep_id IS NOT NULL;

-- ─── C. Conferência ──────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_orders_status';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'rep_id';
-- SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY 2 DESC;
