import { useEffect, useState } from 'react';
import { ClipboardCheck, PartyPopper } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import { normalizarNumeroErp, numeroErpValido, proximoNumeroErp, seguemAOrdem } from '@csb/shared';
import { mensagemDaEspera, type EstadoDaEspera } from '../../lib/pedido.js';

/**
 * Onde a espera pelo Control está (modo 'solicitar').
 *
 *   parado       → o botão "Lançar no Control" está à espera do clique;
 *   solicitando  → a solicitação está indo para a API;
 *   aguardando   → solicitado; a tela consulta o pedido a cada 3 s, por até 3 min;
 *   importado    → o número chegou;
 *   esgotou      → 3 min sem resposta; o pedido continua na fila.
 */
export interface EsperaPeloControl {
  estado: 'parado' | 'solicitando' | EstadoDaEspera;
  /** O número que o Control deu, quando `importado`. */
  numero?: string | null;
  /** O pedido já estava solicitado antes de abrir o diálogo (ISO). */
  solicitadoEm?: string | null;
}

interface Props {
  numeroDoPedido: number | null | undefined;
  /** O último número do Control lançado — de onde vem a sugestão. */
  ultimo: string | null;
  carregandoUltimo: boolean;
  ocupado: boolean;
  /**
   * 'lancar' = digita o número que o Control deu (canal manual);
   * 'corrigir' = o pedido já foi lançado e o número saiu errado;
   * 'solicitar' = canal na API: não há número a digitar, o clique SOLICITA e
   * a tela espera o Control responder.
   */
  modo?: 'lancar' | 'corrigir' | 'solicitar';
  /** O número gravado hoje, quando está corrigindo. */
  atual?: string | null;
  /** O que a API respondeu ao recusar — o diálogo fica aberto mostrando. */
  erro?: string | null;
  /** O exemplo do número na série desta marca ("CS17379" / "PL02672"). */
  exemplo?: string;
  /** Modo 'solicitar': onde a espera está. */
  espera?: EsperaPeloControl;
  onConfirmar: (numeroErp: string) => void;
  /** Modo 'solicitar': o clique que solicita (ou volta a conferir). */
  onSolicitar?: () => void;
  onCancelar: () => void;
}

const QUANDO = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function quando(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : QUANDO.format(new Date(ms));
}

/**
 * O passo de LANÇAR.
 *
 * Canal manual: a Larissa importou a planilha no Control, o Control deu um
 * número ao pedido ("CS17379"), e ela digita esse número aqui. O app sugere o
 * próximo da sequência a partir do último lançado e avisa se o digitado anda
 * para trás — "tem que seguir a ordem de lá" (Yan, 10/09/2026). Quem cunha o
 * número é sempre o ERP; o app só guarda.
 *
 * Canal na API (decisão 2 de 16/09/2026): ninguém digita nada. O clique
 * SOLICITA o lançamento, o Control puxa o pedido e devolve o número pela
 * confirmação; enquanto isso a tela fica consultando o pedido a cada 3 s,
 * por até 3 min. Chegou: "Parabéns, pedido importado!". Não chegou: o pedido
 * fica na fila e o número aparece quando o Control responder.
 */
