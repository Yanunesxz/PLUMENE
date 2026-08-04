import { AlertTriangle } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';

interface Props {
  /** Título já pronto, nomeando a tabela. Ex.: "Cadastrar X na TABELA 03 - 2027?" */
  titulo: string;
  /** Uma ou duas frases dizendo o que muda na prática. */
  detalhe: string;
  /** Vai no botão de confirmar — é a segunda vez que o nome aparece. */
  tabela: string;
  /**
   * Substitui o rótulo do botão. Só para o caso em que não há nome a repetir:
   * cliente sem tabela cadastrada. Aí o botão assume o risco em palavras
   * ("Criar assim mesmo") em vez de fingir que existe uma tabela.
   */
  rotuloConfirmar?: string;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/**
 * Segundo dos dois avisos: a confirmação antes de gravar.
 *
 * O nome da tabela aparece no título E no botão. É de propósito: obriga a ler o
 * nome duas vezes sem transformar o cadastro numa burocracia de digitar código,
 * que o representante faz o dia inteiro em campo, no celular.
 *
 * Cancelar é o botão maior e o clique fora fecha. A saída fácil é a segura.
 */
export function ConfirmarTabela({
  titulo,
  detalhe,
  tabela,
  rotuloConfirmar,
  ocupado,
  onConfirmar,
  onCancelar,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="absolute inset-0 bg-foreground/40" onClick={onCancelar} aria-hidden />
      <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-warn bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn-soft-foreground">
            <AlertTriangle className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{detalhe}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={ocupado}>
            {ocupado ? (
              <>
                <Spinner />
                Salvando…
              </>
            ) : (
              (rotuloConfirmar ?? `Sim, ${tabela}`)
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
