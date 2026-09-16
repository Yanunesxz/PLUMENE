-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 048 — Integração com o Control, fase 0 (a base antes de ligar a API)
-- Executar no Supabase SQL Editor, nos DOIS bancos. Idempotente e só aditiva:
-- nenhuma coluna existente muda de nome, de tipo ou de valor.
--
-- O que entra (letras do plano PRONTIDAO §9.2 e do contrato da fase 0):
--
--   A) erp_sync_log ganha o registro de cada chamada do parceiro
--   B) companies ganha o CANAL oficial de cada fluxo, por empresa
--   C) orders ganha a ORIGEM do número do Control (quem gravou e por onde)
--   D) order_erp_events: o rastro do pedido com o Control (sobrevive à exclusão)
--   F) public.codigo_miolo(): a regra única do código do Control, e a proteção
--      de price_tables antes de preencher erp_code
--   H) users.updated_at (sem gatilho, sem backfill)
--   N) order_invoices e order_invoice_items: as NOTAS e os itens que o Control
--      faturou de verdade (o "como o pedido foi faturado" do pedido original)
--
-- A API sobe ANTES deste SQL: todo código que usa estas colunas pergunta com
-- detectar() e, sem elas, segue exatamente como antes.
--
-- ANTES DE RODAR (as duas consultas devem vir vazias; se não vierem, pare e
-- avise — o índice ou a trava do bloco F recusariam o SQL inteiro):
--
--   SELECT id, name, price_column FROM price_tables
--    WHERE price_column IS NULL OR price_column NOT BETWEEN 1 AND 6;
--
--   SELECT company_id, upper(erp_code), count(*) FROM price_tables
--    WHERE erp_code IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
--   (a conferência exata pelo miolo só existe depois da função; hoje há 0
--    códigos preenchidos nos dois bancos)
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── A. erp_sync_log registra as chamadas do parceiro ────────────────────────
-- A tabela da 002 tinha 0 linhas nos dois bancos (15/09/2026). As colunas
-- antigas continuam e o código as preenche: sync_type = 'parceiro',
-- status = 'success' | 'error', finished_at, records_synced = gravados.
-- company_id segue aceitando NULL só para chamada 401/503 (sem empresa).
-- `detalhe` leva só códigos, posições, motivos e contagens — nunca nome, CNPJ,
-- e-mail, telefone ou valor.

ALTER TABLE erp_sync_log
  ADD COLUMN IF NOT EXISTS parceiro     TEXT,
  ADD COLUMN IF NOT EXISTS rota         TEXT,
  ADD COLUMN IF NOT EXISTS metodo       TEXT,
  ADD COLUMN IF NOT EXISTS http_status  INTEGER,
  ADD COLUMN IF NOT EXISTS recebidos    INTEGER,
  ADD COLUMN IF NOT EXISTS gravados     INTEGER,
  ADD COLUMN IF NOT EXISTS sem_mudanca  INTEGER,
  ADD COLUMN IF NOT EXISTS ignorados    INTEGER,
  ADD COLUMN IF NOT EXISTS detalhe      JSONB,
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_erp_sync_log_rota
  ON erp_sync_log (company_id, rota, started_at DESC);

-- EXPURGO (combinado, não automático): a tabela só cresce. Chamada com chave
-- errada também entra — é o que interessa ver —, e requisição SEM chave nenhuma
-- não entra (partner.chamada.ts, `vaiParaOLog`), senão qualquer varredura da
-- internet escreveria aqui. Quando o registro passar de uns meses, rode à mão;
-- o índice acima atende o filtro:
--
--   DELETE FROM erp_sync_log
--    WHERE sync_type = 'parceiro' AND started_at < now() - interval '180 days';


