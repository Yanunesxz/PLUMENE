import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Textarea } from '../interface/Textarea.js';
import { formatBRL } from '../../lib/utils.js';
import { lerListaConferida, guardarListaConferida, esquecerListaConferida } from '../../lib/listaConferida.js';
import {
  assinaturaDoPedido,
  divergenciaComOErp,
  type PedidoParaComparar,
  type SincroniaComOErp,
} from '@csb/shared';

interface Props {
  /** O pedido — é a chave da lista conferida guardada no aparelho. */
  orderId: string;
  /** O que o Control conhece deste pedido (046). */
  sincronia: SincroniaComOErp;
  /** O pedido de HOJE: peças com referência e tamanho, desconto, condição e observação. */
  pedidoHoje: PedidoParaComparar;
  /**
   * O número do Control que vale AGORA. Não o da foto: se a Larissa corrigiu o
   * número depois do lançamento, é pelo novo que ela acha o pedido lá.
   */
  numeroNoControl: string | null;
  /** Com a nota emitida não há o que atualizar: o cartão vira registro, sem botões. */
  faturado: boolean;
  /** Quem editou pede a atualização: a venda interna dona, ou o escritório. */
  podePedir: boolean;
  /** Quem mexe no Control confirma que já atualizou lá: financeiro e admin. */
  podeConfirmar: boolean;
  ocupado: boolean;
  erro?: string | null;
  onPedir: (observacao: string) => void;
  /** Recebe a impressão da lista que a pessoa CONFERIU — não a do instante do clique. */
  onConfirmar: (assinaturaVista: string) => void;
}

/**
 * "ATUALIZAR NO ERP" — o pedido mudou depois de ir para o Control.
 *
 * Pedido do Yan (11/09/2026): "depois que o pedido for enviado pelas vendedoras
 * internas e elas alterarem ele, temos que ter um botão depois que editou as
 * peças como 'atualizar no ERP', porque se ela mudar por lá tem que mudar no
 * ERP principal também".
 *
 * A Simone mexe no próprio pedido até o carimbo de faturado, inclusive depois
 * de a Larissa lançar. Sem este bloco, a nota sairia pelo pedido velho e
 * ninguém descobriria antes do faturamento.
 *
 * O cartão só aparece quando o pedido de hoje DIVERGE da fotografia do Control
 * — nas peças, no desconto, na condição de pagamento ou na observação, que são
 * as quatro coisas que a venda interna consegue mudar depois do lançamento.
 *
 * O componente é montado com `key` na data da foto: foto nova, cartão novo, e
 * a lista "conferida" começa do zero.
 */
