-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE)
--
-- Duas migrações num arquivo só. Cole TUDO de uma vez e aperte Run.
-- É idempotente: rodar duas vezes não faz mal nenhum.
--
--   046 → o botão "Atualizar no ERP" (a Larissa confirma que atualizou o Control)
--   047 → o botão "Cliente varejo" (a Simone e a Nicoli marcam o cliente de balcão)
--
-- JÁ APLICADO NOS DOIS BANCOS (15/09/2026). Medido às 09:5x de 15/09 com
-- `node _tools/conferir-046-047.mjs` (GET de verdade, nas duas raízes): 046 e
-- 047 visíveis na Corpo Sensual e na PLUMENE. Não precisa colar de novo — se
-- colar, não faz mal (é idempotente). Fica aqui como registro do que rodou.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 046 — "Atualizar no ERP": o que o Control conhece de cada pedido
-- Executar no Supabase SQL Editor. Idempotente.
--
-- Pedido do Yan (11/09/2026): "depois que o pedido for enviado pelas vendedoras
-- internas e elas alterarem ele, temos que ter um botão depois que editou as
-- peças como 'atualizar no ERP', porque se ela mudar por lá tem que mudar no
-- ERP principal também".
--
-- O buraco: a venda interna (Simone, Nicoli) pode mexer nas peças do PRÓPRIO
-- pedido até o carimbo de faturado — inclusive DEPOIS de a Larissa lançar no
-- Control (regra da 031). Quando ela mexe, o Control fica com a versão velha e
-- ninguém na fábrica fica sabendo: a nota sai pelo pedido errado.
--
-- Esta tabela é a fotografia do que o Control CONHECE. Ela é tirada quando o
-- pedido é lançado e tirada de novo quando alguém confirma que atualizou lá.
-- "Está desatualizado" NÃO é uma coluna: é a comparação entre as peças de hoje
-- e esta foto. Coluna booleana desencontra do fato; comparação, não.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_erp_sync (
  order_id       UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- O número do Control no momento da foto, para a tela dizer qual pedido de lá.
  erp_order_id   TEXT,
  total          NUMERIC(12,2),
  pecas          INTEGER NOT NULL DEFAULT 0,
  -- O pedido como o Control o conhece: itens já com referência e tamanho.
  snapshot       JSONB NOT NULL,
  -- Quando o Control passou a conhecer ESTA versão (lançamento ou confirmação).
  confirmado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Quem pediu a atualização depois de editar, e quando. Limpo a cada foto nova.
  pedido_em      TIMESTAMPTZ,
  pedido_por     UUID REFERENCES users(id) ON DELETE SET NULL,
  -- O recado de quem pediu ("tirei 6 peças da 0124, faltou no estoque").
  observacao     TEXT,
  -- A impressão do pedido (assinaturaDoPedido, em shared) no momento do aviso.
  -- É ela que diz, sem se confundir com carimbo ou correção de número, se a
  -- venda interna mudou o pedido DE NOVO depois de avisar.
  assinatura_pedida TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_erp_sync_company ON order_erp_sync(company_id);
-- A fila "precisa atualizar no Control": quem pediu e ainda não foi confirmado.
CREATE INDEX IF NOT EXISTS idx_order_erp_sync_pedido
  ON order_erp_sync(company_id, pedido_em) WHERE pedido_em IS NOT NULL;

-- Acrescentada em 15/09/2026, antes de a 046 ficar visível em qualquer banco.
-- Para quem já tinha criado a tabela sem ela: idempotente.
ALTER TABLE order_erp_sync ADD COLUMN IF NOT EXISTS assinatura_pedida TEXT;

COMMENT ON TABLE order_erp_sync IS
  'A fotografia do pedido como o Control o conhece. Migração 046. Divergência = comparar com os itens de hoje.';
COMMENT ON COLUMN order_erp_sync.confirmado_em IS
  'Quando o Control passou a conhecer esta versão: no lançamento, ou quando alguém confirmou que atualizou lá.';
COMMENT ON COLUMN order_erp_sync.pedido_em IS
  'Quando alguém apertou "Atualizar no ERP" depois de editar. NULL = nada pedido.';

-- Recarrega o cache do Supabase: sem isto a tabela pode existir no banco e
-- continuar invisível para o app (erro PGRST205).

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT o.order_number, s.erp_order_id, s.pecas AS pecas_no_control,
--        s.confirmado_em, s.pedido_em
--   FROM order_erp_sync s JOIN orders o ON o.id = s.order_id
--  ORDER BY s.pedido_em DESC NULLS LAST LIMIT 20;


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

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT name, varejo, varejo_marcado_em FROM customers WHERE varejo LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════
-- Recarrega o cache do Supabase. SEM ESTA LINHA as tabelas e colunas podem
-- existir no banco e continuar invisíveis para o app (foi o que deixou a 046
-- desligada entre 11/09 e 15/09/2026).
-- ═══════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
