-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 020 — A segunda bolinha da cor
-- Executar no Supabase SQL Editor. Idempotente.
--
-- No catálogo impresso uma opção de cor quase nunca é uma bolinha só: são duas,
-- sobrepostas — a da blusa e a da calça (ou o liso e a estampa). Guardar só uma
-- perdia informação de verdade: no 0760 as opções 01 e 04 têm a MESMA bolinha
-- da frente (rosa) e só se distinguem pela de trás (turquesa x azul).
--
-- `hex` continua sendo a bolinha principal — a que dá nome à cor. `hex_par` é a
-- companheira, quando existe.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS hex_par TEXT;

-- Estampa (floral, listrado, xadrez): a bolinha não é uma cor chapada, e a
-- interface mostra isso em vez de fingir que é.
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS estampa BOOLEAN NOT NULL DEFAULT false;
