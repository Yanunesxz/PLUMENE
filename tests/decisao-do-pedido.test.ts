import { describe, it, expect } from 'vitest';
import { decisaoDoPedido } from '../apps/web/src/lib/pedido.js';

describe('decisaoDoPedido com a tecla de aprovar', () => {
  it('gerente que pode aprovar vê a decisão — o comportamento de sempre', () => {
    expect(decisaoDoPedido('manager', 'pending_approval')).not.toBeNull();
    expect(decisaoDoPedido('manager', 'pending_approval', true)).not.toBeNull();
  });

  it('gerente sem a tecla não vê botão de aprovar', () => {
    expect(decisaoDoPedido('manager', 'pending_approval', false)).toBeNull();
  });

  it('gerente sem a tecla também não empurra pedido da triagem', () => {
    expect(decisaoDoPedido('manager', 'pending_rep', false)).toBeNull();
  });

  it('o representante nunca é atingido: a tecla não fala sobre ele', () => {
    expect(decisaoDoPedido('rep', 'pending_rep')).not.toBeNull();
    expect(decisaoDoPedido('rep', 'pending_rep', true)).not.toBeNull();
  });

  it('a loja continua sem decidir nada', () => {
    expect(decisaoDoPedido('store', 'pending_approval')).toBeNull();
    expect(decisaoDoPedido('store', 'pending_rep')).toBeNull();
  });
});
