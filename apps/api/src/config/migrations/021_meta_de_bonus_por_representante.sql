-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 021 — Meta de bonificação por representante
-- Executar no Supabase SQL Editor. Idempotente.
--
-- A bonificação existia num aviso colado na parede, com quatro faixas iguais
-- para todo mundo. Não é assim: cada representante tem a meta dele, e ela muda
-- de mês para mês. Quem cadastra é o gerente.
--
-- Uma linha por FAIXA, não um JSON com as quatro: assim o banco garante que
-- meta e bônus são números positivos, e o dia em que o fechamento precisar
-- somar bonificação por período isso é uma consulta, não um parse.
--
-- `competencia` é sempre o primeiro dia do mês. O mês sem cadastro herda o
-- último cadastro anterior (regra da aplicação, ver `faixasVigentes`): a
-- bonificação fica meses igual, e obrigar o gerente a recadastrar todo mês só
-- deixaria representante sem régua na tela.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rep_bonus_tiers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  competencia DATE NOT NULL,
  -- Posição na régua (0 a 3). O gerente decide quantas faixas existem.
  ordem       INTEGER NOT NULL CHECK (ordem BETWEEN 0 AND 3),
  meta        NUMERIC(12, 2) NOT NULL CHECK (meta > 0),
  bonus       NUMERIC(12, 2) NOT NULL CHECK (bonus > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, competencia, ordem)
);

COMMENT ON TABLE rep_bonus_tiers IS
  'Faixas de bonificação de um representante numa competência (mês). O mês sem linhas herda o último mês cadastrado antes dele.';

-- A consulta quente é "as faixas deste rep até este mês", para pegar a vigente.
CREATE INDEX IF NOT EXISTS idx_rep_bonus_tiers_vigente
  ON rep_bonus_tiers(user_id, competencia DESC);

ALTER TABLE rep_bonus_tiers ENABLE ROW LEVEL SECURITY;

-- Competência sempre no dia 1: sem isto, cadastrar "15/08" criaria um segundo
-- mês de agosto e as duas metas conviveriam.
CREATE OR REPLACE FUNCTION rep_bonus_tiers_primeiro_dia() RETURNS TRIGGER AS $$
BEGIN
  NEW.competencia := date_trunc('month', NEW.competencia)::date;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rep_bonus_tiers_primeiro_dia ON rep_bonus_tiers;
CREATE TRIGGER trg_rep_bonus_tiers_primeiro_dia
  BEFORE INSERT OR UPDATE ON rep_bonus_tiers
  FOR EACH ROW EXECUTE FUNCTION rep_bonus_tiers_primeiro_dia();
