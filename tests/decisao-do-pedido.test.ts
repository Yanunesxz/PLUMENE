import { describe, it, expect } from 'vitest';
import {
  decisaoDoPedido,
  podeLancarNoErp,
  seloDoPedido,
  lancaPeloControl,
  faturaPeloControl,
  serieDoControl,
  exemploDeNumeroErp,
  estadoDaEspera,
  mensagemDaEspera,
  ESPERA_DO_CONTROL,
} from '../apps/web/src/lib/pedido.js';

describe('o canal da empresa na tela do pedido (048/049)', () => {
  it('lança pelo Control só com canal_pedido_erp = api; fatura pelo Control só com canal_faturamento = api', () => {
    expect(lancaPeloControl({ pedido_erp: 'api', faturamento: 'manual' })).toBe(true);
    expect(lancaPeloControl({ pedido_erp: 'manual', faturamento: 'api' })).toBe(false);
    expect(faturaPeloControl({ pedido_erp: 'manual', faturamento: 'api' })).toBe(true);
    expect(faturaPeloControl({ pedido_erp: 'api', faturamento: 'manual' })).toBe(false);
  });

  it('sem os canais (cache offline, ou a API não leu) a tela é a de sempre: manual', () => {
    expect(lancaPeloControl(null)).toBe(false);
    expect(lancaPeloControl(undefined)).toBe(false);
    expect(faturaPeloControl(null)).toBe(false);
  });

  it('o selo do financeiro distingue "A lançar" de "Solicitado ao Control" (aprovado, pedido, ainda sem número)', () => {
    expect(seloDoPedido({ status: 'approved', invoiced: false }, 'financeiro').texto).toBe('A lançar');
    expect(
      seloDoPedido({ status: 'approved', invoiced: false, erp_requested_at: '2026-09-16T13:00:00Z', erp_order_id: null }, 'financeiro')
        .texto,
    ).toBe('Solicitado ao Control');
    // Com o número, o pedido já é sent_erp: "A faturar", como sempre.
    expect(
      seloDoPedido({ status: 'sent_erp', invoiced: false, erp_requested_at: '2026-09-16T13:00:00Z', erp_order_id: 'CS17379' }, 'financeiro')
        .texto,
    ).toBe('A faturar');
    // Os outros papéis não mudam de selo por causa da solicitação.
    expect(seloDoPedido({ status: 'approved', erp_requested_at: '2026-09-16T13:00:00Z' }, 'manager').texto).toBe('Aprovado');
    expect(seloDoPedido({ status: 'approved', erp_requested_at: '2026-09-16T13:00:00Z' }, 'rep').texto).toBe('Enviado pra fábrica');
  });
});

describe('a série do número do Control por marca — a SX morreu', () => {
  it('CS na Corpo Sensual, PL na PLUMENE, em qualquer caixa', () => {
    expect(serieDoControl('Corpo Sensual')).toBe('CS');
    expect(serieDoControl('PLUMENE')).toBe('PL');
    expect(serieDoControl('plumene', 'CS17379')).toBe('PL');
  });

  it('marca desconhecida usa a série do último número lançado; sem nenhum dos dois, vazio', () => {
    expect(serieDoControl('Outra Marca', 'PL02672')).toBe('PL');
    expect(serieDoControl('Outra Marca', 'pl 02672')).toBe('PL');
    expect(serieDoControl('Outra Marca', null)).toBe('');
    expect(serieDoControl(undefined)).toBe('');
  });

  it('o exemplo da tela sai na série da marca, e nunca em SX', () => {
    expect(exemploDeNumeroErp('CS')).toBe('CS17379');
    expect(exemploDeNumeroErp('PL')).toBe('PL17379');
    expect(exemploDeNumeroErp('')).toBe('CS17379');
    expect(exemploDeNumeroErp(serieDoControl('Corpo Sensual'))).not.toContain('SX');
  });
});

describe('a espera pelo Control depois de solicitar', () => {
  const inicio = Date.parse('2026-09-16T13:00:00Z');

  it('consulta de 3 em 3 s, por até 3 min', () => {
    expect(ESPERA_DO_CONTROL.intervalo_ms).toBe(3_000);
    expect(ESPERA_DO_CONTROL.limite_ms).toBe(180_000);
  });

  it('número chegou = importado, mesmo depois do prazo; sem número dentro do prazo = aguardando; fora = esgotou', () => {
    expect(estadoDaEspera({ erp_order_id: 'CS17379' }, inicio, inicio + 1_000)).toBe('importado');
    expect(estadoDaEspera({ erp_order_id: 'CS17379' }, inicio, inicio + 999_000)).toBe('importado');
    expect(estadoDaEspera({ erp_order_id: null }, inicio, inicio + 179_999)).toBe('aguardando');
    expect(estadoDaEspera({ erp_order_id: null }, inicio, inicio + 180_000)).toBe('esgotou');
  });

  it('as frases combinadas: parabéns com o número; "ainda não respondeu" no tempo esgotado', () => {
    expect(mensagemDaEspera('importado', 'CS17379')).toBe('Parabéns, pedido importado! O número no Control é CS17379.');
    expect(mensagemDaEspera('esgotou', null)).toBe(
      'O Control ainda não respondeu. O pedido fica na fila e o número aparece aqui quando chegar.',
    );
    expect(mensagemDaEspera('aguardando', null)).toMatch(/Aguardando o Control/);
  });
});

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
