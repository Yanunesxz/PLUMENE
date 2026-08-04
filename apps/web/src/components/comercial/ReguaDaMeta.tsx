import { useEffect, useState } from 'react';
import {
  FAIXAS_DE_BONUS,
  faixaAlcancada,
  posicaoNaRegua,
  proximaFaixa,
} from '@csb/shared';
import { formatBRLCurto } from '../../lib/utils.js';

/**
 * Onde o representante está na bonificação do mês.
 *
 * A pergunta que ele faz no dia 20 não é "quanto vendi" — o cartão do lado já
 * responde isso. É "dá para chegar?". Então o que aparece grande é o QUE FALTA,
 * e o desenho é uma régua: uma linha de tinta com entalhes nos degraus e uma
 * seta marcando a posição. Barra de progresso arredondada mostraria uma
 * porcentagem, que aqui não quer dizer nada — o que existe são quatro degraus.
 *
 * Os degraus ficam a distâncias IGUAIS na régua de propósito (ver
 * `posicaoNaRegua`): em escala linear, 80 e 100 mil ficariam colados.
 */
export function ReguaDaMeta({ enviadoNoMes }: { enviadoNoMes: number }) {
  const conquistada = faixaAlcancada(enviadoNoMes);
  const proxima = proximaFaixa(enviadoNoMes);
  const alvo = posicaoNaRegua(enviadoNoMes);

  // A régua desenha do zero até a posição no primeiro quadro. É o único
  // movimento da tela, e ele conta algo: a distância percorrida no mês.
  const [posicao, setPosicao] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setPosicao(alvo));
    return () => cancelAnimationFrame(t);
  }, [alvo]);

  const falta = proxima ? proxima.meta - enviadoNoMes : 0;

  return (
    <section
      aria-label="Bonificação do mês"
      className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Bônus do mês
        </h2>
        <p className="tnum text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{formatBRLCurto(enviadoNoMes)}</span> enviados
        </p>
      </div>

      {/* O número grande é o que falta, não o que já foi: é a única coisa aqui
          sobre a qual ele ainda pode fazer alguma coisa hoje. */}
      <p className="titulo tnum text-[28px] leading-none text-foreground md:text-[34px]">
        {proxima ? formatBRLCurto(falta) : formatBRLCurto(conquistada?.bonus ?? 0)}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {proxima ? (
          <>
            para o bônus de{' '}
            <span className="font-semibold text-foreground">{formatBRLCurto(proxima.bonus)}</span>
            {conquistada ? (
              <>
                {' '}
                · <span className="text-positive-soft-foreground">
                  {formatBRLCurto(conquistada.bonus)} já garantidos
                </span>
              </>
            ) : null}
          </>
        ) : (
          'é o teto da bonificação, e ele já é seu.'
        )}
      </p>

      {/* ── a régua ─────────────────────────────────────────────────────────
          Margem lateral generosa: o rótulo do último degrau é centrado nele e
          precisa de espaço para os dois lados sem estourar o cartão. */}
      <div className="relative mx-6 mt-9 sm:mx-10">
        {/* A seta vem POR CIMA, apontando para baixo, com uma haste até a linha.
            Embaixo ela dividiria espaço com os rótulos e encostava neles toda
            vez que a meta se aproximava — que é justamente quando ele olha. */}
        <span
          aria-hidden
          className="absolute -top-4 z-10 -translate-x-1/2 transition-[left] duration-700 ease-out motion-reduce:transition-none"
          style={{ left: `${posicao * 100}%` }}
        >
          <svg width="9" height="17" viewBox="0 0 9 17" className="block">
            <path d="M4.5 0v11" className="stroke-foreground" strokeWidth="1.25" />
            <path d="M0 11h9l-4.5 6z" className="fill-foreground" />
          </svg>
        </span>

        <div className="relative h-0.5 w-full rounded-full bg-border">
          {/* percorrido */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${posicao * 100}%` }}
          />
          {FAIXAS_DE_BONUS.map((faixa, i) => {
            const pct = ((i + 1) / FAIXAS_DE_BONUS.length) * 100;
            const batida = enviadoNoMes >= faixa.meta;
            const alvoAtual = proxima?.meta === faixa.meta;
            return (
              <span
                key={faixa.meta}
                aria-hidden
                className={[
                  'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-500',
                  batida
                    ? 'h-2.5 w-2.5 bg-foreground'
                    : alvoAtual
                      ? 'h-2.5 w-2.5 border-2 border-foreground bg-card'
                      : 'h-1.5 w-1.5 bg-input',
                ].join(' ')}
                style={{ left: `${pct}%` }}
              />
            );
          })}
        </div>

        {/* rótulos: o degrau em reais e o que ele paga */}
        <div className="relative mt-3.5 h-8">
          {FAIXAS_DE_BONUS.map((faixa, i) => {
            const pct = ((i + 1) / FAIXAS_DE_BONUS.length) * 100;
            const batida = enviadoNoMes >= faixa.meta;
            const alvoAtual = proxima?.meta === faixa.meta;
            return (
              <div
                key={faixa.meta}
                className="absolute -translate-x-1/2 text-center"
                style={{ left: `${pct}%` }}
              >
                <p
                  className={`tnum text-[11px] leading-tight ${
                    batida || alvoAtual ? 'text-muted-foreground' : 'text-subtle'
                  }`}
                >
                  {faixa.meta / 1000} mil
                </p>
                <p
                  className={`tnum text-[11px] font-semibold leading-tight ${
                    batida
                      ? 'text-foreground'
                      : alvoAtual
                        ? 'text-foreground'
                        : 'text-subtle'
                  }`}
                >
                  {formatBRLCurto(faixa.bonus)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
        Soma os pedidos que você enviou entre os dias 01 e 31. Vale um degrau só, o mais alto que
        você alcançar. Pedido cancelado ou alterado sai da conta.
      </p>
    </section>
  );
}
