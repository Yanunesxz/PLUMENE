-- ═══════════════════════════════════════════════════════════════════════════
-- RODAR NO SQL EDITOR DO SUPABASE — nos DOIS bancos (Corpo Sensual e PLUMENE),
-- DEPOIS da 048 (o bloco 0 para com mensagem clara se ela ainda não rodou).
--
-- Migração 049 — integração com o Control: as respostas. Cole TUDO de uma vez
-- e aperte Run. É idempotente (rodar duas vezes não faz mal) e só acrescenta:
-- nenhuma coluna que o CRM lê muda.
--
--   0 → trava: para antes de mudar qualquer coisa se a 048 não rodou
--   A → orders.erp_requested_at/by : "Lançar no ERP" com canal 'api' SOLICITA,
--       e o número chega pela confirmação do Control
--   B → users.erp_email : o e-mail do representante no Control (o login não muda)
--   C → order_invoices.substituida_por/em : nota nova por cima da anterior
--   D → companies.sync_solicitado_em/por : o botão "Sincronizar agora"
--   E → customers : carimbo do Control, referência do retrato, pendência financeira
--   F → price_tables / payment_conditions : descrição do Control em coluna
--       própria (name e description continuam sendo do app), carimbo, ativo,
--       valor mínimo
--   G → products / product_variants / product_prices : carimbo do Control,
--       data do estoque, preço original e desconto
--   H → order_erp_events : três acontecimentos novos no CHECK de tipo
--
-- DEPOIS DE RODAR, da pasta do app:
--   node _tools/conferir-049.mjs                      (banco da Corpo Sensual)
--   node _tools/conferir-049.mjs <raiz da PLUMENE>    (banco da PLUMENE)
-- As conferências no SQL Editor estão no fim de
-- apps/api/src/config/migrations/049_integracao_control_respostas.sql.
--
-- A 049 NÃO muda o canal de nenhuma empresa. Depois dela, NÃO rerode a 048: o
-- bloco D dela recolocaria a lista antiga no CHECK de order_erp_events.tipo.
--
-- DEPOIS DA 050, NÃO RERODAR ESTE ARQUIVO: o bloco H recoloca a lista antiga do
-- CHECK de order_erp_events.tipo (sem 'solicitacao_cancelada'), e o evento do
-- cancelamento da solicitação passa a ser recusado (fica só no console). Se
-- precisar rerodar, rode a 050 em seguida.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. A 048 precisa estar aplicada ─────────────────────────────────────────
-- C e H mexem em tabelas que a 048 cria. Sem ela o Postgres pararia no meio com
-- "relation does not exist"; aqui ele para ANTES de mudar qualquer coisa e diz
-- o que falta.

DO $$
BEGIN
  IF to_regclass('public.order_invoices') IS NULL
     OR to_regclass('public.order_erp_events') IS NULL THEN
    RAISE EXCEPTION 'A 048 ainda nao rodou neste banco (falta order_invoices ou order_erp_events). Cole _tools/SQL-PARA-RODAR-048.sql antes da 049.';
  END IF;
END $$;


-- ─── A. Pedido SOLICITADO ao Control ─────────────────────────────────────────
-- Com companies.canal_pedido_erp = 'api', "Lançar no ERP" deixa de pedir o
-- número: o financeiro clica, o pedido fica SOLICITADO (erp_requested_at, por
-- quem), a fila do parceiro (GET /partner/v1/pedidos) passa a entregar só o que
-- foi solicitado, e o número chega pela confirmação do Control (erp_order_id +
-- erp_order_source = 'api', da 048). A tela fica consultando o pedido até o
-- número aparecer. Sem estas colunas, a fila é a de hoje (todo aprovado sem
-- número). Com canal manual nada muda: o financeiro continua digitando.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS erp_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erp_requested_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- A fila do parceiro: solicitado e ainda sem número. Parcial: são poucas linhas
-- por vez, e o índice não cresce com o histórico.
CREATE INDEX IF NOT EXISTS idx_orders_solicitados_ao_erp
  ON orders (company_id)
  WHERE erp_requested_at IS NOT NULL AND erp_order_id IS NULL;

COMMENT ON COLUMN orders.erp_requested_at IS
  'Quando o financeiro pediu o lançamento ao Control (canal api). NULL = não solicitado, ou lançado à mão. Migração 049.';


-- ─── B. E-mail do representante no Control ───────────────────────────────────
-- O Control tem o próprio e-mail do representante e o manda junto com o
-- cadastro. Fica em coluna própria: users.email é o LOGIN do app e não muda por
-- causa do ERP.

ALTER TABLE users ADD COLUMN IF NOT EXISTS erp_email TEXT;


-- ─── C. Nota substituída ─────────────────────────────────────────────────────
-- Um pedido tem UMA nota. Nota cancelada ou devolvida no Control não chega como
-- aviso: o Control simplesmente sobe OUTRA nota (número diferente) para o mesmo
-- pedido. Regra: a nota nova substitui a anterior — a antiga recebe
-- cancelada_em = now() (a tela já deixa de somar os itens dela, desde a 048) e
-- substituida_por = a nova, para o rastro dizer qual nota tomou o lugar de qual.
-- Reenviar a MESMA nota (mesmo número e série) continua não duplicando.

ALTER TABLE order_invoices
  ADD COLUMN IF NOT EXISTS substituida_por UUID REFERENCES order_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS substituida_em  TIMESTAMPTZ;

