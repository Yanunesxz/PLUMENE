import { describe, it, expect } from 'vitest';
import { montarAlertas, contarNaoVistos, type EntradasDosAlertas } from '../apps/web/src/lib/alertas.js';
import type { TarefaDoRep } from '@csb/shared';

/**
 * Os Alertas do representante — os 3 degraus do Yan.
 *
 * O que estes testes trancam:
 *  • cada pendência cai no degrau combinado (urgente / atenção / normal);
 *  • rascunho só vira alerta com 7+ dias parado; pedido chegado só é "recente"
 *    até 3 dias; visita longe é 14+;
 *  • o número do menu: urgente conta SEMPRE (ver não resolve), atenção e
 *    normal saem ao marcar visto.
 */

const AGORA = new Date('2026-08-31T12:00:00-03:00');
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000).toISOString();
const diasAFrente = (d: number) => new Date(AGORA.getTime() + d * 86_400_000).toISOString();

function tarefa(parcial: Partial<TarefaDoRep>): TarefaDoRep {
  return {
    id: 't1',
    rep_id: 'rep-1',
    rep_nome: null,
    criado_por_nome: 'Bruna',
    customer_id: null,
    cliente_nome: 'Loja da Maria',
    titulo: 'Visita',
    prazo: null,
    local: null,
    observacoes: null,
    status: 'pendente',
    created_at: diasAtras(1),
    ...parcial,
  };
}

function entradas(parcial: Partial<EntradasDosAlertas>): EntradasDosAlertas {
  return {
    atualizacao: 'atual',
    avisos: 'ativo',
    instalacao: 'instalado',
    rascunhos: [],
    chegaram: [],
    faturados: [],
    filaOffline: [],
    vitrines: [],
    convites: [],
    clientes: [],
    meta: null,
    tarefas: [],
    agora: AGORA,
    ...parcial,
  };
}

