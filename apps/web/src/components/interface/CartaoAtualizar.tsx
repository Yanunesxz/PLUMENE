import { useState } from 'react';
import { ArrowDownToLine, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAtualizacao } from '../../hooks/useAtualizacao.js';
import { aplicarAtualizacao, procurarAtualizacao, versaoDoApp } from '../../lib/atualizarApp.js';
import { Button } from './Button.js';
import { Spinner } from './Spinner.js';

/**
 * Versão do app, na "Minha área".
 *
 * O app se atualiza sozinho e sem avisar (ver `atualizarApp.ts`) — este cartão
 * não pede nada a ninguém, e de propósito não tem cor de alerta: quem chega
 * aqui não precisa fazer nada. Ele existe para as duas horas em que a espera
 * pelo momento seguro não serve: quando o gerente acabou de publicar e quer o
 * representante na versão nova AGORA, e quando alguém liga dizendo que "está
 * diferente do meu aqui" — a data da versão responde na hora de quem é o
 * atraso.
 */
export function CartaoAtualizar() {
  const estado = useAtualizacao();
  const [conferido, setConferido] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const versao = versaoDoApp();

  const pronta = estado === 'disponivel';
  const procurando = estado === 'procurando';

  const atualizar = () => {
    setAtualizando(true);
    void aplicarAtualizacao();
  };

  const procurar = async () => {
    setConferido(false);
    // Achou: já emenda na troca. Quem tocou no botão está pedindo a versão nova
    // agora — esperar o momento seguro é para quem não pediu nada.
    if (await procurarAtualizacao()) atualizar();
    else setConferido(true);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive-soft-foreground">
            {pronta ? (
              <ArrowDownToLine className="h-5 w-5" strokeWidth={2} />
            ) : (
              <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">Versão do aplicativo</p>
            <p className="text-xs text-muted-foreground">
              {pronta
                ? 'Versão nova pronta — entra sozinha assim que você parar de usar.'
                : conferido
                  ? 'Você já está na versão mais nova.'
                  : versao
                    ? `Instalada em ${versao}`
                    : 'Atualiza sozinho quando sai versão nova.'}
            </p>
          </div>
        </div>

        {pronta ? (
          <Button size="md" className="shrink-0" disabled={atualizando} onClick={atualizar}>
            <ArrowDownToLine className="h-4 w-4" strokeWidth={2.5} />
            {atualizando ? 'Atualizando…' : 'Atualizar agora'}
          </Button>
        ) : (
          <Button
            size="md"
            variant="outline"
            className="shrink-0"
            disabled={procurando}
            onClick={() => void procurar()}
          >
            {procurando ? <Spinner /> : <RefreshCw className="h-4 w-4" strokeWidth={2.5} />}
            {procurando ? 'Procurando…' : 'Procurar atualização'}
          </Button>
        )}
      </div>
    </div>
  );
}