COMMENT ON COLUMN order_invoices.substituida_por IS
  'A nota nova que tomou o lugar desta (mesmo pedido, número diferente). Preenchida junto com cancelada_em. Migração 049.';


-- ─── D. Sincronização pedida à mão ───────────────────────────────────────────
-- O Control PUXA as mudanças do app (GET ?desde=) a cada ~5 min. O botão
-- "Sincronizar agora" grava aqui quem pediu e quando; GET /partner/v1/status
-- devolve sincronizar_agora = true enquanto este pedido for mais novo que a
-- última passada do Control, e o Control roda tudo já.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sync_solicitado_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_solicitado_por UUID REFERENCES users(id) ON DELETE SET NULL;


-- ─── E. Cliente: carimbo do Control, retrato e pendência financeira ──────────
--   erp_updated_at          quando o Control mandou este cadastro pela última
--                           vez (o GET ?desde= devolve o que o APP mudou depois)
--   retrato_referencia_em   de quando é o retrato (última compra, total
--                           comprado, vencido) que o Control mandou — a tela
--                           mostra a data, e o retrato velho nunca engana
--   pendencia_financeira    R$ em aberto que o Control informa; NULL = não informou
--   pendencia_financeira_em quando esse valor chegou
--   titulos_vencidos        quantos títulos vencidos o Control informa
-- Bloqueio do Control NÃO trava o representante: block_reason (001) guarda o
-- motivo e o financeiro é avisado. last_purchase_at, total_purchased e
-- overdue_amount (036) continuam sendo o retrato — o Control passa a mandá-los.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS erp_updated_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retrato_referencia_em   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pendencia_financeira    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS pendencia_financeira_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS titulos_vencidos        INTEGER;

COMMENT ON COLUMN customers.pendencia_financeira IS
  'R$ em aberto informado pelo Control. Avisa o financeiro; não trava o representante. Migração 049.';


-- ─── F. Tabelas de preço e condições de pagamento como o Control manda ───────
-- O Control manda TUDO e sobrescreve — MENOS price_tables.name e
-- payment_conditions.description: o CRM casa por eles e a API nunca os regrava.
-- A descrição do Control vai em erp_description. `active` em price_tables só
-- entra se não existir (payment_conditions já tem, da 028). valor_minimo é o
-- menor pedido que a condição aceita, como o Control informa.

ALTER TABLE price_tables
  ADD COLUMN IF NOT EXISTS erp_description TEXT,
  ADD COLUMN IF NOT EXISTS erp_updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active          BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE payment_conditions
  ADD COLUMN IF NOT EXISTS erp_description TEXT,
  ADD COLUMN IF NOT EXISTS erp_updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valor_minimo    NUMERIC(12,2);

COMMENT ON COLUMN price_tables.erp_description IS
  'Descrição da tabela como está no Control. name continua sendo o nome do app (o CRM casa por ele). Migração 049.';
COMMENT ON COLUMN payment_conditions.erp_description IS
  'Descrição da condição como está no Control. description continua sendo a do app (o CRM casa por ela). Migração 049.';


-- ─── G. Catálogo, preço e estoque com o carimbo do Control ───────────────────
-- O Control passa a mandar produtos e tamanhos, o PREÇO por tabela (sobrescreve
-- o do PDF) e o ESTOQUE das duas marcas. Cada um ganha a data em que o Control
-- mandou, separada de updated_at (que qualquer gravação do app carimba).
-- preco_original e desconto_percentual guardam o preço de tabela do Control e o
-- desconto que ele aplicou, quando `price` já chega com desconto.

ALTER TABLE products ADD COLUMN IF NOT EXISTS erp_updated_at TIMESTAMPTZ;

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS stock_updated_at TIMESTAMPTZ;

ALTER TABLE product_prices
  ADD COLUMN IF NOT EXISTS erp_updated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preco_original      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS desconto_percentual NUMERIC(5,2);


-- ─── H. Rastro: três acontecimentos novos ────────────────────────────────────
-- A lista da 048 inteira MAIS:
--   solicitado_ao_erp   o financeiro pediu o lançamento ao Control (A)
--   nota_substituida    uma nota nova tomou o lugar da anterior (C)
--   excluido_pelo_erp   o Control avisou que excluiu (POST /pedidos/:id/excluir)
-- A lista vive aqui e em eventosErp.service.ts (TIPOS_DE_EVENTO_ERP) —
-- tests/migracao-048.test.ts e tests/migracao-049.test.ts conferem que são as
-- mesmas. DROP + ADD para que rerodar este arquivo sempre deixe esta lista
-- valendo. As linhas de hoje só têm tipos da 048, então o CHECK novo as aceita.

ALTER TABLE order_erp_events DROP CONSTRAINT IF EXISTS chk_order_erp_events_tipo;
ALTER TABLE order_erp_events ADD CONSTRAINT chk_order_erp_events_tipo
  CHECK (tipo IN ('numero_gravado', 'numero_corrigido', 'numero_conciliado',
                  'faturado', 'faturamento_alterado', 'faturamento_desfeito',
                  'nota_registrada', 'nota_cancelada', 'excluido',
                  'recusado_pelo_erp', 'alterado_antes_da_confirmacao',
                  'solicitado_ao_erp', 'nota_substituida', 'excluido_pelo_erp'));


-- Recarrega o cache do Supabase. Sem isto as colunas podem existir no banco e
-- continuar invisíveis para a API (erro PGRST204).
NOTIFY pgrst, 'reload schema';
