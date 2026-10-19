/**
 * A trava de canal das cargas do _tools: "este script ainda pode gravar?".
 *
 * A migração 048 deu a cada fluxo UM escritor por empresa (`companies.canal_*`).
 * Enquanto o canal está no padrão — 'carga' para cadastro, retrato e catálogo;
 * 'manual' para pedido e faturamento — quem manda é a carga à mão, que é
 * exatamente o que estes scripts fazem. Quando o Yan virar o canal para 'api'
 * (ou 'firebird'), quem manda passa a ser o Control, e rodar a carga de novo
 * regrava por cima do que ele mandou. Um dos scripts (tabelas-2027/carregar.mjs)
 * chega a APAGAR as tabelas de preço antigas.
 *
 * O jeito de ler é o mesmo do faturar-retroativo.mjs, o primeiro a ganhar a
 * trava: coluna ausente (a 048 ainda não rodou naquele banco) vale o padrão e
 * segue; erro de verdade PARA — na dúvida não grava.
 *
 * Os scripts são .mjs soltos e não enxergam o `lerCanais` da API
 * (apps/api/src/lib/canais.ts), então a régua está repetida aqui. Valor novo
 * lá entra aqui também.
 *
 * Este módulo não lê .env, não abre conexão e não escreve nada: o `db` vem de
 * fora. É o que deixa a trava ser testada (tests/canal-de-carga.test.ts), como
 * já acontece com importar-clientes-regras.mjs.
 */

/** A coluna de `companies` de cada canal (048, bloco B). */
export const COLUNA_DO_CANAL = {
  pedido_erp: 'canal_pedido_erp',
  faturamento: 'canal_faturamento',
  cadastro: 'canal_cadastro',
  retrato: 'canal_retrato',
  catalogo: 'canal_catalogo',
};

/** O valor que significa "a carga à mão ainda manda". É o padrão da 048. */
export const PADRAO_DO_CANAL = {
  pedido_erp: 'manual',
  faturamento: 'manual',
  cadastro: 'carga',
  retrato: 'carga',
  catalogo: 'carga',
};

/** Como o canal aparece na frase da recusa, e quem passa a mandar nele. */
const FLUXO = {
  pedido_erp: {
    sujeito: 'O lançamento de pedido no ERP',
    quemManda: 'o número do pedido chega pelo Control',
  },
  faturamento: {
    sujeito: 'O faturamento',
    quemManda: 'o pedido fica faturado quando o Control mandar a nota',
  },
  cadastro: {
    sujeito: 'O cadastro',
    quemManda: 'cliente e representante chegam do Control por /partner/v1/clientes e /representantes',
  },
  retrato: {
    sujeito: 'O retrato do cliente',
    quemManda: 'ultima compra, total comprado e vencido chegam do Control por /partner/v1/retrato',
  },
  catalogo: {
    sujeito: 'O catálogo',
    quemManda: 'tabela, produto, preço e estoque chegam do Control por /partner/v1/*',
  },
};

/** Postgres 42703 = coluna inexistente; PGRST204 = coluna fora do schema cache. */
function ehColunaAusente(erro) {
  return (
    erro.code === '42703' ||
    erro.code === 'PGRST204' ||
    /does not exist|schema cache/i.test(erro.message ?? '')
  );
}

/**
 * Pode gravar? `null` quando sim; senão a frase que o script imprime antes de
 * sair — já com o ❌ e o motivo, no formato do faturar-retroativo.mjs.
 *
 * `empresas` é um uuid ou uma lista deles (há script que varre o banco inteiro
 * e toca mais de uma empresa; aí basta UMA com o canal virado para recusar).
 * `canais` são os fluxos que aquele script escreve, pelo nome: 'cadastro',
 * 'retrato', 'catalogo', 'faturamento', 'pedido_erp'.
 * `acao` é o que o script faz, para a frase: "A carga de clientes por planilha".
 */
export async function conferirCanalDeCarga(db, { empresas, canais, acao }) {
  const lista = [...new Set((Array.isArray(empresas) ? empresas : [empresas]).filter(Boolean))];
  if (lista.length === 0) return '❌ Nenhuma empresa para conferir o canal. Nada foi feito.';
  for (const canal of canais) {
    if (!COLUNA_DO_CANAL[canal]) return `❌ Canal desconhecido na trava: ${canal}. Nada foi feito.`;
  }

  const colunas = canais.map((c) => COLUNA_DO_CANAL[c]);
  const { data, error } = await db
    .from('companies')
    .select(['id', ...colunas].join(', '))
    .in('id', lista);

  if (error) {
    if (!ehColunaAusente(error)) {
      // Não deu para saber o canal: na dúvida, não grava.
      return `❌ Falha ao ler o canal da empresa: ${error.message}`;
    }
    // Sem a 048 neste banco: todo canal vale o padrão, que é o comportamento
    // de hoje. Ainda assim confere que a empresa existe — carga em banco
    // errado é o outro jeito de estragar tudo.
    const { data: existentes, error: erroEmpresa } = await db
      .from('companies')
      .select('id')
      .in('id', lista);
    if (erroEmpresa) return `❌ Falha ao conferir a empresa: ${erroEmpresa.message}`;
    return faltando(lista, existentes);
  }

  const semEmpresa = faltando(lista, data);
  if (semEmpresa) return semEmpresa;

  for (const linha of data ?? []) {
    for (const canal of canais) {
      const valor = linha[COLUNA_DO_CANAL[canal]];
      // `null` só aparece em banco sem a 048 (a coluna é NOT NULL DEFAULT):
      // vale o padrão e segue.
      if (valor == null || valor === PADRAO_DO_CANAL[canal]) continue;
      const { sujeito, quemManda } = FLUXO[canal];
      return (
        `❌ ${sujeito} desta empresa vem do Control (${COLUNA_DO_CANAL[canal]}=${valor}). ` +
        `${acao} está recusada — ${quemManda}.`
      );
    }
  }

  return null;
}

/** A frase de "empresa que não está neste banco", ou `null` se estão todas. */
function faltando(lista, achadas) {
  const ids = new Set((achadas ?? []).map((e) => e.id));
  const ausentes = lista.filter((id) => !ids.has(id));
  if (ausentes.length === 0) return null;
  return `❌ Empresa não encontrada neste banco: ${ausentes.join(', ')}. Nada foi feito.`;
}

/**
 * A mesma conferência, do jeito que o script usa: imprime e sai com 1 quando
 * não pode gravar. Quem precisa decidir sozinho usa `conferirCanalDeCarga`.
 */
export async function exigirCanalDeCarga(db, opcoes) {
  const recusa = await conferirCanalDeCarga(db, opcoes);
  if (recusa) {
    console.error(recusa);
    process.exit(1);
  }
}
