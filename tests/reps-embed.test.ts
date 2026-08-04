import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regressão real: a migração 018 criou `rep_price_tables` com FK para `users` e
 * para `price_tables`. Isso passou a dar DOIS caminhos entre as duas tabelas — o
 * direto (`users.price_table_id`) e o muitos-para-muitos pela junção.
 *
 * Diante de dois, o PostgREST não escolhe: recusa a query INTEIRA com PGRST201.
 * A tela de representantes ficou "0 cadastrados" com 2 reps no banco, e o
 * cadastro novo falhava ao reler o registro depois do insert.
 *
 * O modo de falha é traiçoeiro porque não vem de um teste de tipo nem de lint:
 * é uma string de query que só quebra contra o banco real. Por isso este teste
 * olha a string.
 */
const arquivo = readFileSync(
  join(process.cwd(), 'apps/api/src/modules/reps/reps.service.ts'),
  'utf8',
);
// Sem os comentários: eles citam `price_tables(name)` ao explicar justamente
// este bug, e não são query nenhuma.
const serviceSrc = arquivo
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  .join('\n');

describe('embed de price_tables no módulo de representantes', () => {
  it('nomeia a FK no embed, senão o PostgREST recusa a query inteira', () => {
    const todosOsEmbeds = serviceSrc.match(/price_tables[!\w]*\(/g) ?? [];
    expect(todosOsEmbeds.length).toBeGreaterThan(0);
    for (const e of todosOsEmbeds) {
      expect(e, `embed sem FK nomeada: ${e}`).toContain('!');
    }
  });

  it('usa a relação direta users.price_table_id, não a tabela de junção', () => {
    // A tabela do CATÁLOGO do rep é a coluna direta. Embutir pela junção traria
    // o conjunto inteiro e o nome exibido sairia errado.
    expect(serviceSrc).toContain('price_tables!users_price_table_id_fkey(name)');
    expect(serviceSrc).not.toContain('price_tables!rep_price_tables');
  });
});
