import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Award, Search, Target, TrendingDown, TrendingUp, Trophy, Wallet } from 'lucide-react';
import {
  competenciaAnterior,
  competenciaDe,
  desempenhoDoMes,
  enviadoNoMes,
  type ApiResponse,
  type DesempenhoDoMes,
  type FaixaDeBonus,
  type Order,
  type RepListItem,
} from '@csb/shared';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/interface/Badge.js';
import { Input } from '../../components/interface/Input.js';
import { Select } from '../../components/interface/Select.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { cn, formatBRL, formatBRLCurto } from '../../lib/utils.js';

/**
 * DASHBOARD — as metas e o desempenho da EQUIPE num relance.
 *
 * Pedido do Yan (19/10/2026): "uma nova aba lateral escrito dashboard para o
 * gerente comercial conseguir visualizar em massa como está as metas dos
 * representantes, para ver desempenho".
 *
 * Só leitura. O "enviado" é a conta da Minha Área do rep (`desempenhoDoMes`,
 * shared) e as faixas são as que valem no mês (`GET /reps/metas`) — o gerente
 * vê exatamente a régua que cada um vê no celular.
 */

interface MetasDoMes {
  competencia: string;
  disponivel: boolean;
  metas: { user_id: string; faixas: FaixaDeBonus[] }[];
}

type Filtro = 'todos' | 'bateram' | 'perto' | 'abaixo' | 'sem_meta';
type Ordem = 'meta' | 'enviado' | 'nome';

interface Linha {
  rep: RepListItem;
  faixas: FaixaDeBonus[];
  d: DesempenhoDoMes;
  anterior: number;
}

/** Os últimos 12 meses, do atual para trás. */
function mesesEscolhiveis(): { valor: string; rotulo: string }[] {
  const hoje = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const data = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const rotulo = data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return { valor: competenciaDe(data), rotulo: rotulo.charAt(0).toUpperCase() + rotulo.slice(1) };
  });
}

