import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../services/api.js';
import type { ApiResponse } from '@csb/shared';

/**
 * O estado dos avisos push NESTE aparelho, com as ações de ligar e desligar.
 *
 * Extraído do CartaoAvisos para os Alertas usarem o MESMO botão "Ativar" —
 * a regra (permissão, chave do servidor, assinatura) mora aqui uma vez só.
 */

/** A chave pública VAPID vem em base64url; o navegador quer bytes. */
function chaveParaBytes(base64: string): Uint8Array {
  const preenchida = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(preenchida.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

export type EstadoAvisos = 'carregando' | 'indisponivel' | 'inativo' | 'ativo' | 'negado';

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
  const [estado, setEstado] = useState<EstadoAvisos>('carregando');
  const [chave, setChave] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const suporte =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  useEffect(() => {
    let vivo = true;
    const descobrir = async () => {
      if (!suporte || !token) {
        if (vivo) setEstado('indisponivel');
        return;
      }
      try {
        const res = await api.get<ApiResponse<{ chave: string | null }>>(
          '/push/chave-publica',
          token,
        );
        if (!vivo) return;
        if (!res.data.chave) {
          setEstado('indisponivel');
          return;
        }
        setChave(res.data.chave);
        if (Notification.permission === 'denied') {
          setEstado('negado');
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration();
        const assinatura = await reg?.pushManager.getSubscription();
        if (vivo) setEstado(assinatura ? 'ativo' : 'inativo');
      } catch {
        if (vivo) setEstado('indisponivel');
      }
    };
    void descobrir();
    return () => {
      vivo = false;
    };
  }, [suporte, token]);

  const ativar = async () => {
    if (!token || !chave || ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        setEstado(permissao === 'denied' ? 'negado' : 'inativo');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error('O app ainda está terminando de instalar — tente de novo.');
      const assinatura = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(chave) as BufferSource,
      });
      const json = assinatura.toJSON();
      await api.post<ApiResponse<{ ok: boolean }>>(
        '/push/assinar',
        { endpoint: assinatura.endpoint, keys: json.keys },
        token,
      );
      setEstado('ativo');
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
      setEstado('inativo');
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não deu para desativar agora.');
    } finally {
      setOcupado(false);
    }
  };

  return { estado, ocupado, aviso, ativar, desativar };
}
