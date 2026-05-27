import { useEffect, useRef } from 'react';
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
  const { token } = useAuthStore();

  useEffect(() => {
    if (isOnline && wasOffline.current && token) {
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
  }, [isOnline, token, onSynced, onFailed]);
}
