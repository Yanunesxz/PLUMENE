import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link2, Ban, Clock, Store, Eye, Tag } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { SearchSelect } from '../../components/interface/SearchSelect.js';
import { Toast } from '../../components/interface/Toast.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { LinkGerado } from './LinkGerado.js';
import { useMinhasTabelas } from '../../hooks/useMinhasTabelas.js';
import { ConfirmarTabela } from '../../components/comercial/ConfirmarTabela.js';
import { cn } from '../../lib/utils.js';
import { SHOWCASE_DURATIONS } from '@csb/shared';
import type {
  ApiResponse,
  CustomerListItem,
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
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { nomeDe } = useMinhasTabelas();
  const [aba, setAba] = useState<Aba>('convites');
  const [confirmandoConvite, setConfirmandoConvite] = useState(false);
  const [convites, setConvites] = useState<StoreInvite[] | null>(null);
  const [vitrines, setVitrines] = useState<ShowcaseLink[] | null>(null);
  const [clienteId, setClienteId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [gerado, setGerado] = useState<Gerado | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const clientes = useLiveQuery(() => db.customers.orderBy('name').toArray(), []);
  const escolhido = clientes?.find((c) => c.id === clienteId);
  const nomeDaLoja = escolhido?.trade_name?.trim() || escolhido?.name || 'Esta loja';

  // Voltando do cadastro ("Sem cliente criado"): o cliente recém-criado chega
  // na URL e já entra selecionado, na aba do link temporário.
  useEffect(() => {
    const clienteNovo = params.get('cliente');
    if (params.get('aba') === 'vitrine') setAba('vitrine');
    if (clienteNovo) setClienteId(clienteNovo);
    // roda uma vez, na chegada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O cache pode ser anterior ao dia em que `price_table_id` passou a vir na
  // lista. Sem esta releitura, a faixa acima diria "sem tabela cadastrada" para
  // cliente que tem — e a confirmação mentiria junto.
  useEffect(() => {
    if (!token) return;
    api
      .getLista<ApiResponse<CustomerListItem[]>>('/customers', token)
      .then((res) => db.customers.bulkPut(res.data))
      .catch(() => {
        /* offline: vale o cache */
      });
  }, [token]);

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
   * A conta de loja herda a tabela do CADASTRO do cliente — a loja vai comprar
   * por ela todo mês, sozinha, sem ninguém conferindo. Então o representante vê
   * qual é antes de gerar, e confirma nomeando-a.
   */
  const pedirConvite = () => {
    if (!clienteId) return;
    setConfirmandoConvite(true);
  };

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
      setConfirmandoConvite(false);
      await recarregar();
    } catch (e) {
      setConfirmandoConvite(false);
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível gerar o convite', type: 'error' });
    } finally {
      setOcupado(false);
    }
  };

  /**
   * O link nasce amarrado a um cliente ("mesmo temporário tem que ter algum
   * cliente atrelado"). A tabela deixou de ser escolha: é a do CADASTRO do
   * cliente, como na conta de loja — a faixa informativa mostra qual antes de
   * gerar.
   */
  const gerarVitrine = async (horas: ShowcaseDuration) => {
    if (!token || !clienteId) return;
    setOcupado(true);
    try {
      const res = await api.post<ApiResponse<LinkCriado>>(
        '/showcase-links',
        { hours: horas, customer_id: clienteId },
        token,
      );
      const cliente = clientes?.find((c) => c.id === clienteId);
      setGerado({
        url: res.data.url,
        expiraEm: res.data.expires_at,
        tipo: 'vitrine',
        horas,
        cliente: cliente?.trade_name?.trim() || cliente?.name,
        whatsapp: cliente?.whatsapp ?? undefined,
      });
      await recarregar();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não foi possível gerar o link', type: 'error' });
    } finally {
      setOcupado(false);
    }
  };

  /** A opção "Sem cliente criado" leva ao cadastro e volta com ele escolhido. */
  const escolherClienteDoLink = (id: string) => {
    if (id === '__novo__') {
      void navigate('/customers?novo=1&voltar=vitrine');
      return;
    }
    setClienteId(id);
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
              <Button disabled={!clienteId || ocupado} onClick={pedirConvite}>
                <Link2 className="h-4 w-4" strokeWidth={2.5} />
                Gerar convite
              </Button>
            </div>

            {/* Qual tabela a conta vai herdar, antes de gerar. Sem isto o
                representante criava a conta às cegas e só descobria o preço
                errado quando a loja já tinha comprado por ele. */}
            {escolhido && (
              <div
                className={cn(
                  'mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                  escolhido.price_table_id
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-warn-soft text-warn-soft-foreground',
                )}
              >
                <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {escolhido.price_table_id ? (
                  <span>
                    Vai comprar na{' '}
                    <strong className="font-semibold">
                      {/* Tabela fora do conjunto de quem olha não tem o nome revelado. */}
                      {nomeDe(escolhido.price_table_id) ?? 'outra tabela'}
                    </strong>
                  </span>
                ) : (
                  <span>
                    <strong className="font-semibold">Sem tabela cadastrada</strong> — vai comprar
                    pela sua tabela principal
                  </span>
                )}
              </div>
            )}
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
              Sem conta e sem senha: o cliente vê os preços <strong>da tabela dele</strong> e o link
              para de funcionar sozinho. Vale por <strong>um pedido</strong> — assim que ele envia,
              o link se encerra e o pedido cai para você já no cadastro certo.
            </p>

            {/* O link nasce amarrado: primeiro o cliente, depois a validade.
                Quem ainda não é cliente se cadastra por aqui mesmo. */}
            <div className="mb-3">
              <SearchSelect
                value={clienteId}
                onSelect={escolherClienteDoLink}
                placeholder="Escolha o cliente do link"
                searchPlaceholder="Buscar por nome ou CNPJ…"
                emptyText="Nenhum cliente na sua carteira"
                options={[
                  {
                    value: '__novo__',
                    label: '+ Sem cliente criado — cadastrar agora',
                  },
                  ...(clientes ?? []).map((c) => ({
                    value: c.id,
                    label: c.name,
                    sublabel: c.cnpj ? `CNPJ ${c.cnpj}` : undefined,
                  })),
                ]}
              />
            </div>

            {escolhido && (
              <div
                className={cn(
                  'mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                  escolhido.price_table_id
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-warn-soft text-warn-soft-foreground',
                )}
              >
                <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {escolhido.price_table_id ? (
                  <span>
                    O link abre com a{' '}
                    <strong className="font-semibold">
                      {nomeDe(escolhido.price_table_id) ?? 'tabela do cadastro'}
                    </strong>
                  </span>
                ) : (
                  <span>
                    <strong className="font-semibold">Sem tabela cadastrada</strong> — o link abre
                    pela sua tabela principal
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              {SHOWCASE_DURATIONS.map((h) => (
                <Button
                  key={h}
                  variant="outline"
                  disabled={ocupado || !clienteId}
                  onClick={() => void gerarVitrine(h)}
                >
                  {h}h
                </Button>
              ))}
            </div>
            {!clienteId && (
              <p className="mt-2 text-[11px] text-subtle">
                Escolha o cliente para liberar a validade do link.
              </p>
            )}
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
                    <p className="truncate text-sm font-medium text-foreground">
                      {(() => {
                        const dono = clientes?.find((c) => c.id === v.customer_id);
                        const nome = dono ? dono.trade_name?.trim() || dono.name : null;
                        return nome ? `${nome} · ${ROTULO_STATUS[v.status]}` : ROTULO_STATUS[v.status];
                      })()}
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

      {confirmandoConvite && escolhido && (
        <ConfirmarTabela
          titulo={
            escolhido.price_table_id
              ? `${nomeDaLoja} está cadastrada na ${nomeDe(escolhido.price_table_id) ?? 'outra tabela'}.`
              : `${nomeDaLoja} está sem tabela cadastrada.`
          }
          detalhe={
            escolhido.price_table_id
              ? 'A conta dela vai comprar por essa tabela, sozinha, sem passar por você. Tem certeza?'
              : 'A conta dela vai comprar pela sua tabela principal. Se esta loja deveria ter tabela própria, cadastre antes de criar a conta.'
          }
          tabela={nomeDe(escolhido.price_table_id) ?? ''}
          {...(escolhido.price_table_id ? {} : { rotuloConfirmar: 'Criar assim mesmo' })}
          ocupado={ocupado}
          onConfirmar={() => void gerarConvite()}
          onCancelar={() => setConfirmandoConvite(false)}
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
