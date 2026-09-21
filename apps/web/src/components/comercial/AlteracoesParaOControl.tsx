import { useId, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, History } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import { cn } from '../../lib/utils.js';
import {
  autoriaDaAlteracao,
  linhasDaAlteracao,
  notaDaLinhaSuperada,
  pendentesNaOrdemDeDigitar,
  separarAlteracoes,
  situacaoDaAlteracao,
} from '../../lib/edicaoDoCadastro.js';
import { ALTERACOES_RESOLVIDAS_NA_FICHA } from '@csb/shared';
import type { AlteracaoDoCliente } from '@csb/shared';

interface Props {
  /** `CustomerDetail.alteracoes`: as pendentes todas e as últimas resolvidas, das mais novas para as mais antigas. */
  alteracoes: readonly AlteracaoDoCliente[];
  erpId: string | null;
  /** Quem mexe no Control dá a baixa: financeiro e admin. */
  podeConfirmar: boolean;
  online: boolean;
  ocupado: boolean;
  erro?: string | null | undefined;
  /** Recebe os ids EXIBIDOS no cartão — nunca "todas as pendentes do cliente". */
  onConfirmar: (ids: string[]) => void;
}

/**
 * "PARA ATUALIZAR NO CONTROL" — o cadastro mudou no app e o Control ainda não.
 *
 * "Quando mudar lá tem que mudar no ERP do Fábio também" (Yan, 17/09/2026).
 * Enquanto a integração não puxa sozinha, quem digita no Control é o
 * financeiro: o cartão é a lista do que digitar, campo a campo, "antes →
 * depois" — e não "veja o cadastro".
 *
 * "Já atualizei no Control" manda os ids que ESTÃO NA TELA. Uma edição que
 * chegue enquanto a pessoa digita lá tem outro id, fica fora da baixa e
 * continua no cartão.
 *
 * Para quem não mexe no Control o texto é neutro: a tela não sabe se a empresa
 * avisa o financeiro por push ou se o Control puxa pela API.
 *
 * As pendentes vêm na ordem de digitar — da mais antiga para a mais nova — e o
 * campo que uma edição mais nova já trocou sai riscado, com o valor que vale
 * (revisão de 17/09/2026): a lista mandava digitar no Control um valor que o
 * app já não tinha.
 *
 * Abaixo, recolhido, o histórico das alterações já resolvidas.
 */
export function AlteracoesParaOControl({ alteracoes, erpId, podeConfirmar, online, ocupado, erro, onConfirmar }: Props) {
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const idDoTitulo = useId();
  const idDoHistorico = useId();
  const { resolvidas } = useMemo(() => separarAlteracoes(alteracoes), [alteracoes]);
  const pendentes = useMemo(() => pendentesNaOrdemDeDigitar(alteracoes), [alteracoes]);

  if (pendentes.length === 0 && resolvidas.length === 0) return null;

  return (
    <>
      {pendentes.length > 0 && (
        <section
          aria-labelledby={idDoTitulo}
          className="mt-3 rounded-xl border border-warn/40 bg-warn-soft p-4 shadow-sm"
        >
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn-soft-foreground" strokeWidth={2.5} aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 id={idDoTitulo} className="text-[15px] font-semibold leading-snug text-warn-soft-foreground">
                Para atualizar no Control
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-warn-soft-foreground/90">
                {erpId
                  ? `O cadastro mudou no app e o cliente ${erpId} no Control ainda está com os dados antigos.`
                  : 'O cadastro mudou no app e o Control ainda está com os dados antigos.'}
              </p>

              <ul className="mt-3 space-y-2">
                {pendentes.map((a) => (
                  <li key={a.id} className="rounded-lg bg-card/60 px-3 py-2">
                    <p className="text-xs text-warn-soft-foreground/80">{autoriaDaAlteracao(a)}</p>
                    <CamposDaAlteracao alteracao={a} todas={alteracoes} className="text-warn-soft-foreground" />
                  </li>
                ))}
              </ul>

              {erro && (
                <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-soft-foreground">
                  {erro}
                </p>
              )}

              {podeConfirmar ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <Button
                    variant="outline"
                    disabled={ocupado || !online}
                    onClick={() => onConfirmar(pendentes.map((a) => a.id))}
                  >
                    {ocupado ? <Spinner /> : <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
                    {ocupado ? 'Marcando…' : online ? 'Já atualizei no Control' : 'Precisa de internet'}
                  </Button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-warn-soft-foreground/80">
                  Quem cuida do Control já tem esta lista. Ela some daqui quando o Control estiver em dia.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {resolvidas.length > 0 && (
        <section className="mt-3 rounded-xl border border-border bg-card shadow-sm">
          <button
            type="button"
            aria-expanded={historicoAberto}
            aria-controls={idDoHistorico}
            onClick={() => setHistoricoAberto((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <History className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
              Histórico de alterações
              <span className="font-normal text-muted-foreground">
                {/* A API corta nas últimas ALTERACOES_RESOLVIDAS_NA_FICHA — o mesmo número do shared. */}
                {resolvidas.length >= ALTERACOES_RESOLVIDAS_NA_FICHA
                  ? `(últimas ${ALTERACOES_RESOLVIDAS_NA_FICHA})`
                  : `(${resolvidas.length})`}
              </span>
            </span>
            <ChevronDown
              className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', historicoAberto && 'rotate-180')}
              aria-hidden
            />
          </button>
          <ul id={idDoHistorico} hidden={!historicoAberto} className="divide-y divide-border border-t border-border">
            {resolvidas.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <p className="text-xs text-muted-foreground">{autoriaDaAlteracao(a)}</p>
                <CamposDaAlteracao alteracao={a} className="text-foreground" />
                <p className="mt-1 text-xs text-subtle">{situacaoDaAlteracao(a)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * "Rótulo: antes → depois", um por campo. Com `todas` (o cartão das pendentes),
 * o campo que uma edição mais nova já trocou sai riscado, com a nota do valor
 * que vale — nunca como mais uma coisa a digitar.
 */
function CamposDaAlteracao({
  alteracao,
  todas,
  className,
}: {
  alteracao: AlteracaoDoCliente;
  todas?: readonly AlteracaoDoCliente[];
  className: string;
}) {
  return (
    <dl className={cn('mt-1 space-y-1 text-sm', className)}>
      {linhasDaAlteracao(alteracao, todas).map((l) => {
        const nota = notaDaLinhaSuperada(l);
        return (
          <div key={l.campo} className="break-words">
            <dt className="inline font-medium">{l.rotulo}: </dt>
            <dd className="inline whitespace-pre-wrap">
              <span className="opacity-70">{l.antes}</span>
              <span aria-hidden> → </span>
              <span className="sr-only"> para </span>
              <span className={nota ? 'line-through opacity-70' : 'font-semibold'}>{l.depois}</span>
            </dd>
            {nota && <dd className="text-xs font-medium">{nota}</dd>}
          </div>
        );
      })}
    </dl>
  );
}
