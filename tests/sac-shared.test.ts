import { describe, it, expect } from 'vitest';
import {
  USER_ROLE,
  USER_ROLE_LABELS,
  PAPEIS_GERENCIAVEIS,
  PAPEIS_DA_FABRICA,
  PAPEIS_QUE_LEEM_O_ESCRITORIO,
  PAPEIS_QUE_VENDEM_EM_NOME_PROPRIO,
  PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL,
  SO_LEITURA,
  ehPapelGerenciavel,
  ehSoLeitura,
  ehComprador,
  vendeEmNomeProprio,
  teclaLigaOBotao,
  podeCancelarPedido,
  podeEditarCadastroDoCliente,
  editaQualquerCliente,
  podeTrocarDocumentoDoCliente,
  podeInativarPedido,
  usaStatusInterno,
} from '@csb/shared';
import type { AuthRole, OrderStatus } from '@csb/shared';
import { navItemsForRole } from '../apps/web/src/components/layout/navItems.js';
import { decisaoDoPedido, podeLancarNoErp, seloDoPedido } from '../apps/web/src/lib/pedido.js';

/**
 * O papel SAC (056) nas regras PURAS — as que a API e as telas contam igual.
 *
 * Pedido do Yan (04/11/2026): "cria um login pra SAC por favor, no SAC vai
 * poder criar pedido, ver todos os clientes, e vai ver criar cliente".
 *
 * O desenho: o SAC vende EM NOME PRÓPRIO, como o representante — o pedido
 * nasce com rep_id = ele, ele só vê os seus, manda o próprio rascunho para a
 * fábrica, cancela antes do financeiro. Mas não é escritório (não decide, não
 * fatura, não lança) nem é representante (sem desconto, sem carteira pelo
 * código do Control). Clientes: lê todos e cadastra; não edita.
 *
 * O que bate na API de verdade está em tests/sac-rotas.test.ts.
 */

const PAPEL = 'sac' as const;

const OUTROS_PAPEIS: AuthRole[] = [
  'admin',
  'manager',
  'financeiro',
  'relacionamento',
  'visualizador',
  'store',
  'guest',
];

const ESTADOS: OrderStatus[] = [
  'draft',
  'pending_rep',
  'pending_approval',
  'approved',
  'sent_erp',
  'rejected',
];

// ─── O papel existe e o admin cria ───────────────────────────────────────────

describe('o papel SAC', () => {
  it('está em USER_ROLE, com rótulo', () => {
    expect(USER_ROLE.SAC).toBe('sac');
    expect(USER_ROLE_LABELS.sac).toBe('SAC');
  });

  it('o admin cria este login pela tela de Logins', () => {
    expect(ehPapelGerenciavel(PAPEL)).toBe(true);
    expect(PAPEIS_GERENCIAVEIS).toContain(PAPEL);
  });

  it('entra ANTES do visualizador e depois do relacionamento na ordem da tela', () => {
    const lista = [...PAPEIS_GERENCIAVEIS];
    expect(lista.indexOf('sac')).toBe(lista.indexOf('relacionamento') + 1);
    expect(lista.indexOf('sac')).toBe(lista.indexOf('visualizador') - 1);
  });

  it('não é só leitura, não é comprador, não é escritório', () => {
    expect(ehSoLeitura(PAPEL)).toBe(false);
    expect(SO_LEITURA).not.toContain(PAPEL);
    expect(ehComprador(PAPEL)).toBe(false);
    // Não MEXE em pedido de qualquer rep, nem LÊ o que o escritório lê: o
    // pedido dele é só o dele, e o Painel/representantes não são dele.
    expect(PAPEIS_DA_FABRICA).not.toContain(PAPEL);
    expect(PAPEIS_QUE_LEEM_O_ESCRITORIO).not.toContain(PAPEL);
    expect(PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL).not.toContain(PAPEL);
  });
});

// ─── Vende em nome próprio — como o representante ────────────────────────────

describe('vendeEmNomeProprio', () => {
  it('é verdade para o SAC e para o representante', () => {
    expect(vendeEmNomeProprio('sac')).toBe(true);
    expect(vendeEmNomeProprio('rep')).toBe(true);
    expect([...PAPEIS_QUE_VENDEM_EM_NOME_PROPRIO]).toEqual(['rep', 'sac']);
  });

  it.each(OUTROS_PAPEIS)('e falso para %s', (papel) => {
    expect(vendeEmNomeProprio(papel)).toBe(false);
  });

  it('papel ausente não vende', () => {
    expect(vendeEmNomeProprio(undefined)).toBe(false);
    expect(vendeEmNomeProprio(null)).toBe(false);
  });

  it('a tecla do gerente não fala sobre ele: o botão "Enviar para a fábrica" acende', () => {
    // É `teclaLigaOBotao('aprovar_pedidos')` que desenha o botão do rascunho
    // no detalhe do pedido — para o rep e para o SAC a tecla não se aplica.
    expect(teclaLigaOBotao(PAPEL, null, 'aprovar_pedidos')).toBe(true);
  });

  it('vê o pedido pelos degraus do cliente, como o rep — não pelo status interno', () => {
    expect(usaStatusInterno(PAPEL)).toBe(false);
    expect(seloDoPedido({ status: 'draft' }, PAPEL).texto).toBe('Enviar pra fábrica');
  });
});

