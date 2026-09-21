import { useId } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { ClienteComAlteracaoPendente } from '@csb/shared';

/** Quantos clientes o cartão lista. A fila vem com quem espera há mais tempo primeiro. */
const NO_CARTAO = 10;

/**
 * "CADASTROS ALTERADOS PARA ATUALIZAR NO CONTROL" — na Minha Área de quem mexe
 * no Control (financeiro; admin como válvula), ao lado de "Para incluir no
 * Control".
 *
 * "Quando mudar lá tem que mudar no ERP do Fábio também" (Yan, 17/09/2026). O
 * push avisa na hora; este cartão é o que sobra quando o aviso se perde — o
 * celular desligado, a notificação apagada sem ler. Cada linha abre a ficha,
 * onde está o "antes → depois" e o botão "Já atualizei no Control".
 *
 * Quem decide se aparece é a página: some com a fila vazia ou sem a 051.
 */
export function CadastrosAlteradosParaOControl({ clientes }: { clientes: readonly ClienteComAlteracaoPendente[] }) {
  const idDoTitulo = useId();
  const total = clientes.length;
  const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  return (
    <section
      aria-labelledby={idDoTitulo}
      className="rounded-xl border border-primary/30 bg-primary-soft p-4"
    >
      <h2 id={idDoTitulo} className="text-sm font-semibold text-primary-soft-foreground">
        Cadastros alterados para atualizar no Control ({total})
      </h2>
      <p className="mt-0.5 text-xs text-primary-soft-foreground/80">
        Mudaram no app depois de estarem no Control. Toque para ver o que mudou e dar baixa.
      </p>
      <ul className="mt-2 divide-y divide-primary/15">
        {clientes.slice(0, NO_CARTAO).map((c) => (
          <li key={c.customer_id}>
            <Link
              to={`/customers/${c.customer_id}`}
              className="flex min-h-[44px] items-center gap-3 py-2 text-primary-soft-foreground transition-opacity hover:opacity-80"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-primary-soft-foreground/80">
                  {[
                    c.erp_id ? `código ${c.erp_id}` : null,
                    c.pendentes === 1 ? '1 alteração' : `${c.pendentes} alterações`,
                    `desde ${dia(c.desde)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {total > NO_CARTAO && (
        <p className="mt-2 text-xs text-primary-soft-foreground/80">
          E mais {total - NO_CARTAO} — os que esperam há mais tempo estão no topo.
        </p>
      )}
    </section>
  );
}
