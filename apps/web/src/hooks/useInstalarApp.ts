import { useSyncExternalStore } from 'react';
import {
  assinarInstalacao,
  estadoDaInstalacao,
  type EstadoInstalacao,
} from '../lib/instalarApp.js';

/**
 * Se dá para instalar o app na tela inicial, e como.
 *
 * O estado vive fora do React (o navegador avisa quando quer, às vezes antes da
 * primeira tela existir), então é lido com `useSyncExternalStore` em vez de um
 * efeito que copia para o estado local.
 */
export function useInstalarApp(): EstadoInstalacao {
  return useSyncExternalStore(assinarInstalacao, estadoDaInstalacao);
}
