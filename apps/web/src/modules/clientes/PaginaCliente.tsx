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
          <div className="mt-4">
            <Button onClick={() => void navigate(`/orders/new?customer_id=${cliente.id}`)}>
              <ShoppingCart className="h-4 w-4" strokeWidth={2.5} />
              Novo pedido
            </Button>
          </div>
        )}
      </div>

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
        {tabelas.length >= 2 && (
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
