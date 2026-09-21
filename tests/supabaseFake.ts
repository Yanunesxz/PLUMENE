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
  operacao: 'insert' | 'update' | 'delete' | 'upsert';
  valores: unknown;
}

export interface Filtro {
  tabela: string;
  metodo: string;
  args: unknown[];
}

/**
 * Uma consulta inteira, como o service a montou — o que um `Responder` recebe
 * na hora do `await`, com todos os filtros já aplicados.
 */
export interface ConsultaFeita {
  tabela: string;
  /** `select` quando não houve insert/update/delete/upsert. */
  operacao: 'select' | Gravacao['operacao'];
  /** O que foi passado ao insert/update/upsert (undefined no select e no delete). */
  valores: unknown;
  /** Os métodos encadeados, na ordem (inclui o `select` e o `order`). */
  filtros: Array<{ metodo: string; args: unknown[] }>;
  /** Terminou em `single()`/`maybeSingle()`. */
  umaLinha: boolean;
}

/**
 * Resposta calculada na hora, a partir da consulta montada. Para testes que
 * precisam de um banco que REAGE (um UPDATE condicional que só afeta a linha
 * se o valor ainda bate, por exemplo) em vez de uma fila de respostas.
 */
export type Responder = (consulta: ConsultaFeita) => RespostaTabela;

type Respostas = Record<string, RespostaTabela | RespostaTabela[] | Responder>;

export function criarSupabaseFake(respostas: Respostas) {
  const gravacoes: Gravacao[] = [];
  const filtros: Filtro[] = [];
  // Uma tabela pode ser consultada várias vezes com respostas diferentes; nesse
  // caso o teste passa um array e cada consulta consome a próxima.
  const filas = new Map<string, RespostaTabela[]>();
  const responders = new Map<string, Responder>();
  for (const [tabela, r] of Object.entries(respostas)) {
    if (typeof r === 'function') responders.set(tabela, r);
    else filas.set(tabela, Array.isArray(r) ? [...r] : [r]);
  }

  const proxima = (tabela: string): RespostaTabela => {
    const fila = filas.get(tabela);
    if (!fila || fila.length === 0) return { data: null, error: null, count: 0 };
    return fila.length === 1 ? fila[0]! : fila.shift()!;
  };

  const from = (tabela: string) => {
    const responder = responders.get(tabela);
    // Com responder não há fila: a resposta sai na hora do `await`.
    let resposta = responder ? { data: null, error: null } : proxima(tabela);
    const consulta: ConsultaFeita = { tabela, operacao: 'select', valores: undefined, filtros: [], umaLinha: false };

    const query: Record<string, unknown> = {};
    const encadeia = [
      'select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'range', 'limit',
      'lt', 'gt', 'gte', 'lte', 'ilike', 'filter', 'match',
    ];
    for (const metodo of encadeia) {
      query[metodo] = (...args: unknown[]) => {
        filtros.push({ tabela, metodo, args });
        consulta.filtros.push({ metodo, args });
        return query;
      };
    }

    const grava = (operacao: Gravacao['operacao'], valores: unknown) => {
      gravacoes.push({ tabela, operacao, valores });
      consulta.operacao = operacao;
      consulta.valores = operacao === 'delete' ? undefined : valores;
      return query;
    };
    query['insert'] = (valores: unknown) => grava('insert', valores);
    // O upsert do PostgREST: grava por cima quando a chave ja existe. Fica
    // separado do insert para o teste conseguir distinguir os dois.
    query['upsert'] = (valores: unknown) => grava('upsert', valores);
    query['update'] = (valores: unknown) => grava('update', valores);
    query['delete'] = () => grava('delete', null);

    const entrega = () => {
      if (responder) return responder(consulta);
      const r = resposta;
      resposta = proxima(tabela); // consultas seguintes na mesma tabela avançam
      return r;
    };
    const um = () => {
      consulta.umaLinha = true;
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
