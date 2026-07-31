import { useEffect, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link2, Check, Ban, Clock, Store } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { SearchSelect } from '../../components/interface/SearchSelect.js';
import { Toast } from '../../components/interface/Toast.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { cn } from '../../lib/utils.js';
import { SHOWCASE_DURATIONS } from '@csb/shared';
import type {
  ApiResponse,
  LinkCriado,
  ShowcaseDuration,
  ShowcaseLink,
  StoreInvite,
} from '@csb/shared';

type Aba = 'convites' | 'vitrine';

const ROTULO_STATUS: Record<string, string> = {
  pendente: 'Aguardando',
  usado: 'Em uso',
  expirado: 'Expirado',
  revogado: 'Cancelado',
  ativo: 'Ativo',
};

/** Quanto falta, em texto curto. Vazio quando já passou. */
function faltam(ate: string): string {
  const ms = new Date(ate).getTime() - Date.now();
  if (ms <= 0) return '';
  const dias = Math.floor(ms / 86400_000);
  if (dias >= 1) return `${dias}d`;
  const horas = Math.floor(ms / 3600_000);
  if (horas >= 1) return `${horas}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}min`;
}

export function PaginaAcessos() {
  const { token } = useAuthStore();
  const [aba, setAba] = useState<Aba>('convites');
  const [convites, setConvites] = useState<StoreInvite[] | null>(null);
  const [vitrines, setVitrines] = useState<ShowcaseLink[] | null>(null);
  const [clienteId, setClienteId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const clientes = useLiveQuery(() => db.customers.orderBy('name').toArray(), []);

  const recarregar = useCallback(async () => {
    if (!token) return;
    const [c, v] = await Promise.all([
      api.get<ApiResponse<StoreInvite[]>>('/invites', token).catch(() => ({ data: [] })),
      api.get<ApiResponse<ShowcaseLink[]>>('/showcase-links', token).catch(() => ({ data: [] })),
    ]);
    setConvites(c.data);
    setVitrines(v.data);
  }, [token]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  /**
   * O link só existe UMA vez: a API devolve a URL na criação e nunca mais.
   * Por isso ele vai direto para a área de transferência aqui — se o
   * representante perder, tem que gerar outro.
   */
  const copiar = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2500);
      setToast({ message: 'Link copiado. Cole no WhatsApp da loja.', type: 'success' });
    } catch {
      setToast({ message: `Copie o link: ${url}`, type: 'success' });
    }
  };

  const gerarConvite = async () => {
    if (!token || !clienteId) return;
    setOcupado(true);
    try {
      const res = await api.post<ApiResponse<LinkCriado>>('/invites', { customer_id: clienteId }, token);
      await copiar(res.data.url, res.data.id);
      setClienteId('');
      await recarregar();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível gerar o convite', type: 'error' });
    } finally {
      setOcupado(false);
    }
  };

  const gerarVitrine = async (hours: ShowcaseDuration) => {
    if (!token) return;
    setOcupado(true);
    try {
      const res = await api.post<ApiResponse<LinkCriado>>('/showcase-links', { hours }, token);
      await copiar(res.data.url, res.data.id);
      await recarregar();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível gerar o link', type: 'error' });
    } finally {
      setOcupado(false);
    }
  };

  const revogar = async (tipo: Aba, id: string) => {
    if (!token) return;
    const rota = tipo === 'convites' ? `/invites/${id}` : `/showcase-links/${id}`;
    try {
      await api.del(rota, token);
      await recarregar();
      setToast({ message: 'Acesso cancelado.', type: 'success' });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível cancelar', type: 'error' });
    }
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="titulo mb-1 text-[26px] leading-none text-foreground md:text-[32px]">Acessos</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Dê acesso ao catálogo sem depender de você estar disponível.
      </p>

      <div className="mb-5 flex gap-2">
        {(['convites', 'vitrine'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={cn(
              'rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
              aba === a ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {a === 'convites' ? 'Conta de loja' : 'Link temporário'}
          </button>
        ))}
      </div>

      {aba === 'convites' ? (
        <>
          <div className="mb-5 rounded-xl border border-border bg-card p-4">
            <p className="mb-1 text-sm font-medium text-foreground">Criar conta para uma loja</p>
            <p className="mb-3 text-xs text-muted-foreground">
              A loja recebe o link, cria a própria senha e passa a comprar quando quiser. Os pedidos
              continuam caindo aqui para você aprovar.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <SearchSelect
                  value={clienteId}
                  onSelect={setClienteId}
                  placeholder="Escolha o cliente"
                  searchPlaceholder="Buscar por nome ou CNPJ…"
                  emptyText="Nenhum cliente na sua carteira"
                  options={(clientes ?? []).map((c) => ({
                    value: c.id,
                    label: c.name,
                    sublabel: c.cnpj ? `CNPJ ${c.cnpj}` : undefined,
                  }))}
                />
              </div>
              <Button disabled={!clienteId || ocupado} onClick={() => void gerarConvite()}>
                <Link2 className="h-4 w-4" strokeWidth={2.5} />
                Gerar convite
              </Button>
            </div>
          </div>

          {convites === null ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : convites.length === 0 ? (
            <Vazio icone={Store} texto="Nenhuma loja com acesso ainda." />
          ) : (
            <ul className="space-y-2">
              {convites.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{c.customer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROTULO_STATUS[c.status]}
                      {c.status === 'pendente' && faltam(c.expires_at) && ` · expira em ${faltam(c.expires_at)}`}
                    </p>
                  </div>
                  {c.status === 'pendente' && (
                    <button
                      type="button"
                      onClick={() => void revogar('convites', c.id)}
                      aria-label="Cancelar convite"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger-soft-foreground"
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="mb-5 rounded-xl border border-border bg-card p-4">
            <p className="mb-1 text-sm font-medium text-foreground">Mostrar o catálogo por um tempo</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Para quem só quer dar uma olhada. Sem conta, sem senha: o link mostra o catálogo com os
              seus preços e para de funcionar sozinho.
            </p>
            <div className="flex flex-wrap gap-2">
              {SHOWCASE_DURATIONS.map((h) => (
                <Button
                  key={h}
                  variant="outline"
                  disabled={ocupado}
                  onClick={() => void gerarVitrine(h)}
                >
                  <Clock className="h-4 w-4" strokeWidth={2.5} />
                  {h}h
                </Button>
              ))}
            </div>
          </div>

          {vitrines === null ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : vitrines.length === 0 ? (
            <Vazio icone={Clock} texto="Nenhum link gerado ainda." />
          ) : (
            <ul className="space-y-2">
              {vitrines.map((v) => (
                <li key={v.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {ROTULO_STATUS[v.status]}
                      {v.status === 'ativo' && faltam(v.expires_at) && ` · ${faltam(v.expires_at)} restantes`}
                    </p>
                    <p className="tnum text-xs text-muted-foreground">
                      {v.opened_count === 0
                        ? 'Ainda não foi aberto'
                        : `Aberto ${v.opened_count} ${v.opened_count === 1 ? 'vez' : 'vezes'}`}
                    </p>
                  </div>
                  {v.status === 'ativo' && (
                    <button
                      type="button"
                      onClick={() => void revogar('vitrine', v.id)}
                      aria-label="Encerrar link"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger-soft-foreground"
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {copiado && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-positive-soft-foreground">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          Link copiado — ele não aparece de novo, cole agora.
        </p>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

function Vazio({ icone: Icone, texto }: { icone: typeof Store; texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
      <Icone className="h-6 w-6 text-subtle" strokeWidth={1.5} />
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}
