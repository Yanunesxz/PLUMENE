import { describe, it, expect, beforeEach } from 'vitest';
import {
  lerListaConferida,
  guardarListaConferida,
  esquecerListaConferida,
} from '../apps/web/src/lib/listaConferida.js';

/**
 * A lista que a Larissa conferiu no aviso "Atualizar no ERP" fica no aparelho.
 *
 * Na memória da tela ela se perdia na recarga que o próprio app faz para
 * instalar versão nova quando a aba sai da frente — que é quando a Larissa vai
 * digitar no Control. Na volta, a confirmação passava com a lista nova e
 * engolia a mudança que ela não viu (revisão de 15/09/2026).
 */

class ArmazenamentoFalso implements Storage {
  private dados = new Map<string, string>();
  get length() {
    return this.dados.size;
  }
  clear() {
    this.dados.clear();
  }
  getItem(k: string) {
    return this.dados.get(k) ?? null;
  }
  key(i: number) {
    return [...this.dados.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.dados.delete(k);
  }
  setItem(k: string, v: string) {
    this.dados.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new ArmazenamentoFalso();
});

describe('lista conferida', () => {
  it('sobrevive a uma "recarga": o que foi guardado volta pela mesma chave', () => {
    guardarListaConferida('o1', '2026-09-15T10:00:00Z', '2-aaaa1111');
    // a tela recarregou: estado do React zerado, o aparelho lembra
    expect(lerListaConferida('o1', '2026-09-15T10:00:00Z')).toBe('2-aaaa1111');
  });

  it('foto nova (alguém confirmou) é outra chave: a conferência antiga não vale mais', () => {
    guardarListaConferida('o1', '2026-09-15T10:00:00Z', '2-aaaa1111');
    expect(lerListaConferida('o1', '2026-09-15T16:00:00Z')).toBeNull();
  });

  it('guardar a de uma foto nova apaga a da foto velha — o aparelho não acumula chaves', () => {
    guardarListaConferida('o1', 'foto-1', 'a');
    guardarListaConferida('o1', 'foto-2', 'b');
    guardarListaConferida('o2', 'foto-1', 'c'); // outro pedido não é tocado
    expect(lerListaConferida('o1', 'foto-1')).toBeNull();
    expect(lerListaConferida('o1', 'foto-2')).toBe('b');
    expect(lerListaConferida('o2', 'foto-1')).toBe('c');
  });

  it('esquecer apaga', () => {
    guardarListaConferida('o1', 'foto-1', 'a');
    esquecerListaConferida('o1', 'foto-1');
    expect(lerListaConferida('o1', 'foto-1')).toBeNull();
  });

  it('sem armazenamento no navegador, nada quebra', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => guardarListaConferida('o1', 'f', 'a')).not.toThrow();
    expect(lerListaConferida('o1', 'f')).toBeNull();
  });
});
