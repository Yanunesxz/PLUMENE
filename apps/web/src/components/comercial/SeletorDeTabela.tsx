import { AlertTriangle } from 'lucide-react';
import { tabelasEscolhiveis, type PriceTable } from '@csb/shared';

interface Props {
  tabelas: PriceTable[];
  valor: string;
  onEscolher: (id: string) => void;
  /** O que esta escolha vai precificar. Muda só a frase do aviso. */
  contexto: 'cliente' | 'link';
  /**
   * Mostra a escolha mesmo com UMA ativa. Só para a troca de tabela do cliente
   * que está numa tabela desligada no Control (`podeTrocarTabelaDoCliente`):
   * ali quem escolhe já vê as duas tabelas, e sem isto não teria como tirar o
   * cliente da desligada.
   */
  aceitaUma?: boolean;
}

/**
 * Primeiro dos dois avisos: o bloco amarelo onde a escolha acontece.
 *
 * Não renderiza nada com menos de duas tabelas — e isso não é economia de
 * tela, é a regra. Com uma tabela só não há escolha a fazer, e o campo
 * existindo já contaria ao representante que existem outras tabelas: saber o
 * preço da região vizinha é informação comercial que não pertence a ele. Não é
 * campo desabilitado; não está no DOM.
 *
 * Nada vem marcado de propósito. Vir com a principal já selecionada é
 * exatamente o erro caro: cadastro no piloto automático e o cliente da região 3
 * nascendo na tabela 2, sem ninguém perceber até a fatura.
 *
 * Tabela desligada no Control nunca vira opção, mesmo que alguém passe a lista
 * inteira: o filtro mora aqui também, não só em quem chama.
 */
export function SeletorDeTabela({ tabelas: recebidas, valor, onEscolher, contexto, aceitaUma = false }: Props) {
  const tabelas = tabelasEscolhiveis(recebidas);
  if (tabelas.length < (aceitaUma ? 1 : 2)) return null;

  return (
    <fieldset className="rounded-xl border border-warn/30 bg-warn-soft p-4">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-warn-soft-foreground">
        <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
        Tabela de preço
      </legend>
      <p className="mb-3 text-xs leading-relaxed text-warn-soft-foreground/90">
        {contexto === 'cliente'
          ? 'Isto define o preço de tudo que este cliente comprar. Confira antes de salvar.'
          : 'O link vai abrir com os preços desta tabela. Confira antes de gerar.'}
      </p>
      <div className="space-y-1.5">
        {tabelas.map((t) => (
          <label
            key={t.id}
            className={
              'flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors ' +
              (valor === t.id ? 'border-warn' : 'border-transparent hover:border-warn/40')
            }
          >
            <input
              type="radio"
              name={`tabela-${contexto}`}
              value={t.id}
              checked={valor === t.id}
              onChange={() => onEscolher(t.id)}
              className="h-4 w-4 accent-warn"
            />
            <span className="text-sm font-medium text-foreground">{t.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
