import { useAuthStore } from '../store/authStore.js';
import { teclaLigaOBotao, type PermissaoGerente } from '@csb/shared';

/**
 * Esta pessoa pode isto?
 *
 * Serve para ESCONDER botão, não para proteger: quem protege é a API. Um botão
 * que aparece e responde "acesso negado" no toque é pior do que botão nenhum.
 *
 * A regra mora em `teclaLigaOBotao` (shared), para caber num teste sem
 * renderizar componente — e é lá que fica o portão do papel de só leitura
 * (visualizador, 054, 15/10/2026).
 */
export function usePermissao(tecla: PermissaoGerente): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  return teclaLigaOBotao(user.role, user.permissions ?? null, tecla);
}
