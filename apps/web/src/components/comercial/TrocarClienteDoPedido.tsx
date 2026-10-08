import { useMemo, useState } from 'react';
import { Search, UserRoundPen } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import type { CustomerListItem } from '@csb/shared';

interface Props {
  numero: number | null | undefined;
  /** O cliente em que o pedido está hoje — sai da lista. */
  clienteAtualId: string | null | undefined;
  /** A carteira em cache: a do rep para ele, a empresa toda para o escritório. */
  clientes: readonly CustomerListItem[];
  /** A tabela com que o pedido foi feito — para avisar se o novo é de outra. */
  tabelaDoPedido: string | null | undefined;
  /** O pedido já está no Control (lançado ou pedido ao Control). */
  jaNoControl: boolean;
  ocupado?: boolean;
  erro?: string | null;
  onConfirmar: (customer_id: string) => void;
  onFechar: () => void;
}

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Trocar o cliente do pedido — o representante escolheu a loja errada
 * (Yan, 08/10/2026). Não muda o cadastro de ninguém: o pedido passa a apontar
 * para outro cliente. Regra de quem pode em `podeTrocarClienteDoPedido`.
 */
export function TrocarClienteDoPedido({
  numero,
  clienteAtualId,
  clientes,
  tabelaDoPedido,
  jaNoControl,
  ocupado,
  erro,
  onConfirmar,
  onFechar,
}: Props) {
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<CustomerListItem | null>(null);

  const achados = useMemo(() => {
    const q = semAcento(busca.trim());
    const digitos = busca.replace(/\D/g, '');
    if (q.length < 2) return [];
    return clientes
      .filter((c) => c.id !== clienteAtualId)
      .filter((c) => {
        const nomes = semAcento(`${c.name} ${c.trade_name ?? ''}`);
        if (nomes.includes(q)) return true;
        if (digitos.length >= 3 && (c.cnpj ?? '').replace(/\D/g, '').includes(digitos)) return true;
        return !!c.erp_id && String(c.erp_id).includes(busca.trim());
      })
      .slice(0, 40);
  }, [busca, clientes, clienteAtualId]);

  const outraTabela =
    !!escolhido?.price_table_id && !!tabelaDoPedido && escolhido.price_table_id !== tabelaDoPedido;
  const titulo = numero ? `Trocar o cliente do pedido #${numero}` : 'Trocar o cliente do pedido';

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-foreground/40" onClick={onFechar} aria-hidden />
      <div className="animate-slide-up relative flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <UserRoundPen className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha o cliente certo. O cadastro dos clientes não muda — só para quem o pedido vai, e todo mundo
              passa a ver o pedido no cliente novo.
            </p>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setEscolhido(null);
            }}
            placeholder="Nome, fantasia, CNPJ ou código"
            className="w-full bg-transparent text-sm text-foreground outline-none"
            aria-label="Buscar cliente"
          />
        </label>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {busca.trim().length < 2 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">Digite pelo menos 2 letras.</p>
          ) : achados.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
          ) : (
            <ul className="grid gap-1">
              {achados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setEscolhido(c)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      escolhido?.id === c.id ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <span className="block truncate font-medium text-foreground">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.trade_name, c.cnpj, c.erp_id ? `cód. ${c.erp_id}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(outraTabela || jaNoControl || erro) && (
          <div className="mt-3 grid gap-2">
            {outraTabela && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
                Este cliente é de outra tabela de preço. O pedido continua com os preços de agora — se precisar,
                ajuste em Editar peças.
              </p>
            )}
            {jaNoControl && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
                Este pedido já está no Control: troque o cliente lá também.
              </p>
            )}
            {erro && <p className="text-sm text-danger">{erro}</p>}
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onFechar} disabled={ocupado}>
            Voltar
          </Button>
          <Button type="button" disabled={ocupado || !escolhido} onClick={() => escolhido && onConfirmar(escolhido.id)}>
            {ocupado ? (
              <>
                <Spinner /> Trocando…
              </>
            ) : (
              'Trocar cliente'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
