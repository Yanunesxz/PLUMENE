import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  FAIXAS_PADRAO,
  MAX_FAIXAS_DE_BONUS,
  competenciaDe,
  faixasVigentes,
  normalizarFaixas,
  type ApiResponse,
  type FaixaDeBonus,
  type MetaDoRepresentante,
} from '@csb/shared';
import { api } from '../../services/api.js';
import { Button } from '../interface/Button.js';
import { Input } from '../interface/Input.js';
import { ReguaDaMeta } from './ReguaDaMeta.js';
import { formatBRLCurto } from '../../lib/utils.js';

/** Linha da grade. Texto, não número: campo vazio precisa poder existir. */
interface Linha {
  meta: string;
  bonus: string;
}

const vazia = (): Linha => ({ meta: '', bonus: '' });

/** Os últimos 12 meses mais os 3 seguintes — o gerente adianta o mês que vem. */
function mesesEscolhiveis(): { valor: string; rotulo: string }[] {
  const hoje = new Date();
  const meses = [];
  for (let d = -12; d <= 3; d++) {
    const data = new Date(hoje.getFullYear(), hoje.getMonth() + d, 1);
    meses.push({
      valor: competenciaDe(data),
      rotulo: data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    });
  }
  return meses.reverse();
}

/**
 * Cadastro da bonificação de UM representante, mês a mês.
 *
 * A meta não é a mesma para todo mundo e muda ao longo do ano, então quem
 * cadastra é o gerente, aqui. São até quatro faixas; ele decide quantas existem,
 * e a ordem sai do próprio valor — cadastrar 80 antes de 50 não quebra nada.
 *
 * A régua de verdade fica ao lado enquanto ele digita. É o mesmo componente que
 * o representante vê: assim ninguém cadastra às cegas e descobre depois que os
 * degraus ficaram esquisitos.
 */
