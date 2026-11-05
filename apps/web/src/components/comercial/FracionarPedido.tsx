import { useMemo, useState } from 'react';
import { Split } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import { formatBRL } from '../../lib/utils.js';
import {
  MAXIMO_DE_ENTREGAS,
  MINIMO_DE_ENTREGAS,
  conferirDistribuicao,
  dividirEmPartesIguais,
  mensagemDoErroDaDistribuicao,
} from '@csb/shared';
import type { EntregaPedida } from '@csb/shared';

/** Uma linha do pedido (peça × tamanho), já com o que a tela mostra. */
export interface ItemParaFracionarNaTela {
  id: string;
  sku: string;
  nome: string;
  tamanho: string;
  quantity: number;
  unit_price: number;
}

interface Props {
  numero: number | null | undefined;
  /** As peças do pedido, na ordem da tela (referência crescente, grade em ordem). */
  itens: ItemParaFracionarNaTela[];
  /** O desconto do pedido, em % — cada entrega herda o mesmo. */
  descontoPercentual: number;
  /** O pedido já está no Control (lançado ou pedido ao Control). */
  jaNoControl: boolean;
  ocupado?: boolean;
  erro?: string | null;
  onConfirmar: (entregas: EntregaPedida[]) => void;
  onFechar: () => void;
}

/** item → quanto vai nas entregas 2…N (a entrega 1 fica com o resto). */
type Outras = Record<string, number[]>;

/** A divisão em partes iguais, no formato que a tela edita. */
function partesIguais(itens: readonly ItemParaFracionarNaTela[], entregas: number): Outras {
  const dividido = dividirEmPartesIguais(itens, entregas);
  const outras: Outras = {};
  for (const item of itens) outras[item.id] = new Array<number>(entregas - 1).fill(0);
  dividido.slice(1).forEach((partes, i) => {
    for (const parte of partes) {
      const lista = outras[parte.item_id];
      if (lista) lista[i] = parte.quantity;
    }
  });
  return outras;
}

/**
 * FRACIONAR O PEDIDO EM ENTREGAS (migração 057; Yan, 05/11/2026).
 *
 * Quem fraciona diz em quantas entregas e a data de envio de cada uma. As
 * peças já chegam separadas em partes iguais — a opção automática —, e cada
 * quantidade pode ser ajustada à mão. Só se digitam as entregas 2 em diante: a
 * entrega 1 fica sempre com o resto, então nenhuma peça some nem dobra.
 *
 * A conta que habilita o botão é `conferirDistribuicao` (shared), a mesma que
 * a API usa para aceitar. Quem pode e até quando: `podeFracionarPedido`.
 */
