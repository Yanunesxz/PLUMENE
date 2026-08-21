import { useState } from 'react';
import { cn, formatBRL } from '@/lib/utils';

/**
 * O desconto do pedido — em % ou em REAIS.
 *
 * O representante negocia dos dois jeitos ("tiro 10%" e "tiro R$ 8,90"), e
 * obrigá-lo a converter de cabeça na frente do lojista é pedir erro de conta.
 *
 * Quem manda é sempre UM número: quando ele digita reais, o SERVIDOR calcula o
 * percentual com a soma dos itens que ele mesmo tem. Aqui a conversão é só para
 * a pessoa ver quanto vai sair — o valor que vale é o que a API devolver.
 */
interface CampoDescontoProps {
  /** Soma dos itens SEM desconto — a base da conta. */
  bruto: number;
  /** Percentual em vigor (o que está gravado ou escolhido). */
  percentual: number;
  /** Um dos dois: o outro vai indefinido. */
  onAplicar: (desconto: { percent?: number; valor?: number }) => void;
  desabilitado?: boolean;
  /** Rodapé explicando para onde o desconto vai. */
  rodape?: string;
}

const ATALHOS = [0, 5, 10, 15, 20];

export function CampoDesconto({
  bruto,
  percentual,
  onAplicar,
  desabilitado = false,
  rodape,
}: CampoDescontoProps) {
  const [modo, setModo] = useState<'porcento' | 'reais'>('porcento');
  const [digitado, setDigitado] = useState('');

  const emReais = (bruto * percentual) / 100;

  const confirmar = () => {
    const bruto1 = digitado.trim().replace(',', '.');
    if (bruto1 === '') return;
    const n = Number(bruto1);
    if (!Number.isFinite(n) || n < 0) return;
    if (modo === 'reais') {
      // Passa do pedido? Não manda — a API recusaria, e o aviso local é na hora.
      if (n > bruto) return;
      onAplicar({ valor: n });
    } else {
      if (n > 100) return;
      onAplicar({ percent: n });
    }
    setDigitado('');
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Desconto no pedido</p>
        {percentual > 0 && (
          <span className="tnum text-xs font-medium text-positive">
            −{formatBRL(emReais)} ({percentual.toFixed(2).replace(/\.?0+$/, '')}%)
          </span>
        )}
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {ATALHOS.map((pct) => (
          <button
            key={pct}
            type="button"
            disabled={desabilitado}
            onClick={() => onAplicar({ percent: pct })}
            className={cn(
              'tnum min-w-[52px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50',
              percentual === pct
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-sunken',
            )}
          >
            {pct === 0 ? 'Sem' : `${pct}%`}
          </button>
        ))}
      </div>

      {/* O campo livre com a chave % ↔ R$: é o mesmo campo, muda o que ele
          significa. Duas caixas separadas dariam para preencher as duas e
          deixariam a dúvida de qual vale. */}
      <div className="flex items-stretch gap-1.5">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {(['porcento', 'reais'] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={desabilitado}
              onClick={() => setModo(m)}
              className={cn(
                'px-3 text-sm font-medium transition-colors',
                modo === m
                  ? 'bg-foreground text-background'
                  : 'bg-background text-muted-foreground hover:bg-sunken',
              )}
            >
              {m === 'porcento' ? '%' : 'R$'}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={0}
          step={modo === 'reais' ? 0.01 : 0.5}
          max={modo === 'reais' ? bruto : 100}
          inputMode="decimal"
          value={digitado}
          disabled={desabilitado}
          placeholder={modo === 'reais' ? 'Valor do desconto' : 'Outro percentual'}
          onChange={(e) => setDigitado(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirmar();
            }
          }}
          className="tnum min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          aria-label={modo === 'reais' ? 'Desconto em reais' : 'Desconto em porcentagem'}
        />
      </div>

      {/* Prévia do que o número digitado vale no outro modo — some quando o
          campo está vazio, para não competir com o desconto já aplicado. */}
      {digitado.trim() !== '' && Number(digitado.replace(',', '.')) > 0 && bruto > 0 && (
        <p className="tnum mt-1.5 text-[11px] text-subtle">
          {modo === 'reais'
            ? `${formatBRL(Number(digitado.replace(',', '.')))} = ${((Number(digitado.replace(',', '.')) / bruto) * 100).toFixed(2)}% · total ${formatBRL(Math.max(0, bruto - Number(digitado.replace(',', '.'))))}`
            : `${Number(digitado.replace(',', '.'))}% = ${formatBRL((bruto * Number(digitado.replace(',', '.'))) / 100)} · total ${formatBRL(bruto - (bruto * Number(digitado.replace(',', '.'))) / 100)}`}
        </p>
      )}

      {rodape && <p className="mt-2 text-[11px] leading-tight text-subtle">{rodape}</p>}
    </div>
  );
}