export function LancarNoErp({
  numeroDoPedido,
  ultimo,
  carregandoUltimo,
  ocupado,
  modo = 'lancar',
  atual,
  erro,
  exemplo = 'CS17379',
  espera = { estado: 'parado' },
  onConfirmar,
  onSolicitar,
  onCancelar,
}: Props) {
  const corrigindo = modo === 'corrigir';
  const solicitando = modo === 'solicitar';
  const [numero, setNumero] = useState('');

  // A sugestão entra quando o último chega — e só se a pessoa ainda não
  // digitou. Corrigindo, ninguém sugere nada: o número errado costuma ser
  // justamente um palpite aceito sem conferir. Solicitando, não há campo.
  useEffect(() => {
    if (!corrigindo && !solicitando && ultimo) setNumero((n) => n || proximoNumeroErp(ultimo));
  }, [ultimo, corrigindo, solicitando]);

  const limpo = normalizarNumeroErp(numero);
  const valido = numeroErpValido(limpo);
  const ordem = valido ? seguemAOrdem(ultimo, limpo) : null;
  const foraDaOrdem = ordem === false;

  // No modo 'solicitar' o diálogo fecha sozinho só por vontade da pessoa: a
  // espera continua no servidor, e fechar não cancela nada.
  const esperando = solicitando && (espera.estado === 'solicitando' || espera.estado === 'aguardando');
  const terminou = solicitando && (espera.estado === 'importado' || espera.estado === 'esgotou');

  const titulo = corrigindo
    ? `Corrigir o número do pedido #${numeroDoPedido ?? ''}`
    : `Lançar o pedido #${numeroDoPedido ?? ''} no Control`;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/40" onClick={esperando ? undefined : onCancelar} aria-hidden />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (solicitando) {
            if (espera.estado === 'parado' && !ocupado) onSolicitar?.();
            else if (terminou) onCancelar();
            return;
          }
          if (valido) onConfirmar(limpo);
        }}
        className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-primary bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0"
      >
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            {espera.estado === 'importado' ? (
              <PartyPopper className="h-5 w-5" strokeWidth={2.5} />
            ) : (
              <ClipboardCheck className="h-5 w-5" strokeWidth={2.5} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>

            {solicitando ? (
              <>
                {espera.estado === 'parado' && (
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {espera.solicitadoEm
                      ? `Solicitado ao Control em ${quando(espera.solicitadoEm)}. O número ainda não chegou — dá para conferir de novo agora.`
                      : 'O número vem do Control: ao lançar, o pedido entra na fila da integração e o Control devolve o número em instantes.'}
                  </p>
                )}
                {esperando && (
                  <p
                    className="mt-2 flex items-center gap-2 text-sm leading-relaxed text-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    <Spinner className="shrink-0 text-primary" />
                    {espera.estado === 'solicitando'
                      ? 'Solicitando ao Control…'
                      : `${mensagemDaEspera('aguardando', null)} Isso leva até 3 min.`}
                  </p>
                )}
                {espera.estado === 'importado' && (
                  <p
                    className="mt-2 rounded-lg bg-positive-soft px-2.5 py-2 text-sm font-medium leading-relaxed text-positive-soft-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {mensagemDaEspera('importado', espera.numero)}
                  </p>
                )}
                {espera.estado === 'esgotou' && (
                  <p
                    className="mt-2 rounded-lg bg-warn-soft px-2.5 py-2 text-sm leading-relaxed text-warn-soft-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {mensagemDaEspera('esgotou', null)}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {corrigindo
                    ? `Hoje está gravado ${atual ?? ''}. Digite o número que o Control realmente deu — é por ele que o faturamento acha este pedido.`
                    : 'Digite o número que o Control deu ao pedido — duas letras e a numeração.'}
                </p>
                <input
                  value={numero}
                  onChange={(e) => setNumero(e.target.value.toUpperCase())}
                  placeholder={exemplo}
                  autoFocus
                  className="mt-3 h-11 w-full rounded-lg border border-border bg-background px-3 font-mono text-base uppercase text-foreground"
                  aria-label="Número do pedido no Control"
                />
                {!corrigindo && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {carregandoUltimo
                      ? 'Buscando o último lançado…'
                      : ultimo
                        ? `Último lançado: ${ultimo} · sugerido: ${proximoNumeroErp(ultimo)}`
                        : 'Nenhum lançado ainda — este será o primeiro da sequência.'}
                  </p>
                )}
              </>
            )}

            {erro && (
              <p className="mt-1.5 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-soft-foreground">
                {erro}
              </p>
            )}
            {!solicitando && numero && !valido && (
              <p className="mt-1 text-xs text-danger">Formato: duas letras e números, ex.: {exemplo}.</p>
            )}
            {!solicitando && foraDaOrdem && (
              <p className="mt-1 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-warn-soft-foreground">
                Este número é MENOR que o último lançado ({ultimo}). O Control numera em ordem —
                confira antes de seguir.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {solicitando ? (
            terminou ? (
              <Button type="submit">Fechar</Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={onCancelar} disabled={espera.estado === 'solicitando'}>
                  {espera.estado === 'aguardando' ? 'Fechar e esperar' : 'Cancelar'}
                </Button>
                <Button type="submit" disabled={ocupado || esperando}>
                  {esperando ? (
                    <>
                      <Spinner />
                      Aguardando…
                    </>
                  ) : espera.solicitadoEm ? (
                    'Conferir agora'
                  ) : (
                    'Lançar no Control'
                  )}
                </Button>
              </>
            )
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button type="submit" disabled={ocupado || !valido}>
                {ocupado ? (
                  <>
                    <Spinner />
                    {corrigindo ? 'Corrigindo…' : 'Lançando…'}
                  </>
                ) : corrigindo ? (
                  'Corrigir número'
                ) : foraDaOrdem ? (
                  'Lançar mesmo assim'
                ) : (
                  'Lançar'
                )}
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
