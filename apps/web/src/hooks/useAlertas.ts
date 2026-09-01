import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../offline/db.js';
import { api } from '../services/api.js';
import { useAuthStore } from '../store/authStore.js';
import { useAtualizacao } from './useAtualizacao.js';
import { useAvisosNoCelular } from './useAvisosNoCelular.js';
import { useInstalarApp } from './useInstalarApp.js';
import { montarAlertas, contarNaoVistos, type Alerta } from '../lib/alertas.js';
import type { ApiResponse, TarefaDoRep } from '@csb/shared';

/**
 * Junta as fontes dos Alertas do representante e cuida do "já vi".
 *
 * O visto é POR APARELHO (localStorage): alerta de atenção/normal sai do
 * número quando a tela é aberta; urgente nunca é "visto" — ele sai sozinho
 * quando a condição resolve (atualizou, ativou, a visita passou).
 */

const CHAVE_VISTOS = 'alertas-vistos-v1';

function lerVistos(): Set<string> {
  try {
    const bruto = localStorage.getItem(CHAVE_VISTOS);
    return new Set(bruto ? (JSON.parse(bruto) as string[]) : []);
  } catch {
    return new Set();
  }
}

function gravarVistos(ids: Set<string>): void {
  try {
    localStorage.setItem(CHAVE_VISTOS, JSON.stringify([...ids]));
  } catch {
    // sem storage (aba anônima cheia etc.): o número volta, nada quebra
  }
}

export interface Alertas {
  alertas: Alerta[];
  /** O número do menu (urgentes + não vistos). */
  contagem: number;
  temUrgente: boolean;
  /** A tela chama ao abrir: atenção e normal viram "vistos" neste aparelho. */
  marcarVistos: () => void;
  carregando: boolean;
}

export function useAlertas(): Alertas {
  const { token, user } = useAuthStore();
  const ehRep = user?.role === 'rep';

  const atualizacao = useAtualizacao();
  const { estado: avisos } = useAvisosNoCelular();
  const instalacao = useInstalarApp();

  // O cache é o do próprio rep (a sincronização já filtra por dono); para os
  // outros papéis a lista nem é usada — o memo devolve vazio antes.
  const orders = useLiveQuery(() => db.orders.toArray(), []);

  const [tarefas, setTarefas] = useState<TarefaDoRep[]>([]);
  useEffect(() => {
    if (!token || !ehRep) return;
    let vivo = true;
    api
      .getLista<ApiResponse<TarefaDoRep[]>>('/tarefas', token)
      .then((r) => {
        if (vivo) setTarefas(r.data);
      })
      .catch(() => {
        /* offline: alertas de visita ficam de fora até reconectar */
      });
    return () => {
      vivo = false;
    };
  }, [token, ehRep]);

  const [vistos, setVistos] = useState<Set<string>>(() => lerVistos());

  const alertas = useMemo(() => {
    if (!ehRep) return [];
    const agora = new Date();
    return montarAlertas({
      atualizacao,
      avisos,
      instalacao,
      rascunhos: (orders ?? [])
        .filter((o) => o.status === 'draft')
        .map((o) => ({
          id: o.id,
          numero: o.order_number ?? null,
          atualizadoEm: o.updated_at ?? o.created_at,
        })),
      chegaram: (orders ?? [])
        .filter((o) => o.status === 'pending_rep')
        .map((o) => ({ id: o.id, numero: o.order_number ?? null, criadoEm: o.created_at })),
      tarefas,
      agora,
    });
  }, [ehRep, atualizacao, avisos, instalacao, orders, tarefas]);

  const marcarVistos = useCallback(() => {
    // Guarda só os ids que EXISTEM agora — visto de alerta que sumiu é lixo.
    const novos = new Set(
      alertas.filter((a) => a.nivel !== 'urgente').map((a) => a.id),
    );
    setVistos(novos);
    gravarVistos(novos);
  }, [alertas]);

  const contagem = useMemo(() => contarNaoVistos(alertas, vistos), [alertas, vistos]);

  return {
    alertas,
    contagem,
    temUrgente: alertas.some((a) => a.nivel === 'urgente'),
    marcarVistos,
    carregando: ehRep && orders === undefined,
  };
}
