-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 013 — Proteções do banco
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- CONTEXTO: o app acessa o banco só pela API, com a service_role — que IGNORA
-- RLS. Ou seja: hoje todo o isolamento entre empresas e entre representantes
-- vive na camada de aplicação. Um bug num `.eq('company_id', …)` esquecido não
-- encontra nenhuma barreira no banco.
--
-- Esta migração não resolve isso (resolver exigiria trocar o modelo de acesso).
-- O que ela faz é impedir que dado silenciosamente ERRADO entre, e criar rastro
-- de quem mexeu no que importa: o status do pedido.
--
-- Todas as travas entram como NOT VALID de propósito: valem para tudo que for
-- gravado de agora em diante, sem varrer (nem recusar) as linhas que já existem.
-- Se quiser validar o histórico depois, o bloco D mostra como.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A. Travas contra dado impossível ────────────────────────────────────────
-- Nenhuma destas deveria acontecer pelo app. São rede de segurança para script
-- de sync, importação de planilha e SQL rodado à mão.

DO $$
BEGIN
  -- Preço negativo
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_prices_preco_nao_negativo') THEN
    ALTER TABLE product_prices
      ADD CONSTRAINT chk_product_prices_preco_nao_negativo
      CHECK (price >= 0) NOT VALID;
  END IF;

  -- Comissão fora de 0–100 (um "10" digitado como "1000" viraria um rombo)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_comissao_percentual') THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_comissao_percentual
      CHECK (commission_rate >= 0 AND commission_rate <= 100) NOT VALID;
  END IF;

  -- Total de pedido negativo
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_total_nao_negativo') THEN
    ALTER TABLE orders
      ADD CONSTRAINT chk_orders_total_nao_negativo
      CHECK (total IS NULL OR total >= 0) NOT VALID;
  END IF;

  -- Item com preço ou total negativo (quantity > 0 já existe da 001)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_items_valores_nao_negativos') THEN
    ALTER TABLE order_items
      ADD CONSTRAINT chk_order_items_valores_nao_negativos
      CHECK (unit_price >= 0 AND total >= 0) NOT VALID;
  END IF;

  -- Limite de crédito negativo
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_limite_nao_negativo') THEN
    ALTER TABLE customers
      ADD CONSTRAINT chk_customers_limite_nao_negativo
      CHECK (credit_limit IS NULL OR credit_limit >= 0) NOT VALID;
  END IF;

  -- E-mail de usuário sem formato de e-mail
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_email_formato') THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_email_formato
      CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') NOT VALID;
  END IF;
END $$;

-- NOTA sobre estoque negativo: existem 14 variantes com stock_quantity < 0 hoje.
-- Isso vem do ERP (baixa lançada antes da entrada) e é REALIDADE do lado de lá —
-- não é corrupção nossa. Por isso NÃO há CHECK aqui: uma trava faria o sync
-- quebrar. O app já trata como esgotado (piso em zero no catalog.service).

-- ─── B. updated_at que não depende de ninguém lembrar ────────────────────────
-- Hoje quem escreve updated_at é o código da aplicação, em alguns caminhos. O
-- sync e o SQL manual não escrevem — então a coluna mente sobre quando a linha
-- mudou de verdade, e é nela que a próxima sincronização se baseia.

CREATE OR REPLACE FUNCTION public.tocar_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','product_variants','product_prices','customers','orders','price_tables']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at()', t, t);
  END LOOP;
END $$;

-- ─── C. Rastro de quem mexeu no status do pedido ─────────────────────────────
-- O status do pedido decide comissão e faturamento. Hoje, se um pedido aparece
-- "recusado", não há como saber quem recusou nem quando — só o estado atual.

CREATE TABLE IF NOT EXISTS order_status_history (
  id          BIGSERIAL PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  de          TEXT,
  para        TEXT NOT NULL,
  por         UUID REFERENCES users(id) ON DELETE SET NULL,
  faturado    BOOLEAN,
  em          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order
  ON order_status_history(order_id, em DESC);

ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.registrar_status_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Registra a criação e toda mudança de status ou de faturamento.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO order_status_history (order_id, company_id, de, para, por, faturado)
    VALUES (NEW.id, NEW.company_id, NULL, NEW.status, NEW.created_by, NEW.invoiced);
  ELSIF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.invoiced IS DISTINCT FROM OLD.invoiced THEN
    INSERT INTO order_status_history (order_id, company_id, de, para, por, faturado)
    VALUES (NEW.id, NEW.company_id, OLD.status, NEW.status,
            COALESCE(NEW.approved_by, NEW.created_by), NEW.invoiced);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_status_history ON orders;
CREATE TRIGGER trg_orders_status_history
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.registrar_status_pedido();

-- ─── D. Conferência ──────────────────────────────────────────────────────────
-- As travas do bloco A ficaram NOT VALID: valem para gravação nova, mas não
-- foram conferidas contra o histórico. Para conferir o que já existe (roda um
-- de cada vez; se algum acusar erro, tem linha ruim para investigar ANTES):
--
--   ALTER TABLE product_prices VALIDATE CONSTRAINT chk_product_prices_preco_nao_negativo;
--   ALTER TABLE users          VALIDATE CONSTRAINT chk_users_comissao_percentual;
--   ALTER TABLE users          VALIDATE CONSTRAINT chk_users_email_formato;
--   ALTER TABLE orders         VALIDATE CONSTRAINT chk_orders_total_nao_negativo;
--   ALTER TABLE order_items    VALIDATE CONSTRAINT chk_order_items_valores_nao_negativos;
--   ALTER TABLE customers      VALIDATE CONSTRAINT chk_customers_limite_nao_negativo;
--
-- E para ver o histórico de um pedido:
--   SELECT de, para, faturado, em FROM order_status_history
--   WHERE order_id = '<uuid>' ORDER BY em;
