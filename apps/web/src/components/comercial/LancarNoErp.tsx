import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import { normalizarNumeroErp, numeroErpValido, proximoNumeroErp, seguemAOrdem } from '@csb/shared';

interface Props {
  numeroDoPedido: number | null | undefined;
  /** O último número do Control lançado — de onde vem a sugestão. */
  ultimo: string | null;
  carregandoUltimo: boolean;
  ocupado: boolean;
  onConfirmar: (numeroErp: string) => void;
  onCancelar: () => void;
}

/**
 * O passo de LANÇAR: a Larissa importou a planilha no Control, o Control deu
 * um número ao pedido ("SX14627"), e ela digita esse número aqui. O app sugere
 * o próximo da sequência a partir do último lançado e avisa se o digitado anda
 * para trás — "tem que seguir a ordem de lá" (Yan, 10/09/2026). Quem cunha o
 * número é sempre o ERP; o app só guarda.
 */
export function LancarNoErp({ numeroDoPedido, ultimo, carregandoUltimo, ocupado, onConfirmar, onCancelar }: Props) {
  const [numero, setNumero] = useState('');

  // A sugestão entra quando o último chega — e só se a pessoa ainda não digitou.
  useEffect(() => {
    if (ultimo) setNumero((n) => n || proximoNumeroErp(ultimo));
  }, [ultimo]);

  const limpo = normalizarNumeroErp(numero);
  const valido = numeroErpValido(limpo);
  const ordem = valido ? seguemAOrdem(ultimo, limpo) : null;
  const foraDaOrdem = ordem === false;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/40" onClick={onCancelar} aria-hidden />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) onConfirmar(limpo);
        }}
        className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-primary bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0"
      >
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <ClipboardCheck className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-snug text-foreground">
              Lançar o pedido #{numeroDoPedido ?? ''} no Control
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Digite o número que o Control deu ao pedido — duas letras e a numeração.
            </p>
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value.toUpperCase())}
              placeholder="SX14627"
              autoFocus
              className="mt-3 h-11 w-full rounded-lg border border-border bg-background px-3 font-mono text-base uppercase text-foreground"
              aria-label="Número do pedido no Control"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {carregandoUltimo
                ? 'Buscando o último lançado…'
                : ultimo
                  ? `Último lançado: ${ultimo} · sugerido: ${proximoNumeroErp(ultimo)}`
                  : 'Nenhum lançado ainda — este será o primeiro da sequência.'}
            </p>
            {numero && !valido && (
              <p className="mt-1 text-xs text-danger">Formato: duas letras e números, ex.: SX14627.</p>
            )}
            {foraDaOrdem && (
              <p className="mt-1 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-warn-soft-foreground">
                Este número é MENOR que o último lançado ({ultimo}). O Control numera em ordem —
                confira antes de seguir.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button type="submit" disabled={ocupado || !valido}>
            {ocupado ? (
              <>
                <Spinner />
                Lançando…
              </>
            ) : foraDaOrdem ? (
              'Lançar mesmo assim'
            ) : (
              'Lançar'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