describe('os 3 degraus', () => {
  it('atualização esperando é URGENTE, com o botão de atualizar ali', () => {
    const [a] = montarAlertas(entradas({ atualizacao: 'disponivel' }));
    expect(a?.nivel).toBe('urgente');
    expect(a?.acao?.tipo).toBe('atualizar');
  });

  it('visita HOJE é urgente; para 14+ dias é normal; no meio não vira alerta', () => {
    const lista = montarAlertas(
      entradas({
        tarefas: [
          tarefa({ id: 'hoje', prazo: new Date(AGORA.getTime() + 3600_000).toISOString() }),
          tarefa({ id: 'semana', prazo: diasAFrente(5) }),
          tarefa({ id: 'longe', prazo: diasAFrente(20) }),
        ],
      }),
    );
    expect(lista.find((a) => a.id === 'visita-ja-hoje')?.nivel).toBe('urgente');
    expect(lista.find((a) => a.id === 'visita-longe-longe')?.nivel).toBe('normal');
    expect(lista.some((a) => a.id.includes('semana'))).toBe(false);
  });

  it('visita atrasada (pendente, prazo passado) continua URGENTE', () => {
    const lista = montarAlertas(entradas({ tarefas: [tarefa({ id: 'x', prazo: diasAtras(2) })] }));
    expect(lista.find((a) => a.id === 'visita-ja-x')?.nivel).toBe('urgente');
    expect(lista.find((a) => a.id === 'visita-ja-x')?.titulo).toContain('atrasada');
  });

  it('avisos desligados e rascunho de 7+ dias são ATENÇÃO; rascunho novo não aparece', () => {
    const lista = montarAlertas(
      entradas({
        avisos: 'inativo',
        rascunhos: [
          { id: 'velho', numero: 100, atualizadoEm: diasAtras(8) },
          { id: 'novo', numero: 101, atualizadoEm: diasAtras(3) },
        ],
      }),
    );
    expect(lista.find((a) => a.id === 'ativar-avisos')?.nivel).toBe('atencao');
    expect(lista.find((a) => a.id === 'rascunho-velho')?.nivel).toBe('atencao');
    expect(lista.some((a) => a.id === 'rascunho-novo')).toBe(false);
  });

  it('chegado de hoje/ontem é NORMAL; parado 2+ dias na triagem SOBE para urgente', () => {
    const lista = montarAlertas(
      entradas({
        instalacao: 'pronto',
        chegaram: [
          { id: 'ontem', numero: 200, criadoEm: diasAtras(1) },
          { id: 'parado', numero: 201, criadoEm: diasAtras(3) },
        ],
      }),
    );
    expect(lista.find((a) => a.id === 'instalar')?.nivel).toBe('normal');
    expect(lista.find((a) => a.id === 'chegou-ontem')?.nivel).toBe('normal');
    expect(lista.find((a) => a.id === 'triagem-parado')?.nivel).toBe('urgente');
    expect(lista.some((a) => a.id === 'chegou-parado')).toBe(false);
  });

  it('pedido preso na fila offline há 1h+ é URGENTE; recém-feito não apita', () => {
    const preso = montarAlertas(
      entradas({ filaOffline: [{ criadoEm: new Date(AGORA.getTime() - 2 * 3600_000).toISOString() }] }),
    );
    expect(preso.find((a) => a.id === 'fila-offline')?.nivel).toBe('urgente');
    const recem = montarAlertas(
      entradas({ filaOffline: [{ criadoEm: new Date(AGORA.getTime() - 600_000).toISOString() }] }),
    );
    expect(recem.some((a) => a.id === 'fila-offline')).toBe(false);
  });

  it('visita AMANHÃ é atenção', () => {
    const lista = montarAlertas(
      entradas({ tarefas: [tarefa({ id: 'am', prazo: diasAFrente(1) })] }),
    );
    expect(lista.find((a) => a.id === 'visita-amanha-am')?.nivel).toBe('atencao');
  });

  it('cliente a 1-3 dias de virar inativo é atenção; já inativo ou longe não aparece', () => {
    const lista = montarAlertas(
      entradas({
        clientes: [
          { id: 'quase', nome: 'Loja Quase', ultimaCompraEm: diasAtras(178) },
          { id: 'ja', nome: 'Loja Já Era', ultimaCompraEm: diasAtras(181) },
          { id: 'longe', nome: 'Loja Ativa', ultimaCompraEm: diasAtras(100) },
        ],
      }),
    );
    expect(lista.find((a) => a.id === 'cliente-expira-quase')?.nivel).toBe('atencao');
    expect(lista.some((a) => a.id.includes('ja'))).toBe(false);
    expect(lista.some((a) => a.id.includes('longe'))).toBe(false);
  });

  it('link da vitrine que expira HOJE sem pedido é atenção', () => {
    const lista = montarAlertas(
      entradas({
        vitrines: [
          { id: 'v1', clienteNome: 'Loja X', expiraEm: new Date(AGORA.getTime() + 3 * 3600_000).toISOString(), status: 'ativo' },
          { id: 'v2', clienteNome: null, expiraEm: diasAFrente(2), status: 'ativo' },
        ],
      }),
    );
    expect(lista.find((a) => a.id === 'vitrine-hoje-v1')?.nivel).toBe('atencao');
    expect(lista.some((a) => a.id === 'vitrine-hoje-v2')).toBe(false);
  });

  it('faturado ontem é normal; convite expirado sem abrir também', () => {
    const lista = montarAlertas(
      entradas({
        faturados: [{ id: 'f1', numero: 300, faturadoEm: diasAtras(1) }],
        convites: [
          { id: 'c1', clienteNome: 'Loja Y', expiraEm: diasAtras(2), status: 'expirado' },
          { id: 'c2', clienteNome: 'Loja Z', expiraEm: diasAtras(30), status: 'expirado' },
        ],
      }),
    );
    expect(lista.find((a) => a.id === 'faturado-f1')?.nivel).toBe('normal');
    expect(lista.find((a) => a.id === 'convite-venceu-c1')?.nivel).toBe('normal');
    // convite arqueológico (30 dias) fica quieto
    expect(lista.some((a) => a.id === 'convite-venceu-c2')).toBe(false);
  });

  it('a régua da meta aparece com o id DO DIA (visto hoje, volta amanhã)', () => {
    const lista = montarAlertas(
      entradas({ meta: { enviado: 5000, faixas: [{ meta: 8000, bonus: 300 }] } }),
    );
    const meta = lista.find((a) => a.id.startsWith('meta-'));
    expect(meta?.id).toBe('meta-2026-08-31');
    expect(meta?.titulo).toContain('faltam');
    // agosto/2026 acaba HOJE (dia 31): última semana → sobe para atenção
    expect(meta?.nivel).toBe('atencao');
  });

  it('tudo em dia = lista vazia', () => {
    expect(montarAlertas(entradas({}))).toHaveLength(0);
  });
});

describe('o número do menu', () => {
  it('urgente conta mesmo depois de visto; atenção e normal saem ao ver', () => {
    const lista = montarAlertas(
      entradas({
        atualizacao: 'disponivel', // urgente
        avisos: 'inativo', // atenção
        instalacao: 'pronto', // normal
      }),
    );
    expect(contarNaoVistos(lista, new Set())).toBe(3);
    // "abriu a tela": atenção e normal viram vistos
    const vistos = new Set(lista.filter((a) => a.nivel !== 'urgente').map((a) => a.id));
    expect(contarNaoVistos(lista, vistos)).toBe(1); // só o urgente segue contando
  });
});
