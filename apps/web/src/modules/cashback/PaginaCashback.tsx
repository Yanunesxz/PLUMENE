import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, RefreshCw, Search, Wallet } from 'lucide-react';
import { CASHBACK_AVISO_DIAS, veAreaDeCashback, type ApiResponse } from '@csb/shared';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { Badge } from '../../components/interface/Badge.js';
import { Input } from '../../components/interface/Input.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { EmptyState } from '../../components/interface/EmptyState.js';
import { formatBRL } from '../../lib/utils.js';
import { ExtratoDoCashback } from './ExtratoDoCashback.js';
import {
  dataCurta,
  faltaMigracao,
  nomeDoCliente,
  prazoPorExtenso,
  type ExtratoDoCliente,
  type LinhaDaListaDeCashback,
  type ListaDeCashback,
} from './cashback.js';

/**
 * A área CASHBACK (migração 058; Yan, 12/11/2026). Tela própria, de propósito
 * separada das outras: nada daqui muda a montagem do pedido, o desconto ou a
 * planilha do Control.
 *
 * O cliente da venda interna ganha 3% do valor faturado de cada pedido; cada
 * crédito vale 90 dias a partir do faturamento. O vendedor interno vê aqui
 * quem tem saldo e o que está para vencer, e usa no PEDIDO (cartão "Cashback
 * do cliente"), que escreve "Utilizado R$ X do cashback" na observação.
 */
