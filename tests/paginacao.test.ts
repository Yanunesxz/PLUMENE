import { describe, it, expect } from 'vitest';
import { buscarTudo, buscarPorIds, emLotes, LIMITE_POSTGREST } from '../apps/api/src/lib/paginacao.js';

/**
 * O corte silencioso do PostgREST.
 *
 * Passando de 1.000 linhas ele devolve um array MENOR sem erro nenhum: nada
 * estoura, nada loga, o dado só some. Era o que acontecia com a grade do
 * catálogo — ~1.500 linhas para 313 produtos, então parte do catálogo chegava
 * sem tamanho e não dava para vender.
 */

/** Dublê de uma tabela com N linhas, servindo em páginas como o PostgREST. */
function tabelaCom(linhas: number) {
  const dados = Array.from({ length: linhas }, (_, i) => ({ id: `linha-${i}` }));
  let chamadas = 0;
  return {
    get chamadas() {
      return chamadas;
    },
    pagina(de: number, ate: number) {
      chamadas += 1;
      return Promise.resolve({ data: dados.slice(de, ate + 1), error: null });
    },
  };
}

describe('listagem inteira', () => {
  it('traz tudo quando passa do teto de uma requisição', async () => {
    const tabela = tabelaCom(1500);

    const tudo = await buscarTudo<{ id: string }>((de, ate) => tabela.pagina(de, ate));

    expect(tudo).toHaveLength(1500);
    expect(tabela.chamadas).toBe(2);
    // A última linha é a prova: numa consulta só, ela não voltava.
    expect(tudo.at(-1)!.id).toBe('linha-1499');
  });

  it('para na primeira página quando a tabela é menor que o teto', async () => {
    const tabela = tabelaCom(40);

    expect(await buscarTudo(tabela.pagina)).toHaveLength(40);
    expect(tabela.chamadas).toBe(1);
  });

  it('página cheia exata não engana: vai buscar a seguinte', async () => {
    const tabela = tabelaCom(LIMITE_POSTGREST);

    await buscarTudo(tabela.pagina);

    // Sem a segunda tentativa, 1.000 linhas exatas seriam indistinguíveis de
    // "acabou" — e um catálogo de exatamente 1.000 itens ficaria sempre truncado.
    expect(tabela.chamadas).toBe(2);
  });

  it('resposta que não é lista encerra o laço em vez de girar para sempre', async () => {
    let chamadas = 0;
    const tudo = await buscarTudo(() => {
      chamadas += 1;
      return Promise.resolve({ data: { id: 'objeto-solto' }, error: null });
    });

    expect(tudo).toEqual([]);
    expect(chamadas).toBe(1);
  });

  it('erro no meio devolve o que já veio, sem laço infinito', async () => {
    let chamadas = 0;
    const tudo = await buscarTudo<{ id: string }>((de, ate) => {
      chamadas += 1;
      if (chamadas > 1) return Promise.resolve({ data: null, error: { message: 'caiu' } });
      return Promise.resolve({
        data: Array.from({ length: LIMITE_POSTGREST }, (_, i) => ({ id: `l${de + i}-${ate}` })),
        error: null,
      });
    });

    expect(tudo).toHaveLength(LIMITE_POSTGREST);
    expect(chamadas).toBe(2);
  });
});

describe('busca por ids', () => {
  it('fatia os ids para a URL não estourar, e junta o resultado', async () => {
    const ids = Array.from({ length: 700 }, (_, i) => `id-${i}`);
    const lotesVistos: number[] = [];

    const tudo = await buscarPorIds<{ id: string }>(ids, (lote) => {
      lotesVistos.push(lote.length);
      return Promise.resolve({ data: lote.map((id) => ({ id })), error: null });
    });

    expect(tudo).toHaveLength(700);
    expect(lotesVistos).toEqual([300, 300, 100]);
  });

  it('pagina DENTRO do lote — 300 pedidos podem trazer milhares de itens', async () => {
    const tabela = tabelaCom(2500);

    const tudo = await buscarPorIds<{ id: string }>(['pedido-1'], (_lote, de, ate) =>
      tabela.pagina(de, ate),
    );

    expect(tudo).toHaveLength(2500);
    expect(tabela.chamadas).toBe(3);
  });

  it('sem ids, não bate no banco', async () => {
    let chamou = false;
    const tudo = await buscarPorIds([], () => {
      chamou = true;
      return Promise.resolve({ data: [], error: null });
    });

    expect(tudo).toEqual([]);
    expect(chamou).toBe(false);
  });
});

describe('lotes', () => {
  it('divide sem perder nem repetir item', () => {
    const lotes = emLotes([1, 2, 3, 4, 5], 2);
    expect(lotes).toEqual([[1, 2], [3, 4], [5]]);
    expect(lotes.flat()).toHaveLength(5);
  });
});
