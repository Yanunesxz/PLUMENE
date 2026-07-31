import { useEffect, useState } from 'react';
import { Store, Info } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import type { ApiResponse, MinhaContaLoja } from '@csb/shared';

/**
 * Conta da loja — só leitura.
 *
 * Alterar cadastro continua sendo da fábrica: CNPJ, tabela de preço e limite
 * saem do ERP, e deixar a loja mexer aqui criaria divergência com o que o
 * faturamento enxerga.
 */
export function PaginaMinhaConta() {
  const { token, user } = useAuthStore();
  const [conta, setConta] = useState<MinhaContaLoja | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<MinhaContaLoja>>('/minha-conta', token)
      .then((res) => setConta(res.data))
      .catch(() => setConta(null))
      .finally(() => setCarregando(false));
  }, [token]);

  return (
    <div className="p-4 md:p-6">
      <h1 className="titulo mb-4 text-[26px] leading-none text-foreground md:text-[32px]">Minha conta</h1>

      {carregando ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
              <Store className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-foreground">
                {conta?.name ?? user?.name}
              </p>
              {conta?.trade_name && (
                <p className="truncate text-sm text-muted-foreground">{conta.trade_name}</p>
              )}
            </div>
          </div>

          <dl className="overflow-hidden rounded-xl border border-border bg-card">
            <Linha rotulo="CNPJ" valor={conta?.cnpj} mono />
            <Linha rotulo="WhatsApp" valor={conta?.whatsapp} />
            <Linha rotulo="E-mail de acesso" valor={user?.email} />
            <Linha rotulo="Tabela de preço" valor={conta?.price_table_name} />
            <Linha rotulo="Representante" valor={conta?.rep_name} />
          </dl>

          <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Para corrigir qualquer dado acima — inclusive a senha — fale com o seu representante.
          </p>
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{rotulo}</dt>
      <dd
        className={`min-w-0 truncate text-right text-sm font-medium text-foreground ${mono ? 'tnum font-mono' : ''}`}
      >
        {valor?.trim() ? valor : '—'}
      </dd>
    </div>
  );
}
