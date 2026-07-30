/**
 * Dublê do cliente Supabase.
 *
 * Os services usam o construtor de query encadeado (`from().select().eq()…`) e
 * dão `await` no próprio construtor — ele é "thenable". O dublê imita isso:
 * qualquer método de filtro devolve ele mesmo e o `await` entrega a resposta que
 * o teste registrou para aquela tabela.
 *
 * Também guarda o que foi inserido/atualizado, para os testes conferirem o que
 * o service TENTOU gravar sem precisar de banco.
 */
export interface RespostaTabela {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

export interface Gravacao {
  tabela: string;
  operacao: 'insert' | 'update' | 'delete';
  valores: unknown;
}

export interface Filtro {
  tabela: string;
  metodo: string;
  args: unknown[];
}

type Respostas = Record<string, RespostaTabela | RespostaTabela[]>;

export function criarSupabaseFake(respostas: Respostas) {
  const gravacoes: Gravacao[] = [];
  const filtros: Filtro[] = [];
  // Uma tabela pode ser consultada várias vezes com respostas diferentes; nesse
  // caso o teste passa um array e cada consulta consome a próxima.
  const filas = new Map<string, RespostaTabela[]>();
  for (const [tabela, r] of Object.entries(respostas)) {
    filas.set(tabela, Array.isArray(r) ? [...r] : [r]);
  }

  const proxima = (tabela: string): RespostaTabela => {
    const fila = filas.get(tabela);
    if (!fila || fila.length === 0) return { data: null, error: null, count: 0 };
    return fila.length === 1 ? fila[0]! : fila.shift()!;
  };

  const from = (tabela: string) => {
    let resposta = proxima(tabela);

    const query: Record<string, unknown> = {};
    const encadeia = [
      'select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'range', 'limit',
      'lt', 'gt', 'gte', 'lte', 'ilike', 'filter', 'match',
    ];
    for (const metodo of encadeia) {
      query[metodo] = (...args: unknown[]) => {
        filtros.push({ tabela, metodo, args });
        return query;
      };
    }

    query['insert'] = (valores: unknown) => {
      gravacoes.push({ tabela, operacao: 'insert', valores });
      return query;
    };
    query['update'] = (valores: unknown) => {
      gravacoes.push({ tabela, operacao: 'update', valores });
      return query;
    };
    query['delete'] = () => {
      gravacoes.push({ tabela, operacao: 'delete', valores: null });
      return query;
    };

    const entrega = () => {
      const r = resposta;
      resposta = proxima(tabela); // consultas seguintes na mesma tabela avançam
      return r;
    };
    const um = () => {
      const r = entrega();
      const d = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
      return Promise.resolve({ ...r, data: d });
    };
    query['single'] = um;
    query['maybeSingle'] = um;
    query['then'] = (aoResolver: (v: RespostaTabela) => unknown, aoFalhar?: (e: unknown) => unknown) =>
      Promise.resolve(entrega()).then(aoResolver, aoFalhar);

    return query;
  };

  return {
    cliente: { from } as unknown as import('@supabase/supabase-js').SupabaseClient,
    gravacoes,
    filtros,
    /** Filtros aplicados numa tabela — para conferir COMO o service consultou. */
    filtrosDe(tabela: string, metodo?: string) {
      return filtros.filter((f) => f.tabela === tabela && (!metodo || f.metodo === metodo));
    },
    /** Última gravação feita numa tabela (ou undefined se não houve). */
    ultimaGravacao(tabela: string, operacao?: Gravacao['operacao']) {
      return [...gravacoes]
        .reverse()
        .find((g) => g.tabela === tabela && (!operacao || g.operacao === operacao));
    },
  };
}
