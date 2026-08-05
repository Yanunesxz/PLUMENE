import { useEffect, useState } from 'react';
import {
  faixaAlcancada,
  posicaoNaRegua,
  proximaFaixa,
  type FaixaDeBonus,
} from '@csb/shared';
import { formatBRLCurto } from '../../lib/utils.js';

/**
 * Onde o representante está na bonificação do mês.
 *
 * O número grande é o que ele JÁ ENVIOU, e ele sobe ao longo do mês: quem
 * acompanha todo dia quer ver a conta crescer, não uma dívida diminuindo. O
 * quanto falta fica logo abaixo, na linha que também diz quanto isso paga.
 *
 * O desenho é uma régua: linha de tinta com entalhe em cada degrau e uma seta
 * marcando a posição. Barra de progresso arredondada mostraria uma porcentagem,
 * que aqui não quer dizer nada — o que existe são degraus, e vale um só, o mais
 * alto alcançado.
 *
 * As faixas vêm do cadastro que o gerente faz por representante e por mês; podem
 * ser de uma a quatro. Sem faixa cadastrada o cartão não aparece — prometer
 * bônus que ninguém cadastrou seria pior do que não falar nada.
 */
export function ReguaDaMeta({
  enviadoNoMes,
  faixas,
}: {
  enviadoNoMes: number;
  faixas: readonly FaixaDeBonus[];
}) {
  const alvo = posicaoNaRegua(enviadoNoMes, faixas);

  // A régua desenha do zero até a posição no primeiro quadro. É o único
  // movimento da tela, e ele conta algo: a distância percorrida no mês.
  const [posicao, setPosicao] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setPosicao(alvo));
    return () => cancelAnimationFrame(t);
  }, [alvo]);

  if (faixas.length === 0) return null;

  const conquistada = faixaAlcancada(enviadoNoMes, faixas);
  const proxima = proximaFaixa(enviadoNoMes, faixas);
  const falta = proxima ? proxima.meta - enviadoNoMes : 0;

  return (
    <section
      aria-label="Bonificação do mês"
      className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Bônus do mês
        </h2>
        {conquistada ? (
          <p className="tnum text-sm text-positive-soft-foreground">
            <span className="font-semibold">{formatBRLCurto(conquistada.bonus)}</span> garantidos
          </p>
        ) : null}
      </div>

      {/* O número que sobe: o enviado acumulado no mês. Ele fica sozinho na
          linha, com "enviados" de rodapé — a frase do que falta vem embaixo, e
          não emendada, senão o valor do bônus sobra órfão na quebra. */}
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="titulo tnum text-[28px] leading-none text-foreground md:text-[34px]">
          {formatBRLCurto(enviadoNoMes)}
        </span>
        <span className="text-sm text-muted-foreground">enviados</span>
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {proxima ? (
          <>
            faltam{' '}
            <span className="tnum whitespace-nowrap font-semibold text-foreground">
              {formatBRLCurto(falta)}
            </span>{' '}
            para o bônus de{' '}
            <span className="tnum whitespace-nowrap font-semibold text-foreground">
              {formatBRLCurto(proxima.bonus)}
            </span>
          </>
        ) : (
          'você chegou no topo da bonificação'
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
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${posicao * 100}%` }}
          />
          {faixas.map((faixa, i) => {
            const pct = ((i + 1) / faixas.length) * 100;
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
          {faixas.map((faixa, i) => {
            const pct = ((i + 1) / faixas.length) * 100;
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
                  {metaCurta(faixa.meta)}
                </p>
                <p
                  className={`tnum text-[11px] font-semibold leading-tight ${
                    batida || alvoAtual ? 'text-foreground' : 'text-subtle'
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

/**
 * "50 mil" em vez de "R$ 50.000" no entalhe: são quatro rótulos numa linha de
 * celular, e o degrau redondo é como o representante fala dele mesmo.
 * Valor quebrado (R$ 62.500) não vira "62,5 mil" — mostra o número inteiro.
 */
function metaCurta(meta: number): string {
  return meta >= 1000 && meta % 1000 === 0
    ? `${(meta / 1000).toLocaleString('pt-BR')} mil`
    : formatBRLCurto(meta);
}