// ─── O que ele NÃO decide ────────────────────────────────────────────────────

describe('nenhuma decisão de pedido é dele', () => {
  it.each(ESTADOS)('status %s: nada a aprovar nem recusar', (status) => {
    // `decisaoDoPedido` nulo apaga o CartaoDecisao. O rascunho dele sobe pelo
    // botão próprio ("Enviar para a fábrica"), que não passa por aqui.
    expect(decisaoDoPedido(PAPEL, status)).toBeNull();
    expect(decisaoDoPedido(PAPEL, status, true)).toBeNull();
  });

  it('não lança no Control nem inativa pedido', () => {
    expect(podeLancarNoErp(PAPEL, 'approved', false)).toBe(false);
    expect(podeInativarPedido({ status: 'approved' }, PAPEL)).toBe('forbidden');
  });
});

// ─── Cancelar o próprio pedido ───────────────────────────────────────────────

describe('podeCancelarPedido para o SAC', () => {
  const meu = (status: OrderStatus) => ({ status, invoiced: false, rep_id: 'sac-1' });

  it('cancela o PRÓPRIO rascunho e a própria triagem', () => {
    expect(podeCancelarPedido(meu('draft'), PAPEL, 'sac-1')).toBe('ok');
    expect(podeCancelarPedido(meu('pending_rep'), PAPEL, 'sac-1')).toBe('ok');
  });

  it('depois que chegou ao financeiro, é com o financeiro', () => {
    expect(podeCancelarPedido(meu('pending_approval'), PAPEL, 'sac-1')).toBe('com_o_financeiro');
    expect(podeCancelarPedido(meu('approved'), PAPEL, 'sac-1')).toBe('com_o_financeiro');
  });

  it('o pedido de outro não é dele', () => {
    expect(podeCancelarPedido({ ...meu('draft'), rep_id: 'rep-1' }, PAPEL, 'sac-1')).toBe('forbidden');
  });

  it('faturado e já cancelado seguem a regra geral', () => {
    expect(podeCancelarPedido({ ...meu('approved'), invoiced: true }, PAPEL, 'sac-1')).toBe('faturado');
    expect(podeCancelarPedido(meu('rejected'), PAPEL, 'sac-1')).toBe('ja_cancelado');
  });

  it('e o representante continua exatamente como era', () => {
    expect(podeCancelarPedido({ ...meu('draft'), rep_id: 'rep-1' }, 'rep', 'rep-1')).toBe('ok');
    expect(podeCancelarPedido({ ...meu('approved'), rep_id: 'rep-1' }, 'rep', 'rep-1', true)).toBe('ok');
    expect(podeCancelarPedido({ ...meu('approved'), rep_id: 'rep-1' }, 'rep', 'rep-1')).toBe(
      'com_o_financeiro',
    );
  });
});

// ─── Cadastro de cliente: cria, não edita ────────────────────────────────────

describe('cadastro de cliente', () => {
  it('não edita cadastro, não troca documento, não vê a fila do Control', () => {
    // "vai ver criar cliente" — criar, e só. Editar segue a regra de
    // 17/09/2026 (rep, gerente, admin e financeiro).
    expect(podeEditarCadastroDoCliente(PAPEL)).toBe(false);
    expect(editaQualquerCliente(PAPEL)).toBe(false);
    expect(podeTrocarDocumentoDoCliente(PAPEL)).toBe(false);
  });
});

// ─── O menu ──────────────────────────────────────────────────────────────────

describe('menu do SAC', () => {
  const itens = navItemsForRole(PAPEL);
  const enderecos = itens.map((i) => i.to);

  it('leva ao catálogo, aos pedidos e aos clientes — e a mais nada', () => {
    expect(enderecos).toEqual(['/catalog', '/orders', '/customers']);
  });

  it('não ganhou o menu do representante por descuido', () => {
    // `navItemsForRole` termina em `return repItems`: papel sem ramo próprio
    // herda Minha área, Alertas e Acessos.
    expect(enderecos).not.toEqual(navItemsForRole('rep').map((i) => i.to));
    expect(enderecos).not.toContain('/minha-area');
    expect(enderecos).not.toContain('/alertas');
    expect(enderecos).not.toContain('/acessos');
  });

  it('nenhum item depende de tecla do gerente nem mostra fila', () => {
    for (const item of itens) {
      expect(item.permissao, `${item.to} veio com permissao`).toBeUndefined();
      expect(item.fila, `${item.to} veio com fila`).toBeUndefined();
    }
  });

  it('os outros papéis continuam com o menu deles', () => {
    expect(navItemsForRole('relacionamento').map((i) => i.to)).toEqual(['/atividades', '/customers']);
    expect(navItemsForRole('visualizador').map((i) => i.to)).toContain('/dashboard');
    expect(navItemsForRole('rep').map((i) => i.to)).toContain('/minha-area');
  });
});
