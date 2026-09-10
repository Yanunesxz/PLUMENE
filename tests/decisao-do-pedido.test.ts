import { describe, it, expect } from 'vitest';
import { decisaoDoPedido, podeLancarNoErp } from '../apps/web/src/lib/pedido.js';

describe('quem vê o botão "Lançar no ERP"', () => {
  it('só o financeiro (e o admin), em pedido aceito e sem nota', () => {
    expect(podeLancarNoErp('financeiro', 'approved', false)).toBe(true);
    expect(podeLancarNoErp('admin', 'approved', false)).toBe(true);
    expect(podeLancarNoErp('manager', 'approved', false)).toBe(false);
    expect(podeLancarNoErp('rep', 'approved', false)).toBe(false);
    expect(podeLancarNoErp('financeiro', 'pending_approval', false)).toBe(false);
    expect(podeLancarNoErp('financeiro', 'approved', true)).toBe(false);
  });
});

describe('decisaoDoPedido com a tecla de aprovar', () => {
  it('o pedido na fila é decidido pelo financeiro (e pelo admin) — não pelo gerente', () => {
    // Yan, 02/09/2026: "nenhum pedido precisa passar pelo gerente — chega
    // direto no financeiro". Mesmo com a tecla ligada, o gerente só olha.
    expect(decisaoDoPedido('manager', 'pending_approval')).toBeNull();
    expect(decisaoDoPedido('manager', 'pending_approval', true)).toBeNull();
    expect(decisaoDoPedido('financeiro', 'pending_approval')).not.toBeNull();
    expect(decisaoDoPedido('admin', 'pending_approval')).not.toBeNull();
  });

  it('o gerente continua triando: pedido parado no rep ele manda para a fila', () => {
    expect(decisaoDoPedido('manager', 'pending_rep')).not.toBeNull();
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