export function FracionarPedido({
  numero,
  itens,
  descontoPercentual,
  jaNoControl,
  ocupado,
  erro,
  onConfirmar,
  onFechar,
}: Props) {
  const totalDePecas = itens.reduce((s, i) => s + i.quantity, 0);
  // Não há como ter mais entregas do que peças.
  const maximo = Math.max(MINIMO_DE_ENTREGAS, Math.min(MAXIMO_DE_ENTREGAS, totalDePecas));
  const inicial = Math.min(3, maximo);

  const [quantas, setQuantas] = useState(inicial);
  const [datas, setDatas] = useState<string[]>(() => new Array<string>(inicial).fill(''));
  const [outras, setOutras] = useState<Outras>(() => partesIguais(itens, inicial));
  /** Só depois do primeiro toque em "Fracionar" os avisos de data aparecem. */
  const [tentou, setTentou] = useState(false);

  const mudarQuantas = (n: number) => {
    setQuantas(n);
    setDatas((atuais) => Array.from({ length: n }, (_, i) => atuais[i] ?? ''));
    // Mudou o número de entregas: a separação recomeça das partes iguais.
    setOutras(partesIguais(itens, n));
  };

  const mudarQuantidade = (item: ItemParaFracionarNaTela, entrega: number, digitado: string) => {
    setOutras((atual) => {
      const lista = [...(atual[item.id] ?? new Array<number>(quantas - 1).fill(0))];
      const pedido = Math.max(0, Math.floor(Number(digitado.replace(/\D/g, '')) || 0));
      // O teto é o que sobra do item tirando as OUTRAS entregas digitadas: a
      // entrega 1 nunca fica negativa.
      const dasDemais = lista.reduce((s, q, i) => (i === entrega ? s : s + q), 0);
      lista[entrega] = Math.min(pedido, Math.max(0, item.quantity - dasDemais));
      return { ...atual, [item.id]: lista };
    });
  };

  /** A distribuição inteira, entrega por entrega (a 1 é o resto). */
  const entregas = useMemo<EntregaPedida[]>(() => {
    return Array.from({ length: quantas }, (_, e) => ({
      ship_date: datas[e] ?? '',
      itens: itens.flatMap((item) => {
        const lista = outras[item.id] ?? [];
        const quantity =
          e === 0 ? item.quantity - lista.reduce((s, q) => s + q, 0) : (lista[e - 1] ?? 0);
        return quantity > 0 ? [{ item_id: item.id, quantity }] : [];
      }),
    }));
  }, [quantas, datas, outras, itens]);

  const resumo = useMemo(() => {
    const preco = new Map(itens.map((i) => [i.id, i.unit_price]));
    return entregas.map((e) => {
      const pecas = e.itens.reduce((s, p) => s + p.quantity, 0);
      const bruto = e.itens.reduce((s, p) => s + p.quantity * (preco.get(p.item_id) ?? 0), 0);
      return { pecas, total: bruto * (1 - descontoPercentual / 100) };
    });
  }, [entregas, itens, descontoPercentual]);

  const conferencia = conferirDistribuicao(itens, entregas);
  // Antes do primeiro toque, data em branco não é "erro": é o que falta preencher.
  const aviso = conferencia.ok
    ? null
    : conferencia.erro === 'data_invalida' && !tentou
      ? null
      : mensagemDoErroDaDistribuicao(conferencia.erro, conferencia.entrega);

  // Uma referência por bloco, com a grade dela embaixo — como no pedido.
  const grupos = useMemo(() => {
    const porSku = new Map<string, { sku: string; nome: string; linhas: ItemParaFracionarNaTela[] }>();
    for (const item of itens) {
      const g = porSku.get(item.sku) ?? { sku: item.sku, nome: item.nome, linhas: [] };
      g.linhas.push(item);
      porSku.set(item.sku, g);
    }
    return [...porSku.values()];
  }, [itens]);

  const titulo = numero ? `Fracionar o pedido #${numero} em entregas` : 'Fracionar o pedido em entregas';
  const colunas = { gridTemplateColumns: `minmax(4.5rem, 1fr) repeat(${quantas}, 3.25rem)` };

  const confirmar = () => {
    setTentou(true);
    if (conferencia.ok) onConfirmar(entregas);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="absolute inset-0 bg-foreground/40" onClick={ocupado ? undefined : onFechar} aria-hidden />
      <div className="animate-slide-up relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        <div className="flex gap-3 px-5 pt-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <Split className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Cada entrega vira um pedido próprio, com número e data de envio próprios. Preços,
              desconto, condição e cliente continuam os mesmos.
            </p>
          </div>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          <p className="text-xs font-medium text-muted-foreground">Em quantas entregas</p>
          <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Quantidade de entregas">
            {Array.from({ length: maximo - MINIMO_DE_ENTREGAS + 1 }, (_, i) => i + MINIMO_DE_ENTREGAS).map((n) => (
              <button
                key={n}
                type="button"
                disabled={ocupado}
                aria-pressed={quantas === n}
                onClick={() => mudarQuantas(n)}
                className={`tnum h-11 min-w-11 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                  quantas === n
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-card text-foreground hover:bg-muted'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className={`mt-4 grid gap-2 ${quantas === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
            {resumo.map((r, e) => (
              <div key={e} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="text-sm font-semibold text-foreground">
                    Entrega {e + 1} de {quantas}
                  </p>
                  <p className="tnum text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{r.pecas}</span> peças · {formatBRL(r.total)}
                  </p>
                </div>
                <label className="mt-2 block text-xs text-muted-foreground" htmlFor={`envio-${e}`}>
                  Data de envio
                </label>
                <input
                  id={`envio-${e}`}
                  type="date"
                  value={datas[e] ?? ''}
                  disabled={ocupado}
                  onChange={(ev) =>
                    setDatas((atuais) => atuais.map((d, i) => (i === e ? ev.target.value : d)))
                  }
                  className={`mt-1 h-11 w-full rounded-lg border bg-card px-3 text-sm text-foreground ${
                    tentou && !datas[e] ? 'border-danger' : 'border-input'
                  }`}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              As peças já estão separadas em partes iguais. Ajuste as entregas 2 em diante se
              precisar — a entrega 1 fica com o resto.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ocupado}
              onClick={() => setOutras(partesIguais(itens, quantas))}
            >
              Separar em partes iguais
            </Button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <div className="min-w-max">
              <div
                className="grid items-center gap-1 border-b border-border bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                style={colunas}
              >
                <span>Tamanho</span>
                {Array.from({ length: quantas }, (_, e) => (
                  <span key={e} className="text-center">
                    {e + 1}ª
                  </span>
                ))}
              </div>
              {grupos.map((g) => (
                <div key={g.sku} className="border-b border-border last:border-b-0">
                  <p className="flex items-baseline gap-2 px-3 pt-2 text-xs">
                    <span className="tnum font-mono font-semibold text-foreground">{g.sku}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{g.nome}</span>
                  </p>
                  {g.linhas.map((item) => {
                    const lista = outras[item.id] ?? [];
                    const naPrimeira = item.quantity - lista.reduce((s, q) => s + q, 0);
                    return (
                      <div key={item.id} className="grid items-center gap-1 px-3 py-1.5" style={colunas}>
                        <span className="text-sm text-foreground">
                          <span className="font-medium">{item.tamanho}</span>{' '}
                          <span className="tnum text-xs text-muted-foreground">· {item.quantity} pç</span>
                        </span>
                        <span
                          className="tnum flex h-9 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground"
                          aria-label={`${g.sku} ${item.tamanho}: entrega 1`}
                        >
                          {naPrimeira}
                        </span>
                        {Array.from({ length: quantas - 1 }, (_, i) => (
                          <input
                            key={i}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            disabled={ocupado}
                            value={String(lista[i] ?? 0)}
                            onFocus={(ev) => ev.target.select()}
                            onChange={(ev) => mudarQuantidade(item, i, ev.target.value)}
                            aria-label={`${g.sku} ${item.tamanho}: entrega ${i + 2}`}
                            className="tnum h-9 w-full rounded-md border border-input bg-card text-center text-sm text-foreground"
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-5 pb-5 pt-3">
          {jaNoControl && (
            <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
              Este pedido já está no Control: lá ele continua inteiro até alguém atualizar. As entregas
              novas ainda precisam ser lançadas.
            </p>
          )}
          {(erro || aviso) && <p className="mb-2 text-sm text-danger">{erro ?? aviso}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onFechar} disabled={ocupado}>
              Voltar
            </Button>
            <Button type="button" disabled={ocupado || (tentou && !conferencia.ok)} onClick={confirmar}>
              {ocupado ? (
                <>
                  <Spinner /> Fracionando…
                </>
              ) : (
                `Fracionar em ${quantas} entregas`
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
