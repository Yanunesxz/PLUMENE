-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 017 — Um pedido offline entra UMA vez
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- O pedido montado sem sinal recebe um `local_id` no aparelho e fica numa fila.
-- Ao reconectar, a fila é enviada e só é limpa quando a resposta chega.
--
-- O problema é o meio do caminho: se o servidor GRAVA e a resposta se perde
-- (sinal caindo, aba fechando, servidor reiniciando), o aparelho não sabe que
-- deu certo e reenvia. Sem trava, nasce um segundo pedido idêntico — que vira
-- segunda nota, segunda comissão e uma ligação da loja.
--
-- Dois envios simultâneos da mesma fila (sincronização automática ao reconectar
-- + toque no botão "Sincronizar") produzem o mesmo estrago sem rede nenhuma
-- falhar.
--
-- O índice é a última linha de defesa: a API já procura o `local_id` antes de
-- gravar, mas duas requisições ao mesmo tempo passam pelas duas checagens antes
-- de qualquer uma inserir. Só o banco resolve isso.
-- ─────────────────────────────────────────────────────────────────────────────

-- Parcial: pedido montado no app (sem `local_id`) não é afetado — vários NULL
-- não colidem entre si, mas um índice sem o WHERE seria carga inútil.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_local_id
  ON orders (company_id, local_id)
  WHERE local_id IS NOT NULL;

COMMENT ON COLUMN orders.local_id IS
  'Identificador gerado no aparelho para o pedido montado offline. Único por '
  'empresa: reenvio da fila encontra o pedido que já existe em vez de criar outro.';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Duplicados que já existam impedem a criação do índice. Para encontrá-los:
--
-- SELECT company_id, local_id, COUNT(*), array_agg(id) AS pedidos
--   FROM orders
--  WHERE local_id IS NOT NULL
--  GROUP BY company_id, local_id
-- HAVING COUNT(*) > 1;
--
-- Se aparecer alguma linha, são pedidos gravados em duplicidade antes desta
-- migração. Confira no app antes de apagar: pode haver faturamento em cima.
