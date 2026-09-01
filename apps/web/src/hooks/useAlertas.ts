import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../offline/db.js';
import { api } from '../services/api.js';
import { useAuthStore } from '../store/authStore.js';
import { useAtualizacao } from './useAtualizacao.js';
import { useAvisosNoCelular } from './useAvisosNoCelular.js';
import { useInstalarApp } from './useInstalarApp.js';
import { useMinhaMeta } from './useMinhaMeta.js';
import { montarAlertas, contarNaoVistos, type Alerta } from '../lib/alertas.js';
import { contaParaAMeta } from '@csb/shared';
import type { ApiResponse, TarefaDoRep, ShowcaseLink, StoreInvite } from '@csb/shared';

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

  const filaOffline = useLiveQuery(() => db.sync_queue.toArray(), []);
  const clientes = useLiveQuery(() => db.customers.toArray(), []);
  const faixas = useMinhaMeta();

  const [tarefas, setTarefas] = useState<TarefaDoRep[]>([]);
  const [vitrines, setVitrines] = useState<ShowcaseLink[]>([]);
  const [convites, setConvites] = useState<StoreInvite[]>([]);
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
    api
      .getLista<ApiResponse<ShowcaseLink[]>>('/showcase-links', token)
      .then((r) => {
        if (vivo) setVitrines(r.data);
      })
      .catch(() => {});
    api
      .getLista<ApiResponse<StoreInvite[]>>('/invites', token)
      .then((r) => {
        if (vivo) setConvites(r.data);
      })
      .catch(() => {});
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
      faturados: (orders ?? [])
        .filter((o) => o.invoiced && o.invoiced_at)
        .map((o) => ({ id: o.id, numero: o.order_number ?? null, faturadoEm: o.invoiced_at! })),
      filaOffline: (filaOffline ?? []).map((i) => ({ criadoEm: i.created_at })),
      vitrines: vitrines.map((v) => {
        const dono = v.customer_id ? (clientes ?? []).find((c) => c.id === v.customer_id) : null;
        return {
          id: v.id,
          clienteNome: dono ? dono.trade_name?.trim() || dono.name : null,
          expiraEm: v.expires_at,
          status: v.status,
        };
      }),
      convites: convites.map((c) => ({
        id: c.id,
        clienteNome: c.customer_name,
        expiraEm: c.expires_at,
        status: c.status,
      })),
      clientes: (clientes ?? []).map((c) => ({
        id: c.id,
        nome: c.trade_name?.trim() || c.name,
        ultimaCompraEm: c.last_purchase_at ?? null,
      })),
      meta:
        faixas.length > 0
          ? {
              enviado: (orders ?? [])
                .filter((o) => {
                  const d = new Date(o.created_at);
                  return (
                    d.getFullYear() === agora.getFullYear() &&
                    d.getMonth() === agora.getMonth() &&
                    contaParaAMeta(o.status)
                  );
                })
                .reduce((s, o) => s + (o.total ?? 0), 0),
              faixas,
            }
          : null,
      tarefas,
      agora,
    });
  }, [ehRep, atualizacao, avisos, instalacao, orders, tarefas, vitrines, convites, clientes, filaOffline, faixas]);

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
