import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../services/api.js';
import type { ApiResponse } from '@csb/shared';

/**
 * O estado dos avisos push NESTE aparelho, com as ações de ligar e desligar.
 *
 * O ESTADO é global (módulo + useSyncExternalStore), de propósito: o alerta
 * "ative os avisos", o número do sino no menu e o cartão da Minha área olham
 * todos para a mesma verdade — ativou em qualquer lugar, os três reagem na
 * hora. Estado por instância era o bug: o botão do alerta ativava, mas o
 * alerta continuava na tela até recarregar.
 */

/** A chave pública VAPID vem em base64url; o navegador quer bytes. */
function chaveParaBytes(base64: string): Uint8Array {
  const preenchida = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(preenchida.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

export type EstadoAvisos = 'carregando' | 'indisponivel' | 'inativo' | 'ativo' | 'negado';

// ─── O estado global ──────────────────────────────────────────────────────────
let estadoGlobal: EstadoAvisos = 'carregando';
let chaveGlobal: string | null = null;
let descobrindoPara: string | null = null;
const ouvintes = new Set<() => void>();

function mudarEstado(novo: EstadoAvisos): void {
  estadoGlobal = novo;
  for (const avisar of ouvintes) avisar();
}

function assinar(avisar: () => void): () => void {
  ouvintes.add(avisar);
  return () => ouvintes.delete(avisar);
}

const lerEstado = (): EstadoAvisos => estadoGlobal;

const suporte =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** Descobre uma vez por login: chave do servidor + assinatura deste aparelho. */
async function descobrir(token: string): Promise<void> {
  if (descobrindoPara === token) return;
  descobrindoPara = token;
  if (!suporte) {
    mudarEstado('indisponivel');
    return;
  }
  try {
    const res = await api.get<ApiResponse<{ chave: string | null }>>('/push/chave-publica', token);
    if (!res.data.chave) {
      mudarEstado('indisponivel');
      return;
    }
    chaveGlobal = res.data.chave;
    if (Notification.permission === 'denied') {
      mudarEstado('negado');
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const assinatura = await reg?.pushManager.getSubscription();
    mudarEstado(assinatura ? 'ativo' : 'inativo');
  } catch {
    mudarEstado('indisponivel');
    descobrindoPara = null; // sem rede: a próxima tela tenta de novo
  }
}

export interface AvisosNoCelular {
  estado: EstadoAvisos;
  ocupado: boolean;
  /** Erro da última tentativa, para a tela mostrar. */
  aviso: string | null;
  ativar: () => Promise<void>;
  desativar: () => Promise<void>;
}

export function useAvisosNoCelular(): AvisosNoCelular {
  const { token } = useAuthStore();
  const estado = useSyncExternalStore(assinar, lerEstado);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (token) void descobrir(token);
  }, [token]);

  const ativar = async () => {
    if (!token || !chaveGlobal || ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        mudarEstado(permissao === 'denied' ? 'negado' : 'inativo');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error('O app ainda está terminando de instalar — tente de novo.');
      const assinatura = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(chaveGlobal) as BufferSource,
      });
      const json = assinatura.toJSON();
      await api.post<ApiResponse<{ ok: boolean }>>(
        '/push/assinar',
        { endpoint: assinatura.endpoint, keys: json.keys },
        token,
      );
      mudarEstado('ativo');
      // O teste sai na hora: a primeira notificação É a prova de que funciona.
      await api.post<ApiResponse<{ entregues: number }>>('/push/teste', {}, token);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não deu para ativar agora.');
    } finally {
      setOcupado(false);
    }
  };

  const desativar = async () => {
    if (!token || ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const assinatura = await reg?.pushManager.getSubscription();
      if (assinatura) {
        await api.post<ApiResponse<{ ok: boolean }>>(
          '/push/desassinar',
          { endpoint: assinatura.endpoint },
          token,
        );
        await assinatura.unsubscribe();
      }
      mudarEstado('inativo');
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não deu para desativar agora.');
    } finally {
      setOcupado(false);
    }
  };

  return { estado, ocupado, aviso, ativar, desativar };
}
