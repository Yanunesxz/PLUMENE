import { useSyncExternalStore } from 'react';
import {
  assinarAtualizacao,
  estadoDaAtualizacao,
  type EstadoAtualizacao,
} from '../lib/atualizarApp.js';

/**
 * Se existe versão nova do app esperando para entrar.
 *
 * Igual ao `useInstalarApp`: quem manda no estado é o service worker, que avisa
 * na hora dele — às vezes antes da primeira tela existir. Por isso é lido com
 * `useSyncExternalStore`, e não com um efeito copiando para o estado local.
 */
export function useAtualizacao(): EstadoAtualizacao {
  return useSyncExternalStore(assinarAtualizacao, estadoDaAtualizacao);
}
