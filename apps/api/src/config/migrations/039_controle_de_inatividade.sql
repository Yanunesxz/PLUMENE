-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 039 — Controle de inatividade por cores
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (31/08/2026): o cliente tem cor pela última compra —
-- verde (ativo, até 90 dias), amarelo (atenção, 90–180), vermelho
-- (desativado, 180+). Quando está VERMELHO, o representante tem que
-- registrar um MOTIVO para o cliente estar desativado e uma OBSERVAÇÃO
-- "com as palavras dele". A Bruna (papel relacionamento, migração 038)
-- também preenche — ela liga para os inativos e apura o que houve.
--
-- A régua de dias já vive no código (90/180, migração 036 traz a data);
-- aqui entram só os campos que a régua não sabe: o PORQUÊ.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS inactivity_reason TEXT,
  ADD COLUMN IF NOT EXISTS inactivity_note TEXT,
  ADD COLUMN IF NOT EXISTS inactivity_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inactivity_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.inactivity_reason IS
  'Motivo de o cliente estar desativado (vermelho, 180+ dias sem comprar). Preenchido pelo rep ou pelo relacionamento.';
COMMENT ON COLUMN customers.inactivity_note IS
  'Observação com as palavras de quem apurou — contexto para a próxima visita.';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT name, inactivity_reason, inactivity_note, inactivity_updated_at
--   FROM customers WHERE inactivity_reason IS NOT NULL LIMIT 10;