export function PaginaCashback() {
  const { token, user } = useAuthStore();
  const [lista, setLista] = useState<ListaDeCashback | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');
  const [soComSaldo, setSoComSaldo] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

  const permitido = veAreaDeCashback(user?.role, user?.venda_interna === true);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await api.get<ApiResponse<ListaDeCashback>>('/cashback/clientes', token);
      setLista(r.data);
    } catch (e) {
      setErro(
        faltaMigracao(e)
          ? 'A área de cashback fica pronta assim que a migração 058 rodar no banco.'
          : e instanceof Error
            ? e.message
            : 'Não deu para carregar o cashback.',
      );
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    if (permitido) void carregar();
  }, [carregar, permitido]);

  const resumo = useMemo(() => {
    const clientes = lista?.clientes ?? [];
    return {
      saldo: clientes.reduce((s, c) => s + c.saldo, 0),
      vencendo: clientes.reduce((s, c) => s + c.vencendo_logo, 0),
      comSaldo: clientes.filter((c) => c.saldo > 0).length,
    };
  }, [lista]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (lista?.clientes ?? []).filter((c) => {
      if (soComSaldo && c.saldo <= 0) return false;
      if (!termo) return true;
      return [c.nome, c.fantasia ?? '', c.erp_id ?? ''].some((t) => t.toLowerCase().includes(termo));
    });
  }, [lista, busca, soComSaldo]);

  if (!permitido) return <Navigate to="/unauthorized" replace />;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Cashback</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            3% do valor faturado nos pedidos da venda interna. Cada crédito vale 90 dias a partir do faturamento.
          </p>
        </div>
        <Button variant="outline" size="md" disabled={carregando} onClick={() => void carregar()} aria-label="Atualizar">
          <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} strokeWidth={2.5} />
          <span className="hidden sm:inline">Atualizar</span>
        </Button>
      </div>

      {erro && <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>}

      {!lista && !erro && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {lista && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Resumo titulo="Saldo dos clientes" valor={formatBRL(resumo.saldo)} />
            <Resumo
              titulo={`Vence em até ${CASHBACK_AVISO_DIAS} dias`}
              valor={formatBRL(resumo.vencendo)}
              alerta={resumo.vencendo > 0}
            />
            <Resumo titulo="Clientes com saldo" valor={String(resumo.comSaldo)} />
          </div>

          <div className="mb-3 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground shadow-sm">
            <p className="font-medium text-foreground">Como usar</p>
            <p>
              Abra o pedido do cliente e toque em <strong className="text-foreground">Usar cashback</strong>. O valor
              vai na observação do pedido como “Utilizado R$ X do cashback” e o financeiro abate. Avise o cliente do
              vencimento: o que não for usado em 90 dias se perde.
            </p>
          </div>

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente ou código"
                className="pl-9"
                aria-label="Buscar cliente"
              />
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant={soComSaldo ? 'primary' : 'outline'} onClick={() => setSoComSaldo(true)}>
                Com saldo
              </Button>
              <Button size="sm" variant={soComSaldo ? 'outline' : 'primary'} onClick={() => setSoComSaldo(false)}>
                Todos
              </Button>
            </div>
          </div>

          {visiveis.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title={lista.clientes.length === 0 ? 'Nenhum cashback ainda' : 'Nenhum cliente encontrado'}
              description={
                lista.clientes.length === 0
                  ? `O cashback nasce quando um pedido da venda interna é faturado${
                      lista.programa.inicio ? ` (a partir de ${dataCurta(lista.programa.inicio)})` : ''
                    }.`
                  : 'Tente outro nome, ou veja todos os clientes.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {visiveis.map((c) => (
                <LinhaDoCliente
                  key={c.customer_id}
                  linha={c}
                  aberto={aberto === c.customer_id}
                  onAlternar={() => setAberto((a) => (a === c.customer_id ? null : c.customer_id))}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Resumo({ titulo, valor, alerta = false }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${alerta ? 'border-warn bg-warn-soft' : 'border-border bg-card'}`}>
      <p className={`text-xs ${alerta ? 'text-warn-soft-foreground' : 'text-muted-foreground'}`}>{titulo}</p>
      <p className={`text-xl font-bold ${alerta ? 'text-warn-soft-foreground' : 'text-foreground'}`}>{valor}</p>
    </div>
  );
}

function LinhaDoCliente({
  linha,
  aberto,
  onAlternar,
}: {
  linha: LinhaDaListaDeCashback;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const { token } = useAuthStore();
  const [extrato, setExtrato] = useState<ExtratoDoCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || !token) return;
    let vivo = true;
    setErro(null);
    api
      .get<ApiResponse<ExtratoDoCliente>>(`/cashback/clientes/${linha.customer_id}`, token)
      .then((r) => {
        if (vivo) setExtrato(r.data);
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : 'Não deu para abrir o extrato.');
      });
    return () => {
      vivo = false;
    };
  }, [aberto, token, linha.customer_id]);

  const proximo = linha.proximo_vencimento;
  const urgente = proximo != null && proximo.dias <= CASHBACK_AVISO_DIAS;

  return (
    <li className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-start justify-between gap-3 p-3 text-left"
        aria-expanded={aberto}
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{nomeDoCliente(linha)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {linha.erp_id ? `Cód. ${linha.erp_id} · ` : ''}
            ganhou {formatBRL(linha.total_ganho)} · usou {formatBRL(linha.total_usado)}
            {linha.total_vencido > 0 ? ` · venceu ${formatBRL(linha.total_vencido)}` : ''}
          </p>
          {proximo && (
            <Badge variant={urgente ? 'yellow' : 'gray'} className="mt-1">
              {formatBRL(proximo.valor)} {prazoPorExtenso(proximo.dias)} ({dataCurta(proximo.vence_em)})
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Saldo</p>
            <p className={`text-lg font-bold ${linha.saldo > 0 ? 'text-foreground' : 'text-subtle'}`}>
              {formatBRL(linha.saldo)}
            </p>
          </div>
          {aberto ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-border p-3">
          {erro && <p className="text-sm text-danger-soft-foreground">{erro}</p>}
          {!extrato && !erro && <Skeleton className="h-24 w-full" />}
          {extrato && <ExtratoDoCashback extrato={extrato.extrato} />}
          <Link
            to={`/customers/${linha.customer_id}`}
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            Abrir o cliente
          </Link>
        </div>
      )}
    </li>
  );
}