export function PainelDaMeta({
  repId,
  repNome,
  token,
  onFechar,
  onAviso,
}: {
  repId: string;
  repNome: string;
  token: string;
  onFechar: () => void;
  onAviso: (mensagem: string, erro?: boolean) => void;
}) {
  const meses = useMemo(mesesEscolhiveis, []);
  const [competencia, setCompetencia] = useState(competenciaDe());
  const [historico, setHistorico] = useState<MetaDoRepresentante[] | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([vazia()]);
  const [salvando, setSalvando] = useState(false);
  const [disponivel, setDisponivel] = useState(true);

  useEffect(() => {
    api
      .get<ApiResponse<{ metas: MetaDoRepresentante[]; disponivel: boolean }>>(
        `/reps/${repId}/meta`,
        token,
      )
      .then((r) => {
        setHistorico(r.data.metas);
        setDisponivel(r.data.disponivel);
      })
      .catch(() => setHistorico([]));
  }, [repId, token]);

  // Ao trocar de mês, a grade mostra o que aquele mês tem. Mês sem cadastro
  // próprio começa com o que ele HERDA — o gerente edita a partir do que está
  // valendo, em vez de digitar tudo de novo.
  useEffect(() => {
    if (historico === null) return;
    const doMes = historico.find((m) => m.competencia === competencia);
    const base = doMes?.faixas ?? faixasVigentes(historico, competencia);
    setLinhas(
      base.length > 0
        ? base.map((f) => ({ meta: String(f.meta), bonus: String(f.bonus) }))
        : [vazia()],
    );
  }, [competencia, historico]);

  const cadastradoNesteMes = historico?.some((m) => m.competencia === competencia) ?? false;
  const herdadoDe = cadastradoNesteMes
    ? null
    : (historico ?? [])
        .filter((m) => m.competencia < competencia)
        .sort((a, b) => a.competencia.localeCompare(b.competencia))
        .at(-1)?.competencia;

  const faixas: FaixaDeBonus[] = normalizarFaixas(
    linhas.map((l) => ({ meta: Number(l.meta), bonus: Number(l.bonus) })),
  );

  const trocar = (i: number, campo: keyof Linha) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLinhas((prev) => prev.map((l, j) => (i === j ? { ...l, [campo]: e.target.value } : l)));

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await api.put<ApiResponse<FaixaDeBonus[]> & { warning?: string }>(
        `/reps/${repId}/meta`,
        { competencia, faixas },
        token,
      );
      setHistorico((prev) => [
        { competencia, faixas: r.data },
        ...(prev ?? []).filter((m) => m.competencia !== competencia),
      ]);
      onAviso(
        r.warning ??
          (r.data.length === 0
            ? `${repNome} fica sem bonificação neste mês.`
            : `Meta de ${repNome} salva.`),
        Boolean(r.warning),
      );
    } catch {
      onAviso('Não deu para salvar a meta. Verifique a conexão.', true);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="titulo text-[20px] leading-tight text-foreground">Meta de {repNome}</h2>
          <p className="text-sm text-muted-foreground">
            Até {MAX_FAIXAS_DE_BONUS} faixas. O mês que você não cadastrar repete o último.
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {!disponivel && (
        <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-soft-foreground">
          A migração 021 ainda não foi aplicada no banco — dá para montar aqui, mas não grava.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label className="text-sm font-medium text-foreground" htmlFor="competencia">
            Mês
          </label>
          <select
            id="competencia"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {meses.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {cadastradoNesteMes
              ? 'Este mês tem cadastro próprio.'
              : herdadoDe
                ? `Herdando de ${rotuloDoMes(herdadoDe)}. Salvar cria o cadastro deste mês.`
                : 'Nenhum mês cadastrado ainda.'}
          </p>

          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-[1fr_1fr_36px] gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Meta em pedidos</span>
              <span>Bônus</span>
              <span />
            </div>
            {linhas.map((linha, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_36px] items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  inputMode="numeric"
                  value={linha.meta}
                  onChange={trocar(i, 'meta')}
                  placeholder="50000"
                  aria-label={`Meta da faixa ${i + 1}`}
                />
                <Input
                  type="number"
                  min={0}
                  step={100}
                  inputMode="numeric"
                  value={linha.bonus}
                  onChange={trocar(i, 'bonus')}
                  placeholder="500"
                  aria-label={`Bônus da faixa ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() => setLinhas((p) => (p.length === 1 ? [vazia()] : p.filter((_, j) => j !== i)))}
                  aria-label={`Remover faixa ${i + 1}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={linhas.length >= MAX_FAIXAS_DE_BONUS}
              onClick={() => setLinhas((p) => [...p, vazia()])}
            >
              <Plus className="h-4 w-4" /> Faixa
            </Button>
            {linhas.length >= MAX_FAIXAS_DE_BONUS && (
              <span className="text-xs text-muted-foreground">
                Quatro é o máximo que cabe na régua.
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setLinhas(FAIXAS_PADRAO.map((f) => ({ meta: String(f.meta), bonus: String(f.bonus) })))
              }
            >
              Usar as do aviso
            </Button>
          </div>
        </div>

        {/* A régua de verdade, com um exemplo de quanto ele já enviou — o gerente
            vê onde os degraus caem antes de salvar. */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Como {repNome.split(' ')[0]} vai ver{' '}
            <span className="normal-case tracking-normal text-subtle">
              — exemplo, não é o que ele enviou
            </span>
          </p>
          {faixas.length > 0 ? (
            <ReguaDaMeta enviadoNoMes={Math.round(faixas[0]!.meta * 0.7)} faixas={faixas} />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              Sem faixa preenchida, o representante não vê régua nenhuma — nenhum bônus é prometido
              a ele neste mês.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <p className="mr-auto text-xs text-muted-foreground">
          {faixas.length > 0
            ? `${faixas.length} ${faixas.length === 1 ? 'faixa' : 'faixas'} · maior bônus ${formatBRLCurto(
                faixas.at(-1)!.bonus,
              )}`
            : 'Nenhuma faixa — mês sem bonificação.'}
        </p>
        <Button type="button" variant="outline" onClick={onFechar}>
          Fechar
        </Button>
        <Button type="button" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Salvando…' : 'Salvar meta'}
        </Button>
      </div>
    </div>
  );
}

function rotuloDoMes(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}
