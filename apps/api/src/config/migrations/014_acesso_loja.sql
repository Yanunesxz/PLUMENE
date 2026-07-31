-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 014 — Acesso da loja e vitrine temporária
-- Executar no Supabase SQL Editor. Idempotente: pode rodar mais de uma vez.
--
-- Dois acessos novos, com mecânicas diferentes:
--
--  • LOJA  — usuário de verdade (users.role = 'store') amarrado a um cliente.
--            Nasce de um convite de USO ÚNICO que o representante gera a partir
--            de um cliente que já está na carteira dele.
--  • VITRINE — NÃO é usuário. É uma linha em showcase_links que, ao ser aberta,
--            vira um JWT de sessão que expira junto com o link. Serve para
--            mostrar o catálogo a um curioso sem abrir conta para ele.
--
-- Os dois só conseguem criar pedido em 'pending_approval'. Aprovar, faturar e
-- ver estoque continuam fora do alcance dos dois.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A. users: papel 'store' e vínculo com o cliente ─────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id UUID
  REFERENCES customers(id) ON DELETE CASCADE;

COMMENT ON COLUMN users.customer_id IS
  'Loja: cliente que este login representa. NULL para admin/manager/rep.';

-- O CHECK de role foi criado na 001 com três papéis; recria incluindo 'store'.
DO $$
DECLARE nome TEXT;
BEGIN
  SELECT c.conname INTO nome
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'users' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%role%admin%';
  IF nome IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', nome);
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT chk_users_role
  CHECK (role IN ('admin', 'manager', 'rep', 'store'));

-- Uma loja tem no máximo UM login.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_customer
  ON users(company_id, customer_id)
  WHERE customer_id IS NOT NULL;

-- ─── B. orders: pedido de vitrine não tem cliente ────────────────────────────
-- Criar um cadastro de cliente para cada curioso encheria a carteira do
-- representante de gente que nunca comprou. Um pedido de vitrine é um pedido
-- SEM cliente, e o banco passa a dizer isso.
ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source        TEXT NOT NULL DEFAULT 'rep';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_whatsapp TEXT;

COMMENT ON COLUMN orders.source IS
  'Quem montou o pedido: rep (representante), store (loja logada), showcase (vitrine).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_source') THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_source
      CHECK (source IN ('rep', 'store', 'showcase'));
  END IF;

  -- Só pedido de vitrine pode ficar sem cliente — e ele precisa dizer quem é.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_cliente_ou_convidado') THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_cliente_ou_convidado
      CHECK (
        customer_id IS NOT NULL
        OR (source = 'showcase' AND guest_name IS NOT NULL AND guest_whatsapp IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

-- ─── C. store_invites — convite de conta, USO ÚNICO ──────────────────────────
CREATE TABLE IF NOT EXISTS store_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  rep_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Só o SHA-256. O valor original existe uma vez, no link entregue à loja:
  -- vazamento do banco não vira acesso.
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_invites_rep
  ON store_invites(company_id, rep_id, created_at DESC);

-- Um convite pendente por cliente de cada vez (evita link duplicado circulando).
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_invites_pendente
  ON store_invites(customer_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE store_invites ENABLE ROW LEVEL SECURITY;

-- ─── D. showcase_links — vitrine temporária ──────────────────────────────────
CREATE TABLE IF NOT EXISTS showcase_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rep_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Tabela de preço congelada na criação: se a do representante mudar depois,
  -- quem abriu o link continua vendo o preço que foi mostrado.
  price_table_id UUID REFERENCES price_tables(id) ON DELETE SET NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  opened_count   INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showcase_links_rep
  ON showcase_links(company_id, rep_id, created_at DESC);

ALTER TABLE showcase_links ENABLE ROW LEVEL SECURITY;

-- ─── E. Conferência ──────────────────────────────────────────────────────────
-- SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN ('customer_id','source','guest_name');
-- SELECT COUNT(*) FROM store_invites;
-- SELECT COUNT(*) FROM showcase_links;
