import { useEffect, useState } from 'react';
import { Eraser } from 'lucide-react';
import { limparCacheEReiniciar, pedidosEsperandoInternet } from '../../lib/limparCache.js';
import { Button } from './Button.js';
import { Spinner } from './Spinner.js';

/**
 * "Limpar cache" — na Minha Área e na página /limpar-cache (que abre até sem
 * login, para o aparelho que travou). Pede confirmação: a recarga tira a
 * pessoa da tela em que está. Ver `limparCache.ts` para o que sai e o que fica.
 */
export function CartaoLimparCache() {
  const [confirmando, setConfirmando] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const [semInternet, setSemInternet] = useState(false);
  const [naFila, setNaFila] = useState(0);

  useEffect(() => {
    if (confirmando) void pedidosEsperandoInternet().then(setNaFila);
  }, [confirmando]);

  const limpar = async () => {
    setSemInternet(false);
    setLimpando(true);
    const r = await limparCacheEReiniciar();
    if (!r.ok) {
      setLimpando(false);
      setSemInternet(true);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
            <Eraser className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">Limpar cache</p>
            <p className="text-xs text-muted-foreground">
              Apaga o que o app guardou neste aparelho e reinicia. Use quando algo estiver diferente do
              computador do escritório.
            </p>
          </div>
        </div>
        {!confirmando && (
          <Button size="md" variant="outline" className="shrink-0" onClick={() => setConfirmando(true)}>
            <Eraser className="h-4 w-4" strokeWidth={2.5} />
            Limpar cache
          </Button>
        )}
      </div>

      {confirmando && (
        <div className="mt-3 grid gap-3 rounded-lg bg-sunken p-3">
          <p className="text-sm text-foreground">
            O app vai baixar de novo o catálogo, os clientes e os pedidos e voltar para o início. Você continua
            logado, e o carrinho não se perde.
          </p>
          {naFila > 0 && (
            <p className="text-sm font-medium text-warn-soft-foreground">
              {naFila === 1
                ? '1 pedido feito sem internet ainda não subiu — ele fica guardado e sobe quando a internet voltar.'
                : `${naFila} pedidos feitos sem internet ainda não subiram — eles ficam guardados e sobem quando a internet voltar.`}
            </p>
          )}
          {semInternet && (
            <p className="text-sm font-medium text-danger">
              Sem internet agora. Limpar o cache sem internet deixaria o app sem ter de onde abrir — tente quando
              o sinal voltar.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={limpando} onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
            <Button size="sm" disabled={limpando} onClick={() => void limpar()}>
              {limpando ? <Spinner /> : <Eraser className="h-4 w-4" strokeWidth={2.5} />}
              {limpando ? 'Limpando…' : 'Limpar e reiniciar'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
