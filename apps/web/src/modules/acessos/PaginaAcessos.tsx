import { useEffect, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link2, Ban, Clock, Store, Eye } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { SearchSelect } from '../../components/interface/SearchSelect.js';
import { Toast } from '../../components/interface/Toast.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { LinkGerado } from './LinkGerado.js';
import { useMinhasTabelas } from '../../hooks/useMinhasTabelas.js';
import { SeletorDeTabela } from '../../components/comercial/SeletorDeTabela.js';
import { ConfirmarTabela } from '../../components/comercial/ConfirmarTabela.js';
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
  pendente: 'Aguardando a loja abrir',
  usado: 'Em uso',
  expirado: 'Expirado',
  revogado: 'Cancelado',
  ativo: 'Ativo',
};

interface Gerado {
  url: string;
  expiraEm: string;
  tipo: 'convite' | 'vitrine';
  cliente?: string | undefined;
  whatsapp?: string | undefined;
  horas?: number | undefined;
}

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
  const { tabelas, precisaEscolher, nomeDe } = useMinhasTabelas();
  const [aba, setAba] = useState<Aba>('convites');
  const [tabelaEscolhida, setTabelaEscolhida] = useState('');
  const [confirmando, setConfirmando] = useState<ShowcaseDuration | null>(null);
  const [convites, setConvites] = useState<StoreInvite[] | null>(null);
  const [vitrines, setVitrines] = useState<ShowcaseLink[] | null>(null);
  const [clienteId, setClienteId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [gerado, setGerado] = useState<Gerado | null>(null);
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

  const gerarConvite = async () => {
    if (!token || !clienteId) return;
    setOcupado(true);
    try {
      const res = await api.post<ApiResponse<LinkCriado>>('/invites', { customer_id: clienteId }, token);
      const cliente = clientes?.find((c) => c.id === clienteId);
      setGerado({
        url: res.data.url,
        expiraEm: res.data.expires_at,
        tipo: 'convite',
        // Nome fantasia primeiro: a razão social do ERP vem com o CNPJ na frente.
        cliente: cliente?.trade_name?.trim() || cliente?.name,
        whatsapp: cliente?.whatsapp ?? undefined,
      });
      setClienteId('');
      await recarregar();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível gerar o convite', type: 'error' });
    } finally {
      setOcupado(false);
    }
  };

  /**
   * Quem tem duas tabelas ou mais confirma antes: o link mostra preço a alguém
   * de fora, e não há uma segunda pessoa para reparar no erro.
   */
  const pedirVitrine = (horas: ShowcaseDuration) => {
    if (precisaEscolher) {
      setConfirmando(horas);
      return;
    }
    void gerarVitrine(horas);
  };

  const gerarVitrine = async (horas: ShowcaseDuration) => {
    if (!token) return;
    setOcupado(true);
    try {
      const res = await api.post<ApiResponse<LinkCriado>>(
        '/showcase-links',
        { hours: horas, ...(tabelaEscolhida ? { price_table_id: tabelaEscolhida } : {}) },
        token,
      );
      setGerado({ url: res.data.url, expiraEm: res.data.expires_at, tipo: 'vitrine', horas });
      setConfirmando(null);
      await recarregar();
    } catch (e) {
      setConfirmando(null);
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível gerar o link', type: 'error' });
    } finally {
      setOcupado(false);
    }
  };

  const revogar = async (tipo: Aba, id: string) => {
    if (!token) return;
    try {
      await api.del(tipo === 'convites' ? `/invites/${id}` : `/showcase-links/${id}`, token);
      await recarregar();
      setToast({ message: 'Acesso cancelado.', type: 'success' });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível cancelar', type: 'error' });
    }
  };

  const trocarAba = (a: Aba) => {
    setAba(a);
    setGerado(null);
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="titulo mb-1 text-[26px] leading-none text-foreground md:text-[32px]">Acessos</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Deixe a loja montar o pedido sozinha. Você continua aprovando tudo.
      </p>

      <div className="mb-5 flex gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ['convites', 'Conta de loja'],
            ['vitrine', 'Link temporário'],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => trocarAba(valor)}
            className={cn(
              'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              aba === valor
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {gerado && (
        <LinkGerado
          url={gerado.url}
          expiraEm={gerado.expiraEm}
          tipo={gerado.tipo}
          cliente={gerado.cliente}
          whatsapp={gerado.whatsapp}
          horas={gerado.horas}
          onFechar={() => setGerado(null)}
        />
      )}

      {aba === 'convites' ? (
        <>
          <div className="mb-5 rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">Criar conta para uma loja</p>
            <p className="mb-3 mt-1 text-xs leading-relaxed text-muted-foreground">
              A loja cria a própria senha e passa a comprar quando quiser, com os preços da tabela
              dela. Serve para cliente de confiança — o link vale uma vez só.
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
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : convites.length === 0 ? (
            <Vazio icone={Store} texto="Nenhuma loja com acesso ainda." />
          ) : (
            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {convites.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{c.customer_name}</p>
                    <p className="text-xs text-subtle">
                      {ROTULO_STATUS[c.status]}
                      {c.status === 'pendente' && faltam(c.expires_at) && ` · ${faltam(c.expires_at)}`}
                    </p>
                  </div>
                  {c.status === 'pendente' && (
                    <button
                      type="button"
                      onClick={() => void revogar('convites', c.id)}
                      aria-label={`Cancelar convite de ${c.customer_name}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-danger-soft hover:text-danger-soft-foreground"
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
            <p className="text-sm font-medium text-foreground">Mostrar o catálogo por um tempo</p>
            <p className="mb-3 mt-1 text-xs leading-relaxed text-muted-foreground">
              Para quem só quer dar uma olhada. Sem conta e sem senha: mostra os seus preços e para
              de funcionar sozinho. Vale por <strong>um pedido</strong> — assim que a pessoa envia, o
              link se encerra e o pedido cai para você com o contato dela.
            </p>
            <div className="mb-3">
              <SeletorDeTabela
                tabelas={tabelas}
                valor={tabelaEscolhida}
                onEscolher={setTabelaEscolhida}
                contexto="link"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {SHOWCASE_DURATIONS.map((h) => (
                <Button
                  key={h}
                  variant="outline"
                  disabled={ocupado || (precisaEscolher && !tabelaEscolhida)}
                  onClick={() => pedirVitrine(h)}
                >
                  {h}h
                </Button>
              ))}
            </div>
          </div>

          {vitrines === null ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : vitrines.length === 0 ? (
            <Vazio icone={Clock} texto="Nenhum link gerado ainda." />
          ) : (
            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {vitrines.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {ROTULO_STATUS[v.status]}
                      {v.status === 'ativo' && faltam(v.expires_at) && ` · ${faltam(v.expires_at)}`}
                    </p>
                    <p className="tnum flex items-center gap-1 text-xs text-subtle">
                      <Eye className="h-3 w-3" strokeWidth={2} />
                      {v.opened_count === 0
                        ? 'ainda não foi aberto'
                        : `${v.opened_count} ${v.opened_count === 1 ? 'abertura' : 'aberturas'}`}
                    </p>
                  </div>
                  {v.status === 'ativo' && (
                    <button
                      type="button"
                      onClick={() => void revogar('vitrine', v.id)}
                      aria-label="Encerrar link agora"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-danger-soft hover:text-danger-soft-foreground"
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

      {confirmando !== null && (
        <ConfirmarTabela
          titulo={`Gerar link de ${confirmando}h com a ${nomeDe(tabelaEscolhida) ?? ''}?`}
          detalhe="Quem abrir o link vê os preços desta tabela. Ela fica congelada: mesmo que suas tabelas mudem depois, o link continua com esta."
          tabela={nomeDe(tabelaEscolhida) ?? ''}
          ocupado={ocupado}
          onConfirmar={() => void gerarVitrine(confirmando)}
          onCancelar={() => setConfirmando(null)}
        />
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