-- ─── B. Canal oficial de cada fluxo, por empresa ─────────────────────────────
-- Um fluxo tem UM escritor. Os padrões reproduzem o comportamento de hoje
-- (planilha e cargas à mão; sync.py e Firebird travados). A virada é um UPDATE
-- por empresa feito pelo Yan, com canais_atualizados_em = now():
--
--   UPDATE companies SET canal_pedido_erp = 'api', canais_atualizados_em = now()
--    WHERE id = '<uuid da empresa>';
--
-- No banco, e não em variável de ambiente, porque o banco da Corpo Sensual tem
-- duas empresas e a virada precisa ser por empresa e ficar registrada.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS canal_pedido_erp      TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS canal_faturamento     TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS canal_cadastro        TEXT NOT NULL DEFAULT 'carga',
  ADD COLUMN IF NOT EXISTS canal_retrato         TEXT NOT NULL DEFAULT 'carga',
  ADD COLUMN IF NOT EXISTS canal_catalogo        TEXT NOT NULL DEFAULT 'carga',
  ADD COLUMN IF NOT EXISTS canais_atualizados_em TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_canal_pedido_erp') THEN
    ALTER TABLE companies ADD CONSTRAINT chk_companies_canal_pedido_erp
      CHECK (canal_pedido_erp IN ('manual', 'api', 'sync_py'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_canal_faturamento') THEN
    ALTER TABLE companies ADD CONSTRAINT chk_companies_canal_faturamento
      CHECK (canal_faturamento IN ('manual', 'api'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_canal_cadastro') THEN
    ALTER TABLE companies ADD CONSTRAINT chk_companies_canal_cadastro
      CHECK (canal_cadastro IN ('carga', 'api', 'firebird'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_canal_retrato') THEN
    ALTER TABLE companies ADD CONSTRAINT chk_companies_canal_retrato
      CHECK (canal_retrato IN ('carga', 'api'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_canal_catalogo') THEN
    ALTER TABLE companies ADD CONSTRAINT chk_companies_canal_catalogo
      CHECK (canal_catalogo IN ('carga', 'api', 'firebird'));
  END IF;
END $$;


-- ─── C. Origem do número do Control ──────────────────────────────────────────
-- erp_order_id tem quatro escritores (lançamento na tela, correção na tela,
-- API de parceiro, sync.py). Sem backfill: os números que já existem ficam com
-- origem NULL, que significa "gravado antes desta coluna existir".

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS erp_order_source TEXT,
  ADD COLUMN IF NOT EXISTS erp_order_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erp_order_set_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_erp_order_source') THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_erp_order_source
      CHECK (erp_order_source IS NULL
             OR erp_order_source IN ('api', 'lancamento', 'correcao', 'conciliacao', 'sync_py'))
      NOT VALID;
  END IF;
END $$;


-- ─── D. Rastro do pedido com o Control ───────────────────────────────────────
-- Acumula (uma linha por acontecimento) e SOBREVIVE à exclusão do pedido: por
-- isso order_id não tem chave estrangeira. `antes` e `depois` levam só o que
-- mudou no pedido (número, status, faturado, data e valor da nota), nunca
-- dado de cliente.

CREATE TABLE IF NOT EXISTS order_erp_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL,
  order_number INTEGER,
  tipo         TEXT NOT NULL,
  origem       TEXT NOT NULL,
  parceiro     TEXT,
  por          UUID REFERENCES users(id) ON DELETE SET NULL,
  por_nome     TEXT,
  motivo       TEXT,
  antes        JSONB,
  depois       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- As listas vivem aqui (e em eventosErp.service.ts — tests/migracao-048.test.ts
-- confere que são as mesmas). DROP + ADD para que rerodar este arquivo sempre
-- deixe a lista do arquivo valendo.
ALTER TABLE order_erp_events DROP CONSTRAINT IF EXISTS chk_order_erp_events_tipo;
ALTER TABLE order_erp_events ADD CONSTRAINT chk_order_erp_events_tipo
  CHECK (tipo IN ('numero_gravado', 'numero_corrigido', 'numero_conciliado',
                  'faturado', 'faturamento_alterado', 'faturamento_desfeito',
                  'nota_registrada', 'nota_cancelada', 'excluido',
                  'recusado_pelo_erp', 'alterado_antes_da_confirmacao'));

ALTER TABLE order_erp_events DROP CONSTRAINT IF EXISTS chk_order_erp_events_origem;
ALTER TABLE order_erp_events ADD CONSTRAINT chk_order_erp_events_origem
  CHECK (origem IN ('api', 'tela', 'script', 'sync_py'));

CREATE INDEX IF NOT EXISTS idx_order_erp_events_pedido
  ON order_erp_events (company_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_erp_events_empresa
  ON order_erp_events (company_id, created_at DESC);

ALTER TABLE order_erp_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE order_erp_events IS
  'Rastro do pedido com o Control (número, faturamento, notas, exclusão). Sem FK em order_id: sobrevive à exclusão. Migração 048.';


-- ─── F. Regra única do código do Control ─────────────────────────────────────
-- "#2225", "2225", " 02225 " e "02225" são o MESMO cadastro no Control. O miolo
-- tira "#" e espaços (todos), passa para maiúscula e tira os zeros à esquerda;
-- só zeros vira '0'; vazio vira NULL. É a mesma regra de codigoMiolo()
-- (packages/shared/src/cadastro/codigoErp.ts) — tests/codigo-miolo.test.ts
-- confere a paridade com os casos da consulta de conferência no fim do arquivo.

CREATE OR REPLACE FUNCTION public.codigo_miolo(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN regexp_replace(upper(coalesce(t, '')), '[#[:space:]]', '', 'g') = '' THEN NULL
    ELSE coalesce(nullif(ltrim(regexp_replace(upper(t), '[#[:space:]]', '', 'g'), '0'), ''), '0')
  END
$$;

COMMENT ON FUNCTION public.codigo_miolo(text) IS
  'Miolo do código do Control: sem # e espaços, maiúscula, sem zeros à esquerda (só zeros = 0, vazio = NULL). Mesma regra de codigoMiolo() no app. Migração 048.';

-- price_column é a coluna de preço do Control (1 a 6). Hoje só existe 1.
ALTER TABLE price_tables DROP CONSTRAINT IF EXISTS chk_price_tables_price_column_1_a_6;
ALTER TABLE price_tables ADD CONSTRAINT chk_price_tables_price_column_1_a_6
  CHECK (price_column BETWEEN 1 AND 6);

-- Duas tabelas da mesma empresa nunca com o mesmo código pelo miolo ("#01" e
-- "1" seriam a mesma tabela no Control). O índice da 002 continua.
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_tables_erp_code_miolo
  ON price_tables (company_id, public.codigo_miolo(erp_code))
  WHERE erp_code IS NOT NULL;

-- ATENÇÃO, no dia em que o CORPO de codigo_miolo() mudar (por exemplo para
-- tirar também ponto ou hífen, acompanhando codigoErp.ts): o Postgres aceita o
-- CREATE OR REPLACE acima e NÃO reconstrói este índice — ele continua guardando
-- as chaves da regra antiga, e dois códigos que a regra nova considera iguais
-- entram sem colidir, em silêncio. Depois de mudar a função, rode:
--
--   REINDEX INDEX idx_price_tables_erp_code_miolo;
--
-- (e confira antes os repetidos com a consulta do fim deste arquivo).


-- ─── H. users.updated_at ─────────────────────────────────────────────────────
-- Sem gatilho: todo login grava last_login_at e a troca de hash também, e isso
-- não é "o cadastro mudou". Sem backfill: a coluna nasce sem padrão (as linhas
-- de hoje ficam NULL = "sem gravação desde a coluna") e só depois ganha now()
-- como padrão para os logins novos. Quem carimba é o código, com detectar().

ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT now();


-- ─── N. Notas fiscais e itens faturados ──────────────────────────────────────
-- Pedido do Yan (11/09/2026): guardar o original e mostrar como o pedido FOI
-- faturado. O pedido do app (order_items) continua sendo o pedido lançado — o
-- que a foto da 046 compara. O que o Control faturou de verdade mora aqui, por
-- nota: um pedido pode ter mais de uma (faturamento parcial), e reenviar a
-- mesma nota não duplica (chave única por empresa, pedido, série e número).
-- A cor não é identificável pelo Control: o item faturado casa com o pedido
-- por produto + tamanho (e pela variante, quando o app a acha).

CREATE TABLE IF NOT EXISTS order_invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  numero       TEXT NOT NULL,
  serie        TEXT NOT NULL DEFAULT '',
  chave        TEXT,
  emitida_em   TIMESTAMPTZ,
  valor        NUMERIC(12,2),
  -- Nota cancelada não some: fica marcada, e a tela deixa de somar os itens dela.
  cancelada_em TIMESTAMPTZ,
  origem       TEXT NOT NULL DEFAULT 'api',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_invoices_nota UNIQUE (company_id, order_id, serie, numero)
);

CREATE INDEX IF NOT EXISTS idx_order_invoices_pedido ON order_invoices (order_id);

ALTER TABLE order_invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE order_invoices IS
  'Notas fiscais do pedido, como o Control informou. Uma linha por nota (série + número). Migração 048.';

CREATE TABLE IF NOT EXISTS order_invoice_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id     UUID NOT NULL REFERENCES order_invoices(id) ON DELETE CASCADE,
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- O mesmo código de produto e o mesmo tamanho que o GET /partner/v1/pedidos manda.
  produto        TEXT NOT NULL,
  tamanho        TEXT NOT NULL,
  -- NULL quando o app não achou a variante: o item continua guardado.
  variant_id     UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantidade     INTEGER NOT NULL CONSTRAINT chk_order_invoice_items_quantidade CHECK (quantidade > 0),
  preco_unitario NUMERIC(12,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_invoice_items_pedido ON order_invoice_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_invoice_items_nota ON order_invoice_items (invoice_id);

ALTER TABLE order_invoice_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE order_invoice_items IS
  'Itens de cada nota do pedido (produto + tamanho + quantidade faturada). Reenviar os itens de uma nota substitui os daquela nota. Migração 048.';


-- Recarrega o cache do Supabase. Sem isto as colunas e tabelas podem existir no
-- banco e continuar invisíveis para a API (erro PGRST204/PGRST205).
NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- Pela API (GET de verdade, nunca HEAD): node _tools/conferir-048.mjs
-- (e node _tools/conferir-048.mjs <raiz da PLUMENE> para o outro banco).
--
-- No SQL Editor:
--   SELECT canal_pedido_erp, canal_faturamento, canal_cadastro, canal_retrato,
--          canal_catalogo, canais_atualizados_em FROM companies;
--
--   SELECT conname FROM pg_constraint
--    WHERE conname IN ('chk_companies_canal_pedido_erp', 'chk_companies_canal_faturamento',
--                      'chk_companies_canal_cadastro', 'chk_companies_canal_retrato',
--                      'chk_companies_canal_catalogo', 'chk_orders_erp_order_source',
--                      'chk_order_erp_events_tipo', 'chk_order_erp_events_origem',
--                      'chk_price_tables_price_column_1_a_6', 'uq_order_invoices_nota');
--   (deve dar 10 linhas)
--
--   SELECT count(*) FROM pg_indexes
--    WHERE indexname IN ('idx_erp_sync_log_rota', 'idx_order_erp_events_pedido',
--                        'idx_order_erp_events_empresa', 'idx_price_tables_erp_code_miolo',
--                        'idx_order_invoices_pedido', 'idx_order_invoice_items_pedido',
--                        'idx_order_invoice_items_nota');
--   (deve dar 7)
--
-- Paridade do miolo com o app (deve vir VAZIA; os mesmos casos estão em
-- tests/codigo-miolo.test.ts, que lê esta lista daqui):
--   SELECT entrada, esperado, public.codigo_miolo(entrada) AS obtido
--     FROM (VALUES
--       ('2225', '2225'),
--       ('02225', '2225'),
--       ('#2225', '2225'),
--       ('#02225', '2225'),
--       (' 02225 ', '2225'),
--       ('00779', '779'),
--       ('779', '779'),
--       ('cs779', 'CS779'),
--       ('CS 779', 'CS779'),
--       ('0A1', 'A1'),
--       ('A001', 'A001'),
--       ('10', '10'),
--       ('100', '100'),
--       ('0', '0'),
--       ('000', '0'),
--       ('#000', '0'),
--       ('#', NULL),
--       ('##', NULL),
--       ('', NULL),
--       ('   ', NULL),
--       (NULL, NULL)
--     ) AS casos(entrada, esperado)
--    WHERE public.codigo_miolo(entrada) IS DISTINCT FROM esperado;
