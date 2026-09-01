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

  it('instalar o app e pedido chegado recente são NORMAIS; chegado velho sai da lista', () => {
    const lista = montarAlertas(
      entradas({
        instalacao: 'pronto',
        chegaram: [
          { id: 'ontem', numero: 200, criadoEm: diasAtras(1) },
          { id: 'antigo', numero: 201, criadoEm: diasAtras(6) },
        ],
      }),
    );
    expect(lista.find((a) => a.id === 'instalar')?.nivel).toBe('normal');
    expect(lista.find((a) => a.id === 'chegou-ontem')?.nivel).toBe('normal');
    expect(lista.some((a) => a.id === 'chegou-antigo')).toBe(false);
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
