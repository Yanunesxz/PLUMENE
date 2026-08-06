-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 022 — Controle de logins pelo admin
-- Executar no Supabase SQL Editor. Idempotente e aditiva.
--
-- Duas colunas, dois problemas.
--
-- `permissions` quebra o bloco "gerente". Até aqui, quem entrava como gerente
-- aprovava pedido, faturava, mexia em representante e via comissão — tudo junto,
-- sem meio-termo. O admin não tinha como entregar um pedaço.
--
-- NULO é significativo: quer dizer "padrão do papel", que é exatamente o que o
-- gerente já fazia. Todo gerente que existe hoje continua nulo e não perde nada.
-- O array só passa a existir quando o admin salva as teclas dele. Array VAZIO é
-- diferente de nulo: é o admin dizendo "este gerente não faz nada".
--
-- `last_login_at` responde "quem de fato usa isto?". Sem ela, a única forma de
-- saber se um login ainda serve é perguntar para a pessoa.
--
-- Sem esta migração o sistema roda: a leitura usa `select('*')` e a escrita
-- detecta a coluna antes de gravar, avisando na tela quando ignorou as teclas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions   TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

COMMENT ON COLUMN users.permissions IS
  'Teclas do gerente. NULO = padrão do papel; array vazio = nenhuma permissão. Ignorada nos demais papéis.';
COMMENT ON COLUMN users.last_login_at IS
  'Último login bem-sucedido. Gravado sem segurar a resposta do login.';
