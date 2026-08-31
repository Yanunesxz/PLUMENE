import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  MessageCircle,
  Mail,
  MapPin,
  Tag,
  ShoppingCart,
  ChevronRight,
  Receipt,
  CalendarClock,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { useMinhasTabelas } from '../../hooks/useMinhasTabelas.js';
import { Badge } from '../../components/interface/Badge.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import { TrocarTabelaDoCliente } from './TrocarTabelaDoCliente.js';
import { seloDoPedido } from '../../lib/pedido.js';
import { situacaoDaCompra, VARIANTE_DO_FRESCOR } from '../../lib/carteira.js';
import { formatBRL } from '../../lib/utils.js';
import type { ApiResponse, CustomerDetail } from '@csb/shared';

/**
 * A ficha do cliente.
 *
 * Antes, tocar no cliente já abria um pedido em branco. O representante
 * começava a vender sem ver por qual tabela aquela loja compra nem quando ela
 * comprou pela última vez — as duas coisas que decidem a conversa. Agora o
 * pedido continua a um toque (pelo botão no cartão da lista), mas o caminho
 * padrão passa por aqui.
 */
export function PaginaCliente() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const { tabelas, nomeDe } = useMinhasTabelas();

  const [cliente, setCliente] = useState<CustomerDetail | null>(null);
  const [erro, setErro] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // ─── Marcar visita para o representante (fluxo da Bruna) ───────────────────
  const ehEscritorio =
    user?.role === 'manager' ||
    user?.role === 'admin' ||
    user?.role === 'financeiro' ||
    user?.role === 'relacionamento';
  const [marcando, setMarcando] = useState(false);
  const [tituloVisita, setTituloVisita] = useState('');
  const [prazoVisita, setPrazoVisita] = useState('');
  const [localVisita, setLocalVisita] = useState('');
  const [obsVisita, setObsVisita] = useState('');
  const [salvandoVisita, setSalvandoVisita] = useState(false);

  // ─── O porquê do cliente vermelho (controle de inatividade, 039) ───────────
  // Preenchem o rep dono da carteira, a Bruna e a gerência. Financeiro só lê.
  const podeExplicar =
    user?.role === 'rep' ||
    user?.role === 'manager' ||
    user?.role === 'admin' ||
    user?.role === 'relacionamento';
  const [motivo, setMotivo] = useState('');
  const [obsMotivo, setObsMotivo] = useState('');
  const [editandoMotivo, setEditandoMotivo] = useState(false);
  const [salvandoMotivo, setSalvandoMotivo] = useState(false);

  const salvarMotivo = async () => {
    if (!token || !id || salvandoMotivo) return;
    setSalvandoMotivo(true);
    try {
      await api.patch<ApiResponse<{ ok: boolean }>>(
        `/customers/${id}/inatividade`,
        { motivo: motivo.trim(), ...(obsMotivo.trim() ? { observacao: obsMotivo.trim() } : {}) },
        token,
      );
      setCliente((c) =>
        c
          ? {
              ...c,
              inactivity_reason: motivo.trim(),
              inactivity_note: obsMotivo.trim() || null,
              inactivity_updated_at: new Date().toISOString(),
            }
          : c,
      );
      setEditandoMotivo(false);
      setToast({ message: 'Motivo registrado.', type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível salvar o motivo.',
        type: 'error',
      });
    } finally {
      setSalvandoMotivo(false);
    }
  };

  useEffect(() => {
    if (cliente) {
      setTituloVisita(`Visitar ${cliente.trade_name || cliente.name}`);
      setMotivo(cliente.inactivity_reason ?? '');
      setObsMotivo(cliente.inactivity_note ?? '');
    }
  }, [cliente]);

  const marcarVisita = async () => {
    if (!token || !id || salvandoVisita) return;
    setSalvandoVisita(true);
    try {
      // Sem rep_id de propósito: o servidor entrega ao dono da carteira.
      await api.post<ApiResponse<unknown>>(
        '/tarefas',
        {
          customer_id: id,
          titulo: tituloVisita.trim(),
          ...(prazoVisita ? { prazo: new Date(prazoVisita).toISOString() } : {}),
          ...(localVisita.trim() ? { local: localVisita.trim() } : {}),
          ...(obsVisita.trim() ? { observacoes: obsVisita.trim() } : {}),
        },
        token,
      );
      setMarcando(false);
      setPrazoVisita('');
      setLocalVisita('');
      setObsVisita('');
      setToast({ message: 'Visita marcada — o representante recebe na Minha Área dele.', type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível marcar a visita.',
        type: 'error',
      });
    } finally {
      setSalvandoVisita(false);
    }
  };

  const carregar = useCallback(async () => {
    if (!token || !id) return;
    try {
      const res = await api.get<ApiResponse<CustomerDetail>>(`/customers/${id}`, token);
      setCliente(res.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir o cliente.');
    }
  }, [token, id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) {
    return (
      <div className="p-4 md:p-6">
        <Voltar />
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="space-y-3 p-4 md:p-6">
        <Voltar />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const tabela = nomeDe(cliente.price_table_id);
  // A cor do cliente (verde/amarelo/vermelho) — régua da migração 036.
  const situacao = situacaoDaCompra(cliente.last_purchase_at);

  return (
    <div className="p-4 md:p-6">
      <Voltar />

      {/* ─── Cadastro ─────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Building2 className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight text-foreground">{cliente.name}</h1>
            {cliente.trade_name && cliente.trade_name !== cliente.name && (
              <p className="text-sm text-muted-foreground">{cliente.trade_name}</p>
            )}
            {situacao.nivel !== 'sem_registro' && (
              <div className="mt-2">
                <Badge variant={VARIANTE_DO_FRESCOR[situacao.nivel]}>{situacao.rotulo}</Badge>
              </div>
            )}
            {cliente.blocked && (
              <div className="mt-2">
                <Badge variant="red">Bloqueado</Badge>
                {cliente.block_reason && (
                  <p className="mt-1 text-xs text-danger">{cliente.block_reason}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <Dado rotulo="CNPJ / CPF" valor={cliente.cnpj} />
          <Dado rotulo="Limite de crédito" valor={cliente.credit_limit != null ? formatBRL(cliente.credit_limit) : null} />
          <Dado
            rotulo="WhatsApp"
            valor={cliente.whatsapp}
            icone={MessageCircle}
            href={cliente.whatsapp ? `https://wa.me/${cliente.whatsapp.replace(/\D/g, '')}` : undefined}
          />
          <Dado rotulo="E-mail" valor={cliente.email} icone={Mail} />
          <div className="sm:col-span-2">
            <Dado rotulo="Endereço" valor={cliente.address} icone={MapPin} />
          </div>
        </dl>

        {!cliente.blocked && (
          <div className="mt-4 flex flex-wrap gap-2">
            {/* O relacionamento não vende — seleciona e encaminha. */}
            {user?.role !== 'relacionamento' && (
              <Button onClick={() => void navigate(`/orders/new?customer_id=${cliente.id}`)}>
                <ShoppingCart className="h-4 w-4" strokeWidth={2.5} />
                Novo pedido
              </Button>
            )}
            {/* O fluxo da Bruna: ligou pro cliente parado, combinou a visita,
                marca aqui — cai na Minha Área do representante dono da
                carteira, que dá o OK. Só o escritório vê este botão. */}
            {ehEscritorio && (
              <Button variant="outline" onClick={() => setMarcando((v) => !v)}>
                <CalendarClock className="h-4 w-4" strokeWidth={2.5} />
                {marcando ? 'Cancelar' : 'Marcar visita pro rep'}
              </Button>
            )}
          </div>
        )}

        {marcando && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void marcarVisita();
            }}
            className="mt-3 grid gap-3 rounded-lg bg-sunken p-3 sm:grid-cols-2"
          >
            <input
              value={tituloVisita}
              onChange={(e) => setTituloVisita(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              aria-label="O que o representante deve fazer"
            />
            <input
              type="datetime-local"
              value={prazoVisita}
              onChange={(e) => setPrazoVisita(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              aria-label="Data e horário combinados"
            />
            <input
              value={localVisita}
              onChange={(e) => setLocalVisita(e.target.value)}
              placeholder="Local — endereço, loja, ponto de encontro"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground sm:col-span-2"
              aria-label="Local da visita"
            />
            <textarea
              value={obsVisita}
              onChange={(e) => setObsVisita(e.target.value)}
              placeholder="Observações — o que você apurou na ligação, para o representante chegar preparado"
              rows={2}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground sm:col-span-2"
              aria-label="Observações sobre o cliente"
            />
            <p className="text-[11px] leading-tight text-subtle">
              Vai para a Minha Área do representante da carteira, que dá o OK no horário.
            </p>
            <div className="flex justify-end">
              <Button type="submit" disabled={salvandoVisita || tituloVisita.trim().length < 3}>
                {salvandoVisita ? 'Marcando…' : 'Marcar'}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* ─── O porquê do cliente vermelho (controle de inatividade) ────────
          Vermelho SEM motivo é pendência: o rep (ou a Bruna) registra por que
          o cliente está desativado e uma observação com as próprias palavras. */}
      {situacao.nivel === 'parado' && (
        <div className="mt-3 rounded-xl border border-danger/30 bg-danger-soft/40 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-danger-soft-foreground">
                Cliente desativado — {situacao.rotulo.replace('Desativado — ', '')}
              </p>
              {cliente.inactivity_reason ? (
                <>
                  <p className="mt-1.5 text-sm text-foreground">
                    <span className="text-muted-foreground">Motivo: </span>
                    {cliente.inactivity_reason}
                  </p>
                  {cliente.inactivity_note && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      “{cliente.inactivity_note}”
                    </p>
                  )}
                  {cliente.inactivity_updated_at && (
                    <p className="mt-1 text-[11px] text-subtle">
                      Registrado em {new Date(cliente.inactivity_updated_at).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-danger-soft-foreground">
                  Falta registrar o motivo de este cliente ter parado de comprar.
                </p>
              )}
            </div>
            {podeExplicar && !editandoMotivo && (
              <Button variant="outline" size="sm" onClick={() => setEditandoMotivo(true)}>
                {cliente.inactivity_reason ? 'Editar' : 'Preencher'}
              </Button>
            )}
          </div>

          {editandoMotivo && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void salvarMotivo();
              }}
              className="mt-3 grid gap-3"
            >
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo — fechou, trocou de fornecedor, sem retorno no contato…"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                aria-label="Motivo de o cliente estar desativado"
              />
              <textarea
                value={obsMotivo}
                onChange={(e) => setObsMotivo(e.target.value)}
                placeholder="Observação com as suas palavras — o que o cliente disse, o que ficou combinado"
                rows={3}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                aria-label="Observação sobre o cliente"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditandoMotivo(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={salvandoMotivo || motivo.trim().length < 2}>
                  {salvandoMotivo ? 'Salvando…' : 'Salvar motivo'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ─── Tabela de preço ──────────────────────────────────────────────── */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Tag className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Tabela de preço</p>
          {cliente.price_table_id ? (
            // Sem o nome quando a tabela é de fora do conjunto de quem olha: ver
            // a tabela da região vizinha é ver informação que não é dele.
            <p className="truncate text-sm font-medium text-foreground">{tabela ?? 'Outra tabela'}</p>
          ) : (
            <p className="truncate text-sm font-medium text-warn-soft-foreground">
              Sem tabela cadastrada
            </p>
          )}
        </div>
        {/* O financeiro não troca tabela de cliente — cadastro é leitura pra ele. */}
        {tabelas.length >= 2 && user?.role !== 'financeiro' && (
          <Button variant="outline" size="sm" onClick={() => setTrocando(true)}>
            Trocar
          </Button>
        )}
      </div>

      {/* ─── Histórico ────────────────────────────────────────────────────── */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">
        Pedidos
        {cliente.pedidos.length > 0 && (
          <span className="ml-1.5 font-normal text-muted-foreground">({cliente.pedidos.length})</span>
        )}
      </h2>

      {cliente.pedidos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <Receipt className="h-6 w-6 text-subtle" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">Esta loja ainda não fez nenhum pedido.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {cliente.pedidos.map((p) => (
            <li key={p.id} className="border-b border-border last:border-b-0">
              <Link
                to={`/orders/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="tnum text-sm font-medium text-foreground">
                      {p.order_number ? `#${p.order_number}` : 'Rascunho'}
                    </span>
                    <Badge variant={seloDoPedido(p, user?.role).variante}>
                      {seloDoPedido(p, user?.role).texto}
                    </Badge>
                  </div>
                  <p className="tnum mt-0.5 text-xs text-subtle">
                    {new Date(p.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <span className="tnum shrink-0 text-sm font-semibold text-foreground">
                  {formatBRL(p.total)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {trocando && (
        <TrocarTabelaDoCliente
          cliente={{
            id: cliente.id,
            name: cliente.name,
            trade_name: cliente.trade_name,
            cnpj: cliente.cnpj,
            blocked: cliente.blocked,
            block_reason: cliente.block_reason,
            credit_limit: cliente.credit_limit,
            whatsapp: cliente.whatsapp,
            price_table_id: cliente.price_table_id,
            // A ficha não carrega o código do ERP e a troca de tabela não o usa.
            erp_id: null,
          }}
          tabelas={tabelas}
          nomeDe={nomeDe}
          onTrocado={(c) => {
            setCliente({ ...cliente, price_table_id: c.price_table_id });
            setToast({
              message: `Agora compra na ${nomeDe(c.price_table_id) ?? 'tabela escolhida'}.`,
              type: 'success',
            });
          }}
          onErro={(m) => setToast({ message: m, type: 'error' })}
          onFechar={() => setTrocando(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

function Voltar() {
  return (
    <Link
      to="/customers"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Clientes
    </Link>
  );
}

function Dado({
  rotulo,
  valor,
  icone: Icone,
  href,
}: {
  rotulo: string;
  valor: string | null;
  icone?: typeof MessageCircle;
  href?: string | undefined;
}) {
  if (!valor) return null;
  const conteudo = (
    <span className="flex items-center gap-1.5 text-sm text-foreground">
      {Icone && <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />}
      {valor}
    </span>
  );
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {conteudo}
          </a>
        ) : (
          conteudo
        )}
      </dd>
    </div>
  );
}