export function AtualizarNoErp({
  orderId,
  sincronia,
  pedidoHoje,
  numeroNoControl,
  faturado,
  podePedir,
  podeConfirmar,
  ocupado,
  erro,
  onPedir,
  onConfirmar,
}: Props) {
  const [observacao, setObservacao] = useState('');
  const [escrevendo, setEscrevendo] = useState(false);

  // Pedido registrado: o recado foi e a caixa fecha. Sem isto ela ficava aberta
  // com o botão "Avisar a fábrica" armado, como se nada tivesse sido enviado.
  useEffect(() => {
    setEscrevendo(false);
    setObservacao('');
  }, [sincronia.pedido_em]);

  const d = useMemo(() => divergenciaComOErp(sincronia.snapshot, pedidoHoje), [sincronia, pedidoHoje]);
  const assinaturaAgora = useMemo(() => assinaturaDoPedido(pedidoHoje), [pedidoHoje]);

  // A lista que a Larissa CONFERIU é a do momento em que o aviso apareceu para
  // ela — não a do clique. Fica guardada no aparelho (lib/listaConferida) porque
  // a tela recarrega sozinha: o app se atualiza quando a aba sai da frente, e é
  // exatamente quando ela vai digitar no Control. Se a Simone mudou de novo
  // nesse meio tempo, a confirmação engoliria a mudança que a Larissa não viu.
  //
  // Só para quem CONFIRMA: para a venda interna, que é quem muda o pedido, um
  // alarme de "mudou de novo" a cada edição dela seria ruído.
  const [assinaturaVista, setAssinaturaVista] = useState<string | null>(() =>
    podeConfirmar ? lerListaConferida(orderId, sincronia.confirmado_em) : null,
  );
  useEffect(() => {
    if (!podeConfirmar) return;
    if (!d.mudou) {
      // O pedido voltou a bater com o Control (a edição foi desfeita): a próxima
      // divergência é outra conversa e começa do zero.
      if (assinaturaVista !== null) {
        setAssinaturaVista(null);
        esquecerListaConferida(orderId, sincronia.confirmado_em);
      }
      return;
    }
    if (assinaturaVista === null) {
      setAssinaturaVista(assinaturaAgora);
      guardarListaConferida(orderId, sincronia.confirmado_em, assinaturaAgora);
    }
  }, [podeConfirmar, d.mudou, assinaturaAgora, assinaturaVista, orderId, sincronia.confirmado_em]);
  const mudouDeNovo = podeConfirmar && assinaturaVista !== null && assinaturaVista !== assinaturaAgora;

  const conferirListaNova = () => {
    setAssinaturaVista(assinaturaAgora);
    guardarListaConferida(orderId, sincronia.confirmado_em, assinaturaAgora);
  };

  // O Control está em dia: nada a dizer.
  if (!d.mudou) return null;

  const jaPediu = Boolean(sincronia.pedido_em);
  // A venda interna mudou o pedido DE NOVO depois do último aviso: a lista abaixo
  // tem mudança que ninguém avisou. Pela impressão guardada no aviso, não pela
  // data de alteração do pedido — carimbo de faturado e correção de número
  // também mexem nessa data e acendiam a frase sem mudança nenhuma.
  const mudouDepoisDoAviso =
    jaPediu && !faturado && !!sincronia.assinatura_pedida && sincronia.assinatura_pedida !== assinaturaAgora;

  const quando = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

  return (
    <div className="rounded-xl border border-warn/40 bg-warn-soft p-4 shadow-sm">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn-soft-foreground" strokeWidth={2.5} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug text-warn-soft-foreground">
            {faturado
              ? 'A nota saiu com o pedido diferente do que está no Control'
              : 'O Control está com a versão antiga deste pedido'}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-warn-soft-foreground/90">
            {faturado
              ? `O pedido mudou depois do lançamento${numeroNoControl ? ` como ${numeroNoControl}` : ''} e foi faturado antes de alguém atualizar lá. Confira a nota com o financeiro.`
              : `O pedido mudou depois que foi lançado${numeroNoControl ? ` como ${numeroNoControl}` : ''}. Enquanto a fábrica não atualizar lá, a nota sai pelo pedido velho.`}
          </p>

          {/* O que exatamente mudou: é a lista que a pessoa vai digitar no
              Control, então ela precisa estar aqui, e não "veja o pedido". */}
          <ul className="mt-3 divide-y divide-warn/30 border-y border-warn/30">
            {d.itens.linhas.map((l) => (
              <li key={l.chave} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-sm text-warn-soft-foreground">
                  <span className="font-mono font-semibold">{l.ref || '—'}</span>
                  {l.tamanho ? <span className="opacity-80"> · {l.tamanho}</span> : null}
                </span>
                <span className="tnum shrink-0 text-sm text-warn-soft-foreground">
                  {l.antes} <span className="opacity-60">para</span>{' '}
                  <span className="font-semibold">{l.depois}</span>
                </span>
              </li>
            ))}
            {d.desconto && (
              <li className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-sm text-warn-soft-foreground">Desconto do pedido</span>
                <span className="tnum shrink-0 text-sm text-warn-soft-foreground">
                  {pct(d.desconto.antes)} <span className="opacity-60">para</span>{' '}
                  <span className="font-semibold">{pct(d.desconto.depois)}</span>
                </span>
              </li>
            )}
            {d.condicaoMudou && (
              <li className="py-1.5 text-sm text-warn-soft-foreground">A condição de pagamento mudou</li>
            )}
            {d.observacaoMudou && (
              <li className="py-1.5 text-sm text-warn-soft-foreground">A observação do pedido mudou</li>
            )}
          </ul>
          {d.itens.mudou && (
            <p className="tnum mt-1.5 text-xs text-warn-soft-foreground/80">
              No Control: {d.itens.pecasAntes} peças
              {sincronia.total != null ? ` · ${formatBRL(sincronia.total)}` : ''}. Aqui: {d.itens.pecasDepois}{' '}
              peças.
            </p>
          )}

          {jaPediu && (
            <p className="mt-2 rounded-lg bg-card/60 px-2.5 py-1.5 text-xs text-warn-soft-foreground">
              Atualização pedida em {quando(sincronia.pedido_em as string)}
              {sincronia.observacao ? `: “${sincronia.observacao}”` : '.'}
              {mudouDepoisDoAviso ? (
                <span className="mt-1 block font-semibold">
                  A venda interna mudou o pedido de novo depois desse aviso. A lista acima já tem a mudança nova — confira
                  tudo, não só o que foi avisado.
                </span>
              ) : null}
            </p>
          )}

          {mudouDeNovo && !faturado && (
            <div className="mt-2 rounded-lg border border-danger/40 bg-danger-soft px-2.5 py-2 text-xs text-danger-soft-foreground">
              <p className="font-semibold">O pedido mudou depois que você conferiu a lista.</p>
              <p className="mt-0.5">Confira a lista acima outra vez antes de dizer que atualizou o Control.</p>
              <button
                type="button"
                onClick={conferirListaNova}
                className="mt-1.5 font-semibold underline"
              >
                Conferi a lista nova
              </button>
            </div>
          )}

          {erro && (
            <p className="mt-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-soft-foreground">
              {erro}
            </p>
          )}

          {escrevendo && !faturado && (
            <div className="mt-3">
              <label htmlFor="erp-obs" className="text-xs font-medium text-warn-soft-foreground">
                Recado para quem vai mexer no Control (opcional)
              </label>
              <Textarea
                id="erp-obs"
                value={observacao}
                rows={2}
                maxLength={500}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: tirei 6 peças da 0124, faltou no estoque."
                className="mt-1"
              />
            </div>
          )}

          {!faturado && (podeConfirmar || podePedir) && (
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {podeConfirmar && (
                <Button
                  variant="outline"
                  disabled={ocupado || mudouDeNovo}
                  onClick={() => onConfirmar(assinaturaVista ?? assinaturaAgora)}
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  Já atualizei no Control
                </Button>
              )}
              {podePedir && !escrevendo && (
                <Button disabled={ocupado} onClick={() => setEscrevendo(true)}>
                  <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
                  {jaPediu ? 'Avisar de novo' : 'Atualizar no ERP'}
                </Button>
              )}
              {podePedir && escrevendo && (
                <Button disabled={ocupado} onClick={() => onPedir(observacao)}>
                  <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
                  {ocupado ? 'Avisando…' : 'Avisar a fábrica'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
