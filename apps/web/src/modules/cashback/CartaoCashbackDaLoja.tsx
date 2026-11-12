import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Wallet } from 'lucide-react';
import type { ApiResponse } from '@csb/shared';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { formatBRL } from '../../lib/utils.js';
import { AvisoDeVencimento, ExtratoDoCashback } from './ExtratoDoCashback.js';
import type { ExtratoDoCliente } from './cashback.js';

/**
 * "Seu cashback" na Minha área da LOJA (058): "o valor do cashback aparece
 * para os dois" (Yan, 12/11/2026) — o vendedor interno na área Cashback, o
 * cliente aqui. Só leitura: quem abate é o vendedor, no pedido.
 *
 * Não aparece para quem nunca ganhou cashback, sem a 058 ou sem rede.
 */
export function CartaoCashbackDaLoja() {
  const { token } = useAuthStore();
  const [dado, setDado] = useState<ExtratoDoCliente | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    api
      .get<ApiResponse<ExtratoDoCliente>>('/cashback/meu', token)
      .then((r) => {
        if (vivo) setDado(r.data);
      })
      .catch(() => {
        if (vivo) setDado(null);
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  if (!dado || dado.extrato.total_ganho <= 0) return null;
  const { extrato } = dado;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Wallet className="h-4 w-4" strokeWidth={2.25} />
            Seu cashback
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            3% de cada pedido faturado, válido por 90 dias. Peça ao seu vendedor para abater no próximo pedido.
          </p>
        </div>
        <p className="shrink-0 text-xl font-bold text-foreground">{formatBRL(extrato.saldo)}</p>
      </div>

      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="mt-2 flex items-center gap-1 text-sm font-medium text-primary"
        aria-expanded={aberto}
      >
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {aberto ? 'Esconder extrato' : 'Ver extrato e vencimentos'}
      </button>

      {/* Fechado, o aviso do vencimento continua à vista — é o que o Yan pediu
          para avisar. Aberto, o extrato traz o mesmo aviso no topo. */}
      <div className="mt-3">
        {aberto ? <ExtratoDoCashback extrato={extrato} /> : <AvisoDeVencimento extrato={extrato} />}
      </div>
    </div>
  );
}
