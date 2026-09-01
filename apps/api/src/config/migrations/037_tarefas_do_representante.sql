-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 037 — Tarefas para o representante
-- Executar no Supabase SQL Editor. Idempotente.
--
-- O escritório manda, o representante executa. Dois usos que batizaram o
-- recurso (Yan, 25/08/2026):
--   • o Fabian (gerente comercial) marca "as coisas para o representante fazer"
--   • a Bruna (interna, dona da carteira de inativos) liga para o cliente
--     parado e MARCA A VISITA com horário — e o representante dá o OK.
--
-- O ciclo é: pendente → confirmada (o rep deu OK no horário) → feita.
-- O OK existe para quem marcou saber que o rep viu e topou; marcar feita
-- direto da pendente também vale (tarefa sem horário não precisa de aceite).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rep_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  /** Para quem é a tarefa. */
  rep_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /** Quem pediu (Fabian, Bruna, gerência). */
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /** Visita marcada a um cliente — opcional, liga a tarefa à ficha. */
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  /** Data/horário combinado. NULL = tarefa sem hora marcada. */
  prazo TIMESTAMPTZ,
  /** Onde é a visita — endereço, loja, ponto de encontro. */
  local TEXT,
  /** O que a Bruna apurou na ligação: contexto para o rep chegar preparado. */
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'confirmada', 'feita')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A consulta quente do rep: "minhas tarefas abertas, mais próximas primeiro".
CREATE INDEX IF NOT EXISTS idx_rep_tasks_do_rep
  ON rep_tasks(company_id, rep_id, status, prazo);

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT u.name AS rep, t.titulo, t.status, t.prazo
--   FROM rep_tasks t JOIN users u ON u.id = t.rep_id
--  ORDER BY t.created_at DESC LIMIT 20;
