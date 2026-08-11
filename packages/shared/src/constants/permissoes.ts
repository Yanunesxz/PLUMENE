import type { AuthRole } from './userRole.js';

/**
 * Teclas do gerente.
 *
 * "Gerente" era um bloco só: quem entrava como gerente aprovava pedido, faturava
 * e mexia em representante. Não dava para entregar um pedaço. Estas teclas
 * quebram esse bloco — e existem SÓ para o papel `manager`: o admin tem tudo por
 * definição, e rep e loja são delimitados pelo próprio papel.
 */
export const PERMISSOES_GERENTE = {
  APROVAR_PEDIDOS: 'aprovar_pedidos',
  FATURAR_PEDIDOS: 'faturar_pedidos',
  GERENCIAR_REPRESENTANTES: 'gerenciar_representantes',
  IMPORTAR_PRODUTOS: 'importar_produtos',
} as const;

export type PermissaoGerente = (typeof PERMISSOES_GERENTE)[keyof typeof PERMISSOES_GERENTE];

export const TODAS_PERMISSOES: readonly PermissaoGerente[] = Object.values(PERMISSOES_GERENTE);

/**
 * O que um gerente sem nada gravado tem.
 *
 * É a lista do que o papel `manager` já fazia antes destas teclas existirem —
 * nem mais, nem menos. `importar_produtos` fica de fora porque a importação era
 * exclusiva do admin: ligar isso no dia do deploy daria poder novo a quem
 * ninguém decidiu dar.
 */
export const PERMISSOES_PADRAO_GERENTE: readonly PermissaoGerente[] = [
  PERMISSOES_GERENTE.APROVAR_PEDIDOS,
  PERMISSOES_GERENTE.FATURAR_PEDIDOS,
  PERMISSOES_GERENTE.GERENCIAR_REPRESENTANTES,
];

export const PERMISSAO_LABELS: Record<PermissaoGerente, { titulo: string; descricao: string }> = {
  aprovar_pedidos: {
    titulo: 'Aprovar pedidos',
    descricao: 'Aprovar, recusar e excluir pedido.',
  },
  faturar_pedidos: {
    titulo: 'Faturar',
    descricao: 'Marcar e desmarcar pedido como faturado.',
  },
  gerenciar_representantes: {
    titulo: 'Representantes',
    descricao: 'Cadastrar, editar, excluir e definir meta de bonificação.',
  },
  importar_produtos: {
    titulo: 'Importar produtos',
    descricao: 'Subir planilha de catálogo e fotos.',
  },
};

/**
 * Esta pessoa pode fazer isto?
 *
 * Três regras, e a ordem importa:
 *
 * 1. `admin` passa sempre — teclas nem são consultadas. Um admin que se tranca
 *    fora do próprio sistema é o pior estado possível.
 * 2. Quem não é `manager` passa. A tecla não fala sobre ele: quem decide se um
 *    rep entra na rota é o `requireRole` dela, e essa decisão já foi tomada
 *    antes de chegar aqui. Devolver `false` para rep faria o guard de
 *    `PATCH /orders/:id/status` derrubar a triagem do representante, que divide
 *    a rota com o gerente.
 * 3. `manager` com a coluna nula cai no padrão do papel — é o que garante que
 *    ninguém perde poder no dia em que isto entrou no ar. Array vazio é
 *    diferente de nulo: vazio é o admin dizendo "este não faz nada".
 */
export function temPermissao(
  role: AuthRole,
  permissions: readonly string[] | null | undefined,
  tecla: PermissaoGerente,
): boolean {
  if (role === 'admin') return true;
  if (role !== 'manager') return true;
  if (permissions == null) return PERMISSOES_PADRAO_GERENTE.includes(tecla);
  return permissions.includes(tecla);
}
