import { describe, it, expect } from 'vitest';
import { statusDoCliente, rotuloDoCliente, usaStatusInterno } from '@csb/shared';
import { seloDoPedido } from '../apps/web/src/lib/pedido.js';
import type { Order } from '@csb/shared';

/**
 * O status do pedido para quem comprou.
 *
 * Os status internos descrevem por qual mesa o papel passou. Quem comprou não
 * tem o que fazer com "Aguardando Aprovação" nem "Enviado ao ERP" — ele quer
 * saber se a mercadoria vem.
 *
 * A regra que estes testes trancam: **"Aprovado" é o FATURADO**. Aprovar só
 * libera o pedido para o ERP; quem fecha o valor é o financeiro, que corta item
 * em falta e corrige preço antes da nota. Anunciar "Aprovado" na aprovação do
 * gerente é prometer um pedido que ainda pode encolher.
 */

const pedido = (over: Partial<Order>): Order =>
  ({ id: 'o1', status: 'pending_approval', invoiced: false, ...over }) as Order;

describe('em que degrau o pedido está', () => {
  it('o pedido aprovado pelo gerente ainda NÃO é "Aprovado" para o cliente', () => {
    // O defeito que este teste tranca: antes, `approved` virava "Aprovado" na
    // página pública, antes de existir nota.
    expect(statusDoCliente(pedido({ status: 'approved', invoiced: false }))).toBe('enviado');
  });

  it('nem depois de entrar no ERP, se ainda não faturou', () => {
    expect(statusDoCliente(pedido({ status: 'sent_erp', invoiced: false }))).toBe('enviado');
  });

  it('vira "Aprovado" quando a fábrica fatura', () => {
    expect(statusDoCliente(pedido({ status: 'sent_erp', invoiced: true }))).toBe('aprovado');
  });

  it('o pedido novo aparece como enviado pra fábrica', () => {
    expect(statusDoCliente(pedido({ status: 'pending_approval' }))).toBe('enviado');
    expect(statusDoCliente(pedido({ status: 'draft' }))).toBe('enviado');
  });

  it('recusado vence tudo — o lojista precisa saber que o pedido morreu', () => {
    expect(statusDoCliente(pedido({ status: 'rejected' }))).toBe('recusado');
    expect(statusDoCliente(pedido({ status: 'rejected', invoiced: true }))).toBe('recusado');
  });

  it('entregue passa na frente de aprovado', () => {
    expect(statusDoCliente(pedido({ invoiced: true, delivered: true } as Partial<Order>))).toBe('entregue');
  });

  it('trata invoiced ausente como não faturado, nunca o contrário', () => {
    expect(statusDoCliente({ status: 'approved' })).toBe('enviado');
    expect(statusDoCliente({ status: 'approved', invoiced: null })).toBe('enviado');
  });
});

describe('os rótulos', () => {
  it('fala a língua de quem comprou, não a da fábrica', () => {
    expect(rotuloDoCliente(pedido({ status: 'pending_approval' }))).toBe('Enviado pra fábrica');
    expect(rotuloDoCliente(pedido({ status: 'sent_erp', invoiced: true }))).toBe('Aprovado');
    expect(rotuloDoCliente(pedido({ status: 'rejected' }))).toBe('Recusado');
  });
});

describe('quem vê o quê', () => {
  it('gerente e admin operam por dentro e veem o status interno', () => {
    expect(usaStatusInterno('manager')).toBe(true);
    expect(usaStatusInterno('admin')).toBe(true);
  });

  it('representante e loja veem os degraus de fora', () => {
    expect(usaStatusInterno('rep')).toBe(false);
    expect(usaStatusInterno('store')).toBe(false);
    expect(usaStatusInterno(undefined)).toBe(false);
  });

  it('o mesmo pedido aparece diferente para o gerente e para o representante', () => {
    const p = pedido({ status: 'approved', invoiced: false });
    expect(seloDoPedido(p, 'manager').texto).toBe('Aprovado'); // rótulo interno
    expect(seloDoPedido(p, 'rep').texto).toBe('Enviado pra fábrica');
  });

  it('faturado: os dois dizem "Aprovado", por motivos diferentes', () => {
    const p = pedido({ status: 'sent_erp', invoiced: true });
    expect(seloDoPedido(p, 'manager').texto).toBe('Enviado ao ERP');
    expect(seloDoPedido(p, 'rep').texto).toBe('Aprovado');
  });

  it('recusado sai vermelho para todo mundo', () => {
    const p = pedido({ status: 'rejected' });
    expect(seloDoPedido(p, 'manager').variante).toBe('red');
    expect(seloDoPedido(p, 'store').variante).toBe('red');
  });
});
