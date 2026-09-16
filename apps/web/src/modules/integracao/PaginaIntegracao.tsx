import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Cable, CheckCircle2, Clock3, ListOrdered, Radio, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { Badge } from '../../components/interface/Badge.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import type { ApiResponse } from '@csb/shared';

/**
 * A tela da integração com o Control (decisão 7 de 16/09/2026).
 *
 * O Control puxa tudo sozinho pela API, a cada poucos minutos, e ninguém vê.
 * Quando o número de um pedido demora, a dúvida é sempre "o Control está
 * falando com o app?". Esta tela responde: os canais ligados, a última passada
 * do Control em cada rota, quantos pedidos estão em cada etapa da fila, e o
 * botão de pedir uma sincronização agora — que só REGISTRA o pedido; quem
 * puxa continua sendo o Control, na próxima passagem.
 *
 * Financeiro, gerente e admin olham; financeiro e admin pedem.
 */

// O contrato de GET /erp/integracao/status (integracao.service.ts). Espelhado
// aqui de propósito: é só desta tela.
interface Canais {
  pedido_erp: string;
  faturamento: string;
  cadastro: string;
  retrato: string;
  catalogo: string;
  migracao: boolean;
}

interface UltimaChamada {
  metodo: 'GET' | 'POST';
  rota: string;
  titulo: string;
  quando: string | null;
  http_status: number | null;
  recebidos: number | null;
  gravados: number | null;
  ignorados: number | null;
  sem_mudanca: number | null;
}

interface ContagensDaFila {
  aguardando_clique: number | null;
  solicitados_sem_numero: number;
  enviados_sem_numero: number;
  sem_faturamento: number;
}

interface SolicitacaoDeSync {
  solicitado_em: string;
  solicitado_por: string | null;
  solicitado_por_nome: string | null;
}

interface EstadoDaIntegracao {
  servidor_hora: string;
  canais: Canais | null;
  sincronizar_agora: boolean;
  solicitacao: SolicitacaoDeSync | null;
  /**
   * O pedido pendente e se já expirou (15 min sem o Control concluir). Opcional
   * de propósito: a tela pode subir antes da API que devolve o campo — sem ele,
   * nada está expirado, como antes.
   */
  sincronizacao?: { solicitado_em: string | null; expirado: boolean };
  chamadas: UltimaChamada[] | null;
  fila: ContagensDaFila | null;
  migracoes: {
    canais: boolean;
    registro: boolean;
    sincronizacao: boolean;
    solicitacao_do_pedido: boolean;
  };
  avisos: string[];
}

interface RespostaDoPedido {
  ja_solicitado: boolean;
  solicitacao: SolicitacaoDeSync;
}

/** A tela se atualiza sozinha: o Control passa a cada minuto, a tela também. */
const INTERVALO_MS = 60_000;

const CANAIS: Array<{ chave: keyof Omit<Canais, 'migracao'>; titulo: string; oQueLiga: string }> = [
  { chave: 'pedido_erp', titulo: 'Pedidos', oQueLiga: 'fila de pedidos, número do Control e conciliação' },
  { chave: 'faturamento', titulo: 'Faturamento', oQueLiga: 'nota e peças faturadas' },
  { chave: 'cadastro', titulo: 'Cadastro', oQueLiga: 'clientes e representantes' },
  { chave: 'retrato', titulo: 'Retrato do cliente', oQueLiga: 'última compra, total comprado, vencido' },
  { chave: 'catalogo', titulo: 'Catálogo', oQueLiga: 'produtos, tamanhos, preço e estoque' },
];

