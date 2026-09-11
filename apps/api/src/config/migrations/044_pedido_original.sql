-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 044 — A cópia do pedido ORIGINAL
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (11/09/2026): "Hoje o pedido original vem montado mas depois
-- que a gente fatura pode tirar algumas peças que não temos e o pedido vem com
-- menos. Precisamos deixar uma cópia do pedido original e como que o pedido
-- foi faturado".
--
-- O pedido do app é UM só: quando o financeiro tira a peça que faltou no
-- estoque, o que o representante montou desaparece — e ninguém mais consegue
-- responder "mas eu tinha pedido 12 peças dessa referência". Esta tabela é a
-- fotografia tirada UM INSTANTE ANTES do primeiro corte.
--
-- O "como foi faturado" continua sendo o próprio pedido (com invoiced_total,
-- da 027): depois do carimbo ele não muda mais. O que faltava era o antes.
--
-- Uma linha por pedido, e só a primeira vale: a segunda tentativa de gravar é
-- ignorada pela chave primária. Fotografia tirada duas vezes já não é original.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_originals (
  order_id     UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- O total e a contagem de peças na hora da foto: o resumo da tela não
  -- precisa abrir o JSON para dizer quanto o pedido encolheu.
  total        NUMERIC(12,2),
  pecas        INTEGER NOT NULL DEFAULT 0,
  -- O pedido inteiro como estava: cabeçalho + itens já com referência e
  -- tamanho, para a tela não depender de produto que pode ser renomeado.
  snapshot     JSONB NOT NULL,
  -- Por que a foto foi tirada: 'edicao' (alguém trocou as peças) ou
  -- 'faturamento' (o carimbo veio sem ninguém ter mexido).
  motivo       TEXT,
  guardado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  guardado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_originals_company ON order_originals(company_id);

COMMENT ON TABLE order_originals IS
  'O pedido como o representante fechou, antes do primeiro corte de peça. Migração 044.';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT o.order_number, oo.pecas AS pecas_originais, oo.total AS total_original,
--        o.total AS total_hoje, o.invoiced_total
--   FROM order_originals oo JOIN orders o ON o.id = oo.order_id
--  ORDER BY oo.guardado_em DESC LIMIT 20;
