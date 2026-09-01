import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../offline/db.js';
import { api } from '../services/api.js';
import { useAuthStore } from '../store/authStore.js';
import { useAtualizacao } from './useAtualizacao.js';
import { useAvisosNoCelular } from './useAvisosNoCelular.js';
import { useInstalarApp } from './useInstalarApp.js';
import { useMinhaMeta } from './useMinhaMeta.js';
import {
  montarAlertas,
  contarNaoVistos,
  podeMarcarResolvida,
  type Alerta,
  type NivelDoAlerta,
} from '../lib/alertas.js';
import { jaInstalouNesteAparelho } from '../lib/instalarApp.js';
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
const CHAVE_RESOLVIDAS = 'alertas-resolvidas-v1';

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

/** Uma pendência que a pessoa marcou como resolvida/lida — vale só no DIA. */
export interface AlertaResolvido {
  id: string;
  titulo: string;
  detalhe: string;
  nivel: NivelDoAlerta;
  /** O dia (AAAA-MM-DD) e a hora da marcação, para a aba "Resolvidas". */
  em: string;
  hora: string;
}

function diaDe(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

/** Lê só as de HOJE — resolvida de ontem volta a valer se a pendência seguir viva. */
function lerResolvidas(): AlertaResolvido[] {
  try {
    const bruto = localStorage.getItem(CHAVE_RESOLVIDAS);
    const todas = bruto ? (JSON.parse(bruto) as AlertaResolvido[]) : [];
    return todas.filter((r) => r.em === diaDe(new Date()));
  } catch {
    return [];
  }
}

function gravarResolvidas(lista: AlertaResolvido[]): void {
  try {
    localStorage.setItem(CHAVE_RESOLVIDAS, JSON.stringify(lista));
  } catch {
    /* sem storage: a marcação não fica, o alerta volta — nada quebra */
  }
}

export interface Alertas {
  /** As PENDENTES — sem as que a pessoa marcou como resolvidas hoje. */
  alertas: Alerta[];
  /** O número do menu (urgentes + não vistos, só entre as pendentes). */
  contagem: number;
  temUrgente: boolean;
  /** A tela chama ao abrir: atenção e normal viram "vistos" neste aparelho. */
  marcarVistos: () => void;
  /** Marca amarela/branca como resolvida (as de ação e as urgentes recusam). */
  marcarResolvida: (alerta: Alerta) => void;
  /** A aba "Resolvidas" — só as marcadas HOJE, mais recente primeiro. */
  resolvidasHoje: AlertaResolvido[];
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
      // Este aparelho já instalou? Vale mesmo se agora abriu pelo navegador —
      // o Chrome não reoferece a instalação e o alerta ficava lá para sempre.
      instalacao: jaInstalouNesteAparelho() ? 'instalado' : instalacao,
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

  const [resolvidas, setResolvidas] = useState<AlertaResolvido[]>(() => lerResolvidas());

  // As PENDENTES: o que a pessoa marcou como resolvida HOJE sai da lista —
  // se a pendência seguir viva amanhã, ela volta (a marcação vale pelo dia).
  const pendentes = useMemo(() => {
    const hoje = diaDe(new Date());
    const resolvidosHoje = new Set(resolvidas.filter((r) => r.em === hoje).map((r) => r.id));
    return alertas.filter((a) => !resolvidosHoje.has(a.id));
  }, [alertas, resolvidas]);

  const marcarVistos = useCallback(() => {
    // Guarda só os ids que EXISTEM agora — visto de alerta que sumiu é lixo.
    const novos = new Set(
      pendentes.filter((a) => a.nivel !== 'urgente').map((a) => a.id),
    );
    setVistos(novos);
    gravarVistos(novos);
  }, [pendentes]);

  const marcarResolvida = useCallback(
    (alerta: Alerta) => {
      // Urgente e alerta de ação (atualizar/avisos/instalar) não se marcam:
      // esses saem RESOLVENDO — regra do Yan.
      if (!podeMarcarResolvida(alerta)) return;
      const agora = new Date();
      setResolvidas((atuais) => {
        const semEla = atuais.filter((r) => r.id !== alerta.id);
        const novas = [
          {
            id: alerta.id,
            titulo: alerta.titulo,
            detalhe: alerta.detalhe,
            nivel: alerta.nivel,
            em: diaDe(agora),
            hora: agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          },
          ...semEla,
        ];
        gravarResolvidas(novas);
        return novas;
      });
    },
    [],
  );

  const contagem = useMemo(() => contarNaoVistos(pendentes, vistos), [pendentes, vistos]);

  return {
    alertas: pendentes,
    contagem,
    temUrgente: pendentes.some((a) => a.nivel === 'urgente'),
    marcarVistos,
    marcarResolvida,
    resolvidasHoje: resolvidas,
    carregando: ehRep && orders === undefined,
  };
}
