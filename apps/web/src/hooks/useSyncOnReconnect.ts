import { useEffect, useRef } from 'react';
import { ehSoLeitura } from '@csb/shared';
import { useOnlineStatus } from './useOnlineStatus.js';
import { flushSyncQueue } from '../offline/sync.js';
import { useAuthStore } from '../store/authStore.js';

interface SyncCallbacks {
  onSynced?: (count: number) => void;
  onFailed?: (count: number) => void;
}

export function useSyncOnReconnect({ onSynced, onFailed }: SyncCallbacks = {}) {
  const isOnline = useOnlineStatus();
  const wasOffline = useRef(!isOnline);
  const { token, user } = useAuthStore();
  /**
   * Papel de só leitura não descarrega fila (visualizador, 054, 15/10/2026).
   *
   * Ele nunca monta pedido, então a fila dele é sempre vazia — MENOS num
   * aparelho que um representante usou antes: a fila fica no navegador, e ao
   * reconectar este hook a mandaria como POST /sync em nome de quem está
   * logado agora. A rota recusa o papel; não chamar é o certo de qualquer
   * forma, porque o pedido não é dele.
   */
  const soLeitura = ehSoLeitura(user?.role);

  useEffect(() => {
    if (isOnline && wasOffline.current && token && !soLeitura) {
      wasOffline.current = false;
      flushSyncQueue(token)
        .then(({ synced, failed }) => {
          if (synced > 0) onSynced?.(synced);
          if (failed > 0) onFailed?.(failed);
        })
        .catch(() => {});
    }

    if (!isOnline) {
      wasOffline.current = true;
    }
  }, [isOnline, token, soLeitura, onSynced, onFailed]);
}
