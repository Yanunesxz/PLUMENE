import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import { CASHBACK_AVISO_DIAS, veAreaDeCashback, type ApiResponse } from '@csb/shared';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { Input } from '../../components/interface/Input.js';
import { Toast } from '../../components/interface/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import { lerValorDigitado } from '../../lib/valorDigitado.js';
import { dataCurta, prazoPorExtenso, type CashbackDoPedido } from './cashback.js';

/**
 * "Cashback do cliente" na tela do pedido (058). Um cartão à parte, que só
 * fala com as rotas /cashback: o pedido em si não muda nada para mostrá-lo.
 *
 * Aparece quando o cliente tem saldo ou quando o pedido já usou cashback. Quem
 * pode usar (venda interna, financeiro, admin — na janela de mexer na
 * observação) toca em "Usar cashback": o valor vai na observação como
 * "Utilizado R$ X do cashback" e `onMudou` recarrega o pedido para a
 * observação nova aparecer.
 *
 * Sem a 058, sem rede ou para quem não vê a área: o cartão não aparece.
 */
export function CartaoCashbackDoPedido({ orderId, onMudou }: { orderId: string; onMudou: () => void }) {
  const { token, user } = useAuthStore();
  const ve = veAreaDeCashback(user?.role, user?.venda_interna === true);
  const [dado, setDado] = useState<CashbackDoPedido | null>(null);
  const [usando, setUsando] = useState(false);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const carregar = useCallback(async () => {
    if (!token || !ve) return;
    try {
      const r = await api.get<ApiResponse<CashbackDoPedido>>(`/cashback/pedidos/${orderId}`, token);
      setDado(r.data);
    } catch {
      setDado(null);
    }
  }, [token, ve, orderId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!ve || !dado) return null;
  const { extrato, uso } = dado;
  const saldo = extrato?.saldo ?? 0;
  if (!uso && saldo <= 0) return null;

  const valor = lerValorDigitado(texto);
  const valorOk = valor != null && valor > 0 && valor <= dado.limite;

  const usar = async () => {
    if (!token || !valorOk || salvando) return;
    setSalvando(true);
    try {
      await api.post(`/cashback/pedidos/${orderId}/uso`, { valor }, token);
      setUsando(false);
      setToast({ message: `Cashback de ${formatBRL(valor)} usado — está na observação do pedido.`, type: 'success' });
      await carregar();
      onMudou();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não deu para usar o cashback.', type: 'error' });
    } finally {
      setSalvando(false);
    }
  };

  const desfazer = async () => {
    if (!token || salvando) return;
    setSalvando(true);
    try {
      await api.del(`/cashback/pedidos/${orderId}/uso`, token);
      setToast({ message: 'Cashback devolvido ao cliente e tirado da observação.', type: 'success' });
      await carregar();
      onMudou();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Não deu para desfazer.', type: 'error' });
    } finally {
      setSalvando(false);
    }
  };

  const proximo = extrato?.proximo_vencimento ?? null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Wallet className="h-4 w-4" strokeWidth={2.25} />
          Cashback do cliente
        </h2>
        <span className="text-base font-bold text-foreground">{formatBRL(saldo)}</span>
      </div>

      {proximo && (
        <p
          className={`mb-2 flex items-start gap-1.5 text-xs ${
            proximo.dias <= CASHBACK_AVISO_DIAS ? 'text-warn-soft-foreground' : 'text-muted-foreground'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {formatBRL(proximo.valor)} {prazoPorExtenso(proximo.dias)} ({dataCurta(proximo.vence_em)}). Avise o cliente.
        </p>
      )}

      {uso ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive-soft-foreground">
          <span>
            Utilizado {formatBRL(uso.valor)} do cashback neste pedido
            {uso.usado_por_nome ? ` (por ${uso.usado_por_nome})` : ''}.
          </span>
          {dado.pode_desfazer && (
            <Button variant="outline" size="sm" disabled={salvando} onClick={() => void desfazer()}>
              Desfazer
            </Button>
          )}
        </div>
      ) : dado.sem_uso === null ? (
        usando ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void usar();
            }}
          >
            <label className="text-xs text-muted-foreground" htmlFor="valor-cashback">
              Quanto abater neste pedido (até {formatBRL(dado.limite)})
            </label>
            <Input
              id="valor-cashback"
              inputMode="decimal"
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={formatBRL(dado.limite)}
            />
            {texto && !valorOk && (
              <p className="text-xs text-danger-soft-foreground">
                Digite um valor entre R$ 0,01 e {formatBRL(dado.limite)}.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setUsando(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={!valorOk || salvando}>
                {salvando ? 'Salvando…' : valorOk ? `Usar ${formatBRL(valor)}` : 'Usar'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Vai na observação como “Utilizado R$ X do cashback”.</p>
            <Button
              size="sm"
              onClick={() => {
                setTexto(dado.limite.toFixed(2).replace('.', ','));
                setUsando(true);
              }}
            >
              Usar cashback
            </Button>
          </div>
        )
      ) : dado.sem_uso === 'pedido_fechado' ? (
        <p className="text-xs text-muted-foreground">
          Este pedido já não aceita mudança — o cashback fica para o próximo pedido do cliente.
        </p>
      ) : null}
    </div>
  );
}
