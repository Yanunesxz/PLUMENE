import { useAuthStore } from '../store/authStore.js';
import { temPermissao, type PermissaoGerente } from '@csb/shared';

/**
 * Esta pessoa pode isto?
 *
 * Serve para ESCONDER botão, não para proteger: quem protege é a API. Um botão
 * que aparece e responde "acesso negado" no toque é pior do que botão nenhum.
 */
export function usePermissao(tecla: PermissaoGerente): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  return temPermissao(user.role, user.permissions ?? null, tecla);
}