const NOME_DO_VALOR: Record<string, string> = {
  api: 'API (Control)',
  manual: 'À mão, no app',
  carga: 'Carga por planilha',
  sync_py: 'Script sync.py',
  firebird: 'Firebird direto',
};

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "há 2 min", "há 3 h", "há 2 dias" — o que a pessoa quer saber é se foi hoje. */
function haQuanto(iso: string, agora: number): string {
  const seg = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
  if (seg < 60) return 'agora mesmo';
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

function corDoStatus(status: number | null): 'gray' | 'green' | 'yellow' | 'red' {
  if (status == null) return 'gray';
  if (status < 400) return 'green';
  if (status < 500) return 'yellow';
  return 'red';
}

function numero(v: number | null): string {
  return v == null ? '—' : String(v);
}

export function PaginaIntegracao() {
  const { token, hasRole } = useAuthStore();
  const podePedir = hasRole('admin', 'financeiro');
  const [estado, setEstado] = useState<EstadoDaIntegracao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    try {
      const r = await api.get<ApiResponse<EstadoDaIntegracao>>('/erp/integracao/status', token);
      setEstado(r.data);
      setErro(null);
      setAgora(Date.now());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler o estado da integração.');
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [carregar]);

  const pedir = async () => {
    if (!token || pedindo) return;
    setPedindo(true);
    try {
      const r = await api.patch<ApiResponse<RespostaDoPedido>>('/erp/integracao/sincronizar', {}, token);
      setEstado((atual) =>
        atual
          ? {
              ...atual,
              sincronizar_agora: true,
              solicitacao: r.data.solicitacao,
              sincronizacao: { solicitado_em: r.data.solicitacao.solicitado_em, expirado: false },
            }
          : atual,
      );
      setAgora(Date.now());
      setToast({
        message: r.data.ja_solicitado
          ? 'Já havia um pedido registrado; o Control puxa na próxima passagem.'
          : 'Pedido registrado; o Control puxa na próxima passagem.',
        type: 'success',
      });
    } catch (e) {
      setToast({
        message: e instanceof Error ? e.message : 'Não foi possível registrar o pedido.',
        type: 'error',
      });
    } finally {
      setPedindo(false);
    }
  };

  const pendente = estado?.solicitacao ?? null;
  // Expirado (15 min sem o Control concluir): o Control não roda mais por este
  // pedido, e o botão volta a poder pedir.
  const expirado = Boolean(pendente) && estado?.sincronizacao?.expirado === true;
  const aguardando = Boolean(pendente) && !expirado;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Integração com o Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O que o Control puxou, o que está esperando, e o botão de pedir uma passada agora.
          </p>
        </div>
        <Button variant="outline" size="md" disabled={carregando} onClick={() => void carregar()} aria-label="Atualizar">
          <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} strokeWidth={2.5} />
          <span className="hidden sm:inline">Atualizar</span>
        </Button>
      </div>

      {erro && (
        <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>
      )}

      {estado && estado.avisos.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
          {estado.avisos.map((a) => (
            <li key={a} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {a}
            </li>
          ))}
        </ul>
      )}

      {!estado && !erro && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {estado && (
        <div className="space-y-6">
          {/* ── Pedir sincronização agora ─────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Sincronizar agora
            </h2>
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              {!estado.migracoes.sincronizacao ? (
                <p className="text-sm text-muted-foreground">
                  A migração 049 ainda não rodou neste banco: o pedido de sincronização ainda não tem onde
                  ficar. O Control continua passando sozinho, nos intervalos dele.
                </p>
              ) : pendente && expirado ? (
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" strokeWidth={2} />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">
                      Pedido expirado (o Control não respondeu em 15 min).
                    </p>
                    <p className="text-muted-foreground">
                      O pedido foi registrado {quando(pendente.solicitado_em)}
                      {pendente.solicitado_por_nome ? ` por ${pendente.solicitado_por_nome}` : ''} (
                      {haQuanto(pendente.solicitado_em, agora)}) e o Control não avisou que rodou. Ele não
                      roda mais por este pedido: veja as chamadas abaixo e, se precisar, peça de novo.
                    </p>
                  </div>
                </div>
              ) : pendente ? (
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-warn-soft-foreground" strokeWidth={2} />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">
                      Pedido registrado {quando(pendente.solicitado_em)}
                      {pendente.solicitado_por_nome ? ` por ${pendente.solicitado_por_nome}` : ''} (
                      {haQuanto(pendente.solicitado_em, agora)}).
                    </p>
                    <p className="text-muted-foreground">
                      O Control puxa na próxima passagem e avisa quando terminar — aí este aviso some. Se
                      passar de 15 minutos, o pedido expira: o Control não está chegando aqui — veja as
                      chamadas abaixo.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-positive" strokeWidth={2} />
                  <p className="text-sm text-muted-foreground">
                    Nada pendente. O Control passa sozinho a cada poucos minutos; peça agora só quando não
                    der para esperar a próxima passagem.
                  </p>
                </div>
              )}

              {podePedir && estado.migracoes.sincronizacao && (
                <div className="mt-4 flex justify-end">
                  <Button disabled={pedindo || aguardando} onClick={() => void pedir()}>
                    <Radio className="h-4 w-4" strokeWidth={2.5} />
                    {pedindo
                      ? 'Registrando…'
                      : aguardando
                        ? 'Já pedido'
                        : expirado
                          ? 'Pedir de novo'
                          : 'Pedir sincronização agora'}
                  </Button>
                </div>
              )}
            </div>
          </section>

          {/* ── Fila de pedidos ───────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Fila de pedidos
            </h2>
            {estado.fila ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Contagem
                  valor={estado.fila.aguardando_clique}
                  titulo="Aguardando o clique"
                  detalhe={
                    estado.migracoes.solicitacao_do_pedido
                      ? 'Aprovados que o financeiro ainda não mandou lançar.'
                      : 'Precisa da migração 049 para contar.'
                  }
                />
                <Contagem
                  valor={estado.fila.solicitados_sem_numero}
                  titulo="Esperando o número"
                  detalhe={
                    estado.migracoes.solicitacao_do_pedido
                      ? 'Lançamento pedido; o Control ainda não devolveu o número.'
                      : 'Aprovados sem número do Control (a fila que o Control puxa).'
                  }
                />
                <Contagem
                  valor={estado.fila.enviados_sem_numero}
                  titulo="Enviados sem número"
                  detalhe="Foram para o ERP sem número: o passivo que a conciliação resolve."
                />
                <Contagem
                  valor={estado.fila.sem_faturamento}
                  titulo="Sem faturamento"
                  detalhe="Já têm número do Control; esperam a nota."
                />
              </div>
            ) : (
              <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
                Não deu para contar a fila agora.
              </p>
            )}
          </section>

          {/* ── Canais ───────────────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Canais ligados
            </h2>
            <div className="rounded-xl border border-border bg-card shadow-sm">
              {estado.canais ? (
                <>
                  {!estado.migracoes.canais && (
                    <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
                      A migração 048 ainda não rodou neste banco: valem os padrões (tudo à mão / por carga).
                    </p>
                  )}
                  <ul className="divide-y divide-border">
                    {CANAIS.map(({ chave, titulo, oQueLiga }) => {
                      const valor = estado.canais![chave];
                      return (
                        <li key={chave} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{titulo}</p>
                            <p className="truncate text-xs text-muted-foreground">{oQueLiga}</p>
                          </div>
                          <Badge variant={valor === 'api' ? 'green' : valor === 'manual' || valor === 'carga' ? 'gray' : 'yellow'}>
                            <Cable className="h-3 w-3" strokeWidth={2.5} />
                            {NOME_DO_VALOR[valor] ?? valor}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Não deu para ler os canais agora.</p>
              )}
            </div>
          </section>

          {/* ── Últimas chamadas ──────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Última passada do Control, por rota
            </h2>
            <div className="rounded-xl border border-border bg-card shadow-sm">
              {estado.chamadas === null ? (
                <p className="p-4 text-sm text-muted-foreground">Não deu para ler o registro das chamadas agora.</p>
              ) : !estado.migracoes.registro ? (
                <p className="p-4 text-sm text-muted-foreground">
                  A migração 048 ainda não rodou neste banco: o registro das chamadas do Control ainda não
                  existe.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {estado.chamadas.map((c) => (
                    <li key={`${c.metodo} ${c.rota}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm font-medium text-foreground">{c.titulo}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {c.metodo} {c.rota}
                        </p>
                      </div>
                      <div className="w-36 text-sm">
                        {c.quando ? (
                          <>
                            <p className="text-foreground">{haQuanto(c.quando, agora)}</p>
                            <p className="text-xs text-muted-foreground">{quando(c.quando)}</p>
                          </>
                        ) : (
                          <p className="text-muted-foreground">nunca chamada</p>
                        )}
                      </div>
                      <div className="w-20">
                        <Badge variant={corDoStatus(c.http_status)}>{c.http_status == null ? '—' : `HTTP ${c.http_status}`}</Badge>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span title="Registros que chegaram">recebidos {numero(c.recebidos)}</span>
                        <span title="Registros gravados">gravados {numero(c.gravados)}</span>
                        <span title="Registros ignorados (com motivo no registro)">ignorados {numero(c.ignorados)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <ListOrdered className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Intervalos combinados: fila de pedidos a cada 1 min; cadastros e alterações a cada 5 min;
              catálogo, preço e estoque a cada 30 min; retrato do cliente 1x por dia. Esta tela se
              atualiza sozinha a cada minuto.
            </p>
          </section>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

function Contagem({ valor, titulo, detalhe }: { valor: number | null; titulo: string; detalhe: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="titulo text-[28px] leading-none text-foreground">{valor == null ? '—' : valor}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{titulo}</p>
      <p className="text-xs text-muted-foreground">{detalhe}</p>
    </div>
  );
}
