-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 047 — Cliente VAREJO (fora da cobrança de contato)
-- Executar no Supabase SQL Editor (CS e PLUMENE). Idempotente.
--
-- Pedido do Yan (15/09/2026): "um botão para marcar apenas nas vendedoras
-- internas para elas informarem que o cliente é cliente varejo e não ficar
-- cobrando elas para entrar em contato novamente".
--
-- A venda interna (Simone, Nicoli — users.venda_interna, migração 031) atende
-- quem compra uma vez no balcão. Esse cliente nunca vai "voltar a comprar", e
-- a régua da carteira (036/043) o pintava de amarelo e vermelho, o alerta
-- avisava que ele ia esfriar e a Bruna ligava. A marca tira o cliente da régua
-- inteira. Quem marca e desmarca é SÓ a venda interna — a rota confere.
--
-- CONTROLE INTERNO (Yan, 15/09/2026: "não manda nem pega do sistema do
-- Fábio"): nenhuma ponte com o ERP lê estas colunas, e as cargas de cliente
-- (partner.sync.service, erp-sync) gravam só colunas nomeadas — então a
-- sincronização nunca apaga a marca. Não inclua `varejo` nessas cargas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS varejo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS varejo_marcado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS varejo_marcado_em TIMESTAMPTZ;

COMMENT ON COLUMN customers.varejo IS
  'Cliente de varejo marcado pela venda interna: fica fora da régua da carteira (sem atenção/esfriado, sem alerta de contato).';
COMMENT ON COLUMN customers.varejo_marcado_por IS
  'Quem marcou ou desmarcou por último — sempre uma vendedora interna.';

-- Sem isto o PostgREST continua sem enxergar as colunas novas até recarregar o
-- cache sozinho, e a API responde "precisa da migração 047" com ela já rodada.
NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT name, varejo, varejo_marcado_em FROM customers WHERE varejo LIMIT 20;
