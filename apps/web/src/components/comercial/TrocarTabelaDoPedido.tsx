import { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import { api } from '../../services/api.js';
import { formatBRL } from '../../lib/utils.js';
import type { ApiResponse, PriceTable, ResultadoDaTrocaDeTabela } from '@csb/shared';

interface Props {
  orderId: string;
  token: string;
  numero: number | null | undefined;
  /** A tabela com que o pedido está hoje — sai da lista. */
  tabelaAtualId: string | null | undefined;
  /** O pedido já está no Control (lançado ou pedido ao Control). */
  jaNoControl: boolean;
  ocupado?: boolean;
  erro?: string | null;
  onConfirmar: (price_table_id: string) => void;
  onFechar: () => void;
}

/**
 * Trocar a tabela de preço do pedido já feito (Yan, 27/10/2026). Antes de
 * confirmar, a API calcula a troca SEM gravar (`simular`) e a tela mostra
 * quanto o total muda — repreciar em silêncio mudaria o que o cliente combinou.
 * Regra de quem pode e até quando: `podeTrocarTabelaDoPedido` (shared).
 */
export function TrocarTabelaDoPedido({
  orderId,
  token,
  numero,
  tabelaAtualId,
  jaNoControl,
  ocupado,
  erro,
  onConfirmar,
  onFechar,
}: Props) {
  const [tabelas, setTabelas] = useState<PriceTable[] | null>(null);
  const [erroDaLista, setErroDaLista] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState('');
  const [previa, setPrevia] = useState<ResultadoDaTrocaDeTabela | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [erroDaPrevia, setErroDaPrevia] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ApiResponse<PriceTable[]>>('/orders/tabelas-para-trocar', token)
      .then((r) => setTabelas(r.data.filter((t) => t.id !== tabelaAtualId)))
      .catch((e: unknown) => setErroDaLista(e instanceof Error ? e.message : 'Não foi possível listar as tabelas.'));
  }, [token, tabelaAtualId]);

  const escolher = (id: string) => {
    setEscolhida(id);
    setPrevia(null);
    setErroDaPrevia(null);
    if (!id) return;
    setCalculando(true);
    api
      .patch<ApiResponse<unknown> & { meta?: ResultadoDaTrocaDeTabela }>(
        `/orders/${orderId}/tabela`,
        { price_table_id: id, simular: true },
        token,
      )
      .then((r) => setPrevia(r.meta ?? null))
      .catch((e: unknown) => setErroDaPrevia(e instanceof Error ? e.message : 'Não foi possível calcular.'))
      .finally(() => setCalculando(false));
  };

  const titulo = numero ? `Trocar a tabela do pedido #${numero}` : 'Trocar a tabela do pedido';
  const diferenca = previa ? previa.total_depois - previa.total_antes : 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-foreground/40" onClick={onFechar} aria-hidden />
      <div className="animate-slide-up relative flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <Tags className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Os preços das peças são recalculados pela tabela nova. Quantidades e desconto ficam como estão.
            </p>
          </div>
        </div>

        <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="tabela-nova">
          Tabela nova
        </label>
        <select
          id="tabela-nova"
          value={escolhida}
          disabled={!tabelas || ocupado}
          onChange={(e) => escolher(e.target.value)}
          className="mt-1 flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="">{tabelas ? 'Escolha a tabela…' : 'Carregando…'}</option>
          {(tabelas ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <div className="mt-3 grid gap-2">
          {calculando && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner /> Calculando o novo total…
            </p>
          )}
          {previa && (
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <p className="text-muted-foreground">
                Total agora: <span className="font-medium text-foreground">{formatBRL(previa.total_antes)}</span>
              </p>
              <p className="text-muted-foreground">
                Total na tabela nova: <span className="font-semibold text-foreground">{formatBRL(previa.total_depois)}</span>
                {diferenca !== 0 && (
                  <span className="ml-1 text-xs">
                    ({diferenca > 0 ? '+' : '−'}
                    {formatBRL(Math.abs(diferenca))})
                  </span>
                )}
              </p>
            </div>
          )}
          {jaNoControl && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
              Este pedido já está no Control: acerte o preço lá também.
            </p>
          )}
          {(erro || erroDaPrevia || erroDaLista) && (
            <p className="text-sm text-danger">{erro ?? erroDaPrevia ?? erroDaLista}</p>
          )}
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onFechar} disabled={ocupado}>
            Voltar
          </Button>
          <Button type="button" disabled={ocupado || calculando || !previa} onClick={() => onConfirmar(escolhida)}>
            {ocupado ? (
              <>
                <Spinner /> Trocando…
              </>
            ) : (
              'Trocar tabela'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
