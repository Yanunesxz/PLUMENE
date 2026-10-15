export const USER_ROLE = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  REP: 'rep',
  /** Loja: o cliente logado, comprando por conta própria. */
  STORE: 'store',
  /**
   * Financeiro: recebe o que a fábrica aprovou e cuida do faturamento.
   * É "quase gerente" — cria e altera pedido, vê todos os clientes e o
   * catálogo — mas sem a parte de representantes (migração 030).
   */
  FINANCEIRO: 'financeiro',
  /**
   * Relacionamento (migração 038): a Bruna, interna, liga para cliente parado.
   * Limitada DE PROPÓSITO a duas coisas — ler clientes de qualquer carteira e
   * marcar visita/tarefa (local, horário, observações) para o representante
   * dono. Pedido, catálogo, faturamento e cadastro ficam fora do alcance.
   */
  RELACIONAMENTO: 'relacionamento',
  /**
   * Visualizador (migração 054). Pedido do Yan, 15/10/2026: "coloca o login
   * como visualizador, cria ele, ele pode ver tudo so nao pode alterar nada,
   * nao pode mudar logins e etc.. deixa ele pra ser visualizador e cria essa
   * opção de login, ve cliente, produto ve tudo tudo mas nao altera nada".
   *
   * LÊ tudo o que o escritório lê — pedido de qualquer representante, cliente
   * de qualquer carteira, catálogo, painel, representantes, a LISTA de logins,
   * tarefas e a tela da integração — e NÃO ESCREVE NADA. Nenhuma rota de
   * gravação aceita o papel; quem recusa é o `requireRole` da rota, não o
   * botão escondido na tela.
   */
  VISUALIZADOR: 'visualizador',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

/**
 * Papel dentro do token.
 *
 * `guest` NÃO é papel de banco: é a sessão de quem abriu uma vitrine
 * temporária. Não existe usuário, não existe senha, e o token morre junto com o
 * link. Por isso ele vive aqui e não em `UserRole`, que continua sendo só o que
 * a coluna `users.role` aceita.
 */
export type AuthRole = UserRole | 'guest';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  rep: 'Representante',
  store: 'Loja',
  financeiro: 'Financeiro',
  relacionamento: 'Relacionamento',
  visualizador: 'Visualizador',
};

/**
 * Os papéis da FÁBRICA que enxergam e mexem em pedido de qualquer
 * representante. O financeiro entra aqui: ele decide sobre faturamento, não
 * sobre carteira — a parte de representantes continua fora do alcance dele.
 *
 * O visualizador NÃO entra aqui de propósito (15/10/2026): esta lista diz
 * "quem MEXE em pedido de qualquer rep", e ele não mexe em nada. A lista de
 * quem só LÊ como eles é a de baixo.
 */
export const PAPEIS_DA_FABRICA: readonly AuthRole[] = ['admin', 'manager', 'financeiro'];

/**
 * Quem LÊ o que o escritório lê: pedido de qualquer representante, cliente de
 * qualquer carteira, painel, representantes. Mesma gente da fábrica MAIS o
 * visualizador — "ve cliente, produto ve tudo tudo mas nao altera nada" (Yan,
 * 15/10/2026).
 *
 * Existe separada de `PAPEIS_DA_FABRICA` para que acrescentar um papel de
 * leitura nunca signifique acrescentar um papel de escrita.
 */
export const PAPEIS_QUE_LEEM_O_ESCRITORIO: readonly AuthRole[] = [
  ...PAPEIS_DA_FABRICA,
  'visualizador',
];

/**
 * Papéis que NÃO gravam nada. Hoje só o visualizador.
 *
 * É a lista que as telas consultam para esconder botão — e é por ela que se
 * descobre, numa busca só, todo lugar que decide "este aqui não altera".
 * Nenhuma rota de escrita cita estes papéis; tests/visualizador-inventario
 * quebra se alguém citar.
 */
export const SO_LEITURA: readonly AuthRole[] = ['visualizador'];

/** Este papel só olha? (Papel ausente/desconhecido: não — quem decide é a rota.) */
export const ehSoLeitura = (papel: AuthRole | null | undefined): boolean =>
  papel != null && SO_LEITURA.includes(papel);

/**
 * Os papéis que o admin cria na tela de Logins (migração 054 acrescentou o
 * visualizador). Representante nasce em `/reps` e loja nasce por convite — por
 * isso nem um nem outro aparece aqui.
 *
 * Uma lista só: antes o mesmo conjunto estava escrito à mão em cinco lugares
 * (o `papelFixo` do formulário, o papel inicial, os botões do seletor, o
 * `daFabrica` da página e as duas validações do service), e quem acrescentava
 * um papel esquecia pelo menos um deles.
 */
export const PAPEIS_GERENCIAVEIS = [
  'manager',
  'financeiro',
  'relacionamento',
  'visualizador',
  'admin',
] as const satisfies readonly UserRole[];

/** O admin cria/edita este papel pela tela de Logins? */
export const ehPapelGerenciavel = (papel: unknown): papel is (typeof PAPEIS_GERENCIAVEIS)[number] =>
  typeof papel === 'string' && (PAPEIS_GERENCIAVEIS as readonly string[]).includes(papel);

/** Compram, mas não decidem: o pedido deles sempre vai para aprovação. */
export const PAPEIS_COMPRADORES: readonly AuthRole[] = ['store', 'guest'];

export const ehComprador = (papel: AuthRole): boolean => PAPEIS_COMPRADORES.includes(papel);
