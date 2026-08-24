import { useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { useAtualizacao } from '../../hooks/useAtualizacao.js';
import { aplicarAtualizacao } from '../../lib/atualizarApp.js';

/**
 * A faixa "versão nova pronta", em TODAS as telas.
 *
 * A troca automática espera um momento seguro (o app sair da frente) — e há
 * aparelhos em que esse momento nunca chega: o computador da fábrica fica com
 * a tela de pedidos aberta o dia inteiro, e a versão nova baixada fica
 * esperando para sempre. Foi assim que três atualizações seguidas "não
 * chegaram" para o Yan em 19/08/2026, com o deploy no ar e o aparelho preso
 * no app antigo.
 *
 * A faixa só aparece quando a versão nova JÁ ESTÁ baixada ('disponivel') — um
 * toque aplica na hora. Quem ignora continua protegido pela troca automática.
 */
export function AvisoDeAtualizacao() {
  const estado = useAtualizacao();
  const [aplicando, setAplicando] = useState(false);

  if (estado !== 'disponivel') return null;

  const aplicar = () => {
    setAplicando(true);
    void aplicarAtualizacao();
  };

  return (
    <button
      type="button"
      onClick={aplicar}
      disabled={aplicando}
      className="flex w-full items-center justify-center gap-2 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <ArrowDownToLine className="h-4 w-4" strokeWidth={2.5} />
      {aplicando ? 'Atualizando…' : 'Versão nova pronta — toque para atualizar'}
    </button>
  );
}
