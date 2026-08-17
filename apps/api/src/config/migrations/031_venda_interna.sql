-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 031 — Representante de VENDA INTERNA
-- Executar no Supabase SQL Editor. Idempotente.
--
-- "Como se fosse representante mesmo" (Yan, 14/08/2026) — mesma carteira,
-- mesmo catálogo, mesmas telas. A diferença é um interruptor: o pedido dele
-- NASCE APROVADO (venda de balcão não pede aprovação da fábrica) e ele mesmo
-- marca o faturado. Nenhum status novo: "Faturado" continua sendo o carimbo
-- `invoiced` em cima do `approved`, como em todo pedido.
--
-- É coluna, não papel: um papel novo atravessaria todos os guards e telas do
-- rep para no fim se comportar igual. O interruptor muda só os dois pontos que
-- realmente diferem (status inicial e quem fatura).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS venda_interna BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.venda_interna IS
  'Representante de venda interna: pedido nasce aprovado (sem fila da fábrica) e ele mesmo marca o faturado. Migração 031.';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Depois de rodar, marque a opção "Venda interna" no cadastro do representante
-- (tela Representantes). O login precisa SAIR E ENTRAR para o interruptor valer.
-- SELECT name, venda_interna FROM users WHERE role = 'rep' ORDER BY name;
