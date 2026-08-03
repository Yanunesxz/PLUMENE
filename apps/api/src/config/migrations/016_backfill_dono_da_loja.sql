-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 016 — Adota as lojas que nasceram sem dono
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- CONTEXTO: a 014 (acesso da loja) rodou dias antes da 015 (users.rep_id). Toda
-- conta de loja criada nessa janela ficou sem apontar para o representante que
-- a convidou — a coluna não existia e o código não tinha o que gravar.
--
-- POR QUE IMPORTA: sem dono, o token da loja sai sem `rep_id`. O pedido dela
-- nasce com `orders.rep_id` apontando para o PRÓPRIO usuário da loja, então não
-- entra na lista de representante nenhum: a compra fica invisível. O catálogo
-- também perde a queda para a tabela de preço do representante.
--
-- O dono está no convite que criou a conta. É de lá que ele volta.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A. Quem está órfão (rode antes, para ver o tamanho do estrago) ──────────
-- SELECT u.id, u.name, u.email, u.customer_id, u.rep_id
--   FROM users u
--  WHERE u.role = 'store' AND u.rep_id IS NULL;

-- ─── B. Adoção ───────────────────────────────────────────────────────────────
-- Só toca em quem está sem dono: rodar de novo não altera nada.
UPDATE users u
   SET rep_id = i.rep_id
  FROM store_invites i
 WHERE u.role = 'store'
   AND u.rep_id IS NULL
   AND i.customer_id = u.customer_id;

-- ─── C. Pedidos que foram parar no lugar errado ──────────────────────────────
-- Pedido de loja cujo `rep_id` aponta para um usuário que é loja (e não para um
-- representante) foi criado com o token sem dono. Devolve ao dono da loja.
UPDATE orders o
   SET rep_id = loja.rep_id
  FROM users loja
 WHERE o.rep_id = loja.id
   AND loja.role = 'store'
   AND loja.rep_id IS NOT NULL;

-- ─── D. Conferência ──────────────────────────────────────────────────────────
-- Os dois devem responder 0.
-- SELECT COUNT(*) AS lojas_sem_dono   FROM users  WHERE role = 'store' AND rep_id IS NULL;
-- SELECT COUNT(*) AS pedidos_perdidos FROM orders o
--   JOIN users u ON u.id = o.rep_id WHERE u.role = 'store';