function mesCurto(competencia: string): string {
  const [a, m] = competencia.split('-');
  return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

/** "Perto" = já passou de 70% do caminho até a próxima faixa. */
function situacao(l: Linha): Filtro {
  if (l.faixas.length === 0) return 'sem_meta';
  if (l.d.faixa) return 'bateram';
  const primeira = l.faixas[0]!;
  return l.d.enviado >= primeira.meta * 0.7 ? 'perto' : 'abaixo';
}

export function PaginaDashboard() {
  const { token } = useAuthStore();
  const meses = useMemo(mesesEscolhiveis, []);
  const [competencia, setCompetencia] = useState(competenciaDe());
  const [reps, setReps] = useState<RepListItem[] | null>(null);
  const [metas, setMetas] = useState<MetasDoMes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ordem, setOrdem] = useState<Ordem>('meta');

  const pedidos = useLiveQuery(() => db.orders.toArray(), []);

  // Os pedidos da empresa inteira (o gerente recebe todos) — relidos ao abrir.
  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<Order[]>>('/orders', token)
      .then((r) => db.orders.bulkPut(r.data))
      .catch(() => {
        /* offline: fica o cache */
      });
    api
      .get<ApiResponse<RepListItem[]>>('/reps', token)
      .then((r) => setReps(r.data))
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Não deu para carregar os representantes.'));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setMetas(null);
    api
      .get<ApiResponse<MetasDoMes>>(`/reps/metas?competencia=${competencia}`, token)
      .then((r) => vivo && setMetas(r.data))
      .catch(() => vivo && setMetas({ competencia, disponivel: false, metas: [] }));
    return () => {
      vivo = false;
    };
  }, [token, competencia]);

  const linhas = useMemo<Linha[]>(() => {
    if (!reps || !pedidos) return [];
    const faixasDe = new Map((metas?.metas ?? []).map((m) => [m.user_id, m.faixas]));
    const porRep = new Map<string, Order[]>();
    for (const o of pedidos) porRep.set(o.rep_id, [...(porRep.get(o.rep_id) ?? []), o]);
    const anterior = competenciaAnterior(competencia);
    return reps
      .map((rep) => {
        const dele = porRep.get(rep.id) ?? [];
        const faixas = faixasDe.get(rep.id) ?? [];
        return {
          rep,
          faixas,
          d: desempenhoDoMes(dele, faixas, competencia),
          anterior: enviadoNoMes(dele, anterior),
        };
      })
      // Rep desligado só aparece se vendeu no mês: o histórico dele conta.
      .filter((l) => l.rep.active || l.d.pedidos > 0);
  }, [reps, pedidos, metas, competencia]);

  const resumo = useMemo(() => {
    const comMeta = linhas.filter((l) => l.faixas.length > 0);
    const enviado = linhas.reduce((s, l) => s + l.d.enviado, 0);
    const anterior = linhas.reduce((s, l) => s + l.anterior, 0);
    return {
      enviado,
      variacao: anterior > 0 ? (enviado - anterior) / anterior : null,
      bonus: linhas.reduce((s, l) => s + (l.d.faixa?.bonus ?? 0), 0),
      bateram: comMeta.filter((l) => l.d.faixa).length,
      comMeta: comMeta.length,
      faturado: linhas.reduce((s, l) => s + l.d.faturado, 0),
      contagem: {
        todos: linhas.length,
        bateram: linhas.filter((l) => situacao(l) === 'bateram').length,
        perto: linhas.filter((l) => situacao(l) === 'perto').length,
        abaixo: linhas.filter((l) => situacao(l) === 'abaixo').length,
        sem_meta: linhas.filter((l) => situacao(l) === 'sem_meta').length,
      } as Record<Filtro, number>,
    };
  }, [linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = linhas
      .filter((l) => filtro === 'todos' || situacao(l) === filtro)
      .filter((l) => !q || l.rep.name.toLowerCase().includes(q));
    const porNome = (a: Linha, b: Linha) => a.rep.name.localeCompare(b.rep.name, 'pt-BR');
    if (ordem === 'nome') return [...lista].sort(porNome);
    if (ordem === 'enviado') return [...lista].sort((a, b) => b.d.enviado - a.d.enviado || porNome(a, b));
    // "Mais perto da meta": quem tem meta primeiro, pela posição na régua.
    return [...lista].sort(
      (a, b) =>
        Number(b.faixas.length > 0) - Number(a.faixas.length > 0) ||
        b.d.posicao - a.d.posicao ||
        b.d.enviado - a.d.enviado,
    );
  }, [linhas, filtro, busca, ordem]);

  const mesAtual = competencia === competenciaDe();
  const carregando = reps === null || pedidos === undefined;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Metas e desempenho dos representantes.</p>
        </div>
        <Select
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
          aria-label="Mês"
          className="w-48"
        >
          {meses.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </Select>
      </div>

      {erro && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>}
      {metas && !metas.disponivel && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-soft-foreground">
          As metas não puderam ser lidas — os números de venda aparecem, as réguas não.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          icone={TrendingUp}
          tom="green"
          valor={formatBRLCurto(resumo.enviado)}
          rotulo="Enviado pela equipe"
          detalhe={
            resumo.variacao === null
              ? undefined
              : `${resumo.variacao >= 0 ? '▲' : '▼'} ${Math.abs(resumo.variacao * 100).toFixed(0)}% vs ${mesCurto(competenciaAnterior(competencia))}`
          }
          detalheBom={resumo.variacao === null ? undefined : resumo.variacao >= 0}
        />
        <Indicador
          icone={Trophy}
          tom="brand"
          valor={`${resumo.bateram} de ${resumo.comMeta}`}
          rotulo="Bateram a 1ª faixa"
        />
        <Indicador icone={Award} tom="yellow" valor={formatBRLCurto(resumo.bonus)} rotulo="Bônus garantidos" />
        <Indicador icone={Wallet} tom="brand" valor={formatBRLCurto(resumo.faturado)} rotulo="Faturado no mês" />
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {(
            [
              ['todos', 'Todos'],
              ['bateram', 'Bateram'],
              ['perto', 'Perto'],
              ['abaixo', 'Abaixo'],
              ['sem_meta', 'Sem meta'],
            ] as [Filtro, string][]
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setFiltro(valor)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                filtro === valor
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:bg-muted',
              )}
            >
              {rotulo} ({resumo.contagem[valor]})
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="relative flex-1 md:w-56 md:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar representante"
              className="pl-9"
              aria-label="Buscar representante"
            />
          </label>
          <Select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar" className="w-44">
            <option value="meta">Mais perto da meta</option>
            <option value="enviado">Maior enviado</option>
            <option value="nome">Nome</option>
          </Select>
        </div>
      </div>

      {carregando ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum representante neste filtro.
        </p>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {visiveis.map((l, i) => (
            <CartaoDoRepresentante
              key={l.rep.id}
              linha={l}
              posicao={ordem === 'nome' ? null : i + 1}
              mesAtual={mesAtual}
              mesAnterior={mesCurto(competenciaAnterior(competencia))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CartaoDoRepresentante({
  linha: l,
  posicao,
  mesAtual,
  mesAnterior,
}: {
  linha: Linha;
  posicao: number | null;
  mesAtual: boolean;
  mesAnterior: string;
}) {
  const { d, faixas } = l;
  const variacao = l.anterior > 0 ? (d.enviado - l.anterior) / l.anterior : null;
  const s = situacao(l);
  const selo: Record<Filtro, { texto: string; variante: 'green' | 'yellow' | 'red' | 'gray' }> = {
    bateram: { texto: `Faixa ${d.numeroDaFaixa} de ${faixas.length}`, variante: 'green' },
    perto: { texto: 'Perto da 1ª faixa', variante: 'yellow' },
    abaixo: { texto: 'Abaixo da meta', variante: 'red' },
    sem_meta: { texto: 'Sem meta no mês', variante: 'gray' },
    todos: { texto: '', variante: 'gray' },
  };

  return (
    // `min-w-0`: item de grid não encolhe abaixo do conteúdo sem isto, e o
    // nome comprido empurrava o cartão para fora da tela do celular.
    <li className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {posicao !== null && (
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                posicao <= 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {posicao}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">{l.rep.name}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge variant={selo[s].variante}>{selo[s].texto}</Badge>
              {l.rep.venda_interna && <Badge variant="brand">Venda interna</Badge>}
              {!l.rep.active && <Badge variant="gray">Desligado</Badge>}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold leading-tight text-foreground">{formatBRLCurto(d.enviado)}</p>
          {variacao !== null ? (
            <p
              className={cn(
                'flex items-center justify-end gap-1 text-xs font-medium',
                variacao >= 0 ? 'text-positive' : 'text-danger',
              )}
            >
              {variacao >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(variacao * 100).toFixed(0)}% vs {mesAnterior}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">enviado</p>
          )}
        </div>
      </div>

      {faixas.length > 0 ? (
        <div className="mt-4">
          <Regua posicao={d.posicao} faixas={faixas} enviado={d.enviado} />
          <p className="mt-2 text-xs text-muted-foreground">
            {d.faixa ? (
              <>
                Bônus garantido{' '}
                <span className="font-semibold text-foreground">{formatBRL(d.faixa.bonus)}</span>
                {d.proxima ? ` · faltam ${formatBRL(d.falta)} para ${formatBRL(d.proxima.bonus)}` : ' · bateu a última faixa'}
              </>
            ) : (
              d.proxima && (
                <>
                  Faltam <span className="font-semibold text-foreground">{formatBRL(d.falta)}</span> para a 1ª faixa (
                  {formatBRL(d.proxima.bonus)})
                </>
              )
            )}
          </p>
          {mesAtual && d.enviado > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              <Target className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
              No ritmo de agora fecha o mês em{' '}
              <span className="font-semibold text-foreground">{formatBRLCurto(d.projecao)}</span>
              {d.faixaProjetada
                ? ` → faixa de ${formatBRLCurto(d.faixaProjetada.meta)} (bônus ${formatBRL(d.faixaProjetada.bonus)})`
                : ' → não chega à 1ª faixa'}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem faixas cadastradas para este mês — cadastre em Representantes → Meta.
        </p>
      )}

      <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-border pt-3 text-center">
        <Numero rotulo="Pedidos" valor={String(d.pedidos)} />
        <Numero rotulo="Clientes" valor={String(d.clientes)} />
        <Numero rotulo="Ticket" valor={formatBRLCurto(d.ticketMedio)} />
        <Numero rotulo="Faturado" valor={formatBRLCurto(d.faturado)} />
      </dl>
    </li>
  );
}

/** A régua em passos iguais por faixa — a mesma lógica da régua do rep. */
function Regua({ posicao, faixas, enviado }: { posicao: number; faixas: FaixaDeBonus[]; enviado: number }) {
  return (
    <div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', posicao >= 1 / faixas.length ? 'bg-positive' : 'bg-warn')}
          style={{ width: `${Math.min(100, Math.max(0, posicao * 100))}%` }}
        />
        {faixas.slice(0, -1).map((_, i) => (
          <span
            key={i}
            className="absolute top-0 h-full w-0.5 bg-card"
            style={{ left: `${((i + 1) / faixas.length) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1 grid text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${faixas.length}, minmax(0, 1fr))` }}>
        {faixas.map((f) => (
          <span key={f.meta} className={cn('text-right', enviado >= f.meta && 'font-semibold text-foreground')}>
            {formatBRLCurto(f.meta)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-sm font-semibold text-foreground">{valor}</dd>
    </div>
  );
}

function Indicador({
  icone: Icone,
  tom,
  valor,
  rotulo,
  detalhe,
  detalheBom,
}: {
  icone: typeof TrendingUp;
  tom: 'green' | 'yellow' | 'brand';
  valor: string;
  rotulo: string;
  detalhe?: string | undefined;
  detalheBom?: boolean | undefined;
}) {
  const tons: Record<string, string> = {
    green: 'bg-positive-soft text-positive-soft-foreground',
    yellow: 'bg-warn-soft text-warn-soft-foreground',
    brand: 'bg-primary-soft text-primary-soft-foreground',
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full ${tons[tom]}`}>
        <Icone className="h-5 w-5" strokeWidth={2} />
      </div>
      <p className="truncate text-xl font-bold text-foreground">{valor}</p>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      {detalhe && (
        <p className={cn('mt-1 text-xs font-medium', detalheBom ? 'text-positive' : 'text-danger')}>{detalhe}</p>
      )}
    </div>
  );
}
