/**
 * Tarefa do representante (migração 037): o escritório manda, o rep executa.
 *
 * Ciclo: `pendente` → `confirmada` (o rep deu OK no horário que a Bruna
 * marcou) → `feita`. Marcar feita direto da pendente também vale — o OK é
 * para quem marcou saber que o rep viu e topou, não uma etapa burocrática.
 */
export type StatusDaTarefa = 'pendente' | 'confirmada' | 'feita';

export interface TarefaDoRep {
  id: string;
  rep_id: string;
  /** Nome do representante — para a lista do escritório. */
  rep_nome: string | null;
  /** Quem pediu (Fabian, Bruna…). */
  criado_por_nome: string | null;
  /** Visita marcada a um cliente. Nulo = tarefa avulsa. */
  customer_id: string | null;
  cliente_nome: string | null;
  titulo: string;
  /** Data/horário combinado (ISO). Nulo = sem hora marcada. */
  prazo: string | null;
  /** Onde é a visita — endereço, loja, ponto de encontro. */
  local: string | null;
  /** O que quem marcou apurou na ligação: contexto para o rep chegar preparado. */
  observacoes: string | null;
  status: StatusDaTarefa;
  created_at: string;
}

export interface CriarTarefaRequest {
  /** Ausente com customer_id presente = o dono da carteira do cliente. */
  rep_id?: string;
  customer_id?: string;
  titulo: string;
  /** ISO com offset. */
  prazo?: string;
  local?: string;
  observacoes?: string;
}
