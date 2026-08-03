import { describe, it, expect } from 'vitest';
import { normalizarTabelas } from '../apps/api/src/modules/reps/reps.service.js';

/**
 * Conjunto de tabelas do representante (migração 018).
 *
 * A regra que essas asserções travam: a tabela do CATÁLOGO do rep sempre
 * pertence ao conjunto que ele pode atribuir. Um rep cuja tabela padrão ele não
 * tem permissão de usar é estado inválido — o catálogo dele abriria numa tabela
 * que o servidor recusa na hora de atribuir a um cliente.
 */
describe('conjunto de tabelas do representante', () => {
  it('sem conjunto informado, a tabela única vira o conjunto', () => {
    expect(normalizarTabelas('t1', undefined)).toEqual({ padrao: 't1', conjunto: ['t1'] });
  });

  it('mantém a principal quando ela está entre as marcadas', () => {
    expect(normalizarTabelas('t2', ['t1', 't2'])).toEqual({
      padrao: 't2',
      conjunto: ['t1', 't2'],
    });
  });

  it('desmarcar a principal move a principal para a primeira que sobrou', () => {
    // O gerente tira a t1 do Wesley; a t1 era a principal dele.
    expect(normalizarTabelas('t1', ['t2', 't3'])).toEqual({
      padrao: 't2',
      conjunto: ['t2', 't3'],
    });
  });

  it('remove tabela repetida — marcar duas vezes não duplica a linha no banco', () => {
    expect(normalizarTabelas('t1', ['t1', 't2', 't1'])).toEqual({
      padrao: 't1',
      conjunto: ['t1', 't2'],
    });
  });

  it('conjunto vazio com padrão informado cai na padrão, não fica sem tabela', () => {
    expect(normalizarTabelas('t1', [])).toEqual({ padrao: 't1', conjunto: ['t1'] });
  });

  it('sem padrão e sem conjunto, não inventa tabela', () => {
    expect(normalizarTabelas(null, [])).toEqual({ padrao: null, conjunto: [] });
  });

  it('descarta id vazio vindo de select não preenchido', () => {
    expect(normalizarTabelas('t1', ['', 't1'])).toEqual({ padrao: 't1', conjunto: ['t1'] });
  });
});
