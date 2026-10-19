import { ORDER_STATUS, type OrderStatus } from './orderStatus.js';

/**
 * Bonificação mensal do representante.
 *
 * Nasceu de um aviso que a fábrica manda por escrito:
 *
 *   "TODOS OS PEDIDOS ENVIADOS ENTRE AS DATAS 01 A 31 DE CADA MÊS SERÃO SOMADOS
 *    E, ATINGINDO A META, SERÁ BONIFICADO DA SEGUINTE FORMA."
 *
 * Desde 15/10/2026 o "pedidos enviados" do aviso se lê como "os APROVADOS do
 * que foi enviado no mês". Regra do Yan, nas palavras dele: "a bonificação é
 * de todos os pedidos que a Larissa aprovar; todos pedidos aprovados pela
 * fábrica viram bonificação. Mas o pedido pode ter o carimbo de inativo como o
 * de faturado: se o pedido for aprovado e depois inativado a pessoa não recebe
 * a bonificação." O MÊS continua sendo o do ENVIO (`created_at`): enviado
 * 30/09 e aprovado 02/10 conta em setembro. Ver `pedidoContaParaAMeta`.
 *
 * É um degrau só, não uma soma: quem envia R$ 160.000 leva o bônus da faixa mais
 * alta que alcançou, e não a soma de todas.
 *
 * As faixas NÃO são fixas. Cada representante tem as suas, e elas mudam de mês
 * para mês — quem cadastra é o gerente. Por isso tudo aqui recebe a lista de
 * faixas como argumento em vez de ler uma constante: a mesma conta serve para
 * quem tem duas faixas e para quem tem quatro.
 */
export interface FaixaDeBonus {
  /** Valor em pedidos enviados a partir do qual a faixa vale. */
  meta: number;
  /** Bônus pago ao atingir a faixa. */
  bonus: number;
}

/**
 * Faixas de um representante numa competência.
 *
 * `competencia` é o primeiro dia do mês ("2026-08-01"). O gerente cadastra
 * quando a bonificação muda; nos meses em que ele não mexe, vale o último
 * cadastro anterior — a bonificação costuma ficar meses igual, e obrigar o
 * gerente a recadastrar todo mês só criaria representante sem régua na tela.
 */
export interface MetaDoRepresentante {
  competencia: string;
  faixas: FaixaDeBonus[];
}

/** Teto de faixas por mês. Quatro bolinhas é o que cabe na régua do celular. */
export const MAX_FAIXAS_DE_BONUS = 4;

/**
 * As faixas do aviso impresso, usadas como ponto de partida no cadastro.
 * Não é regra: é o rascunho que o gerente edita.
 */
export const FAIXAS_PADRAO: readonly FaixaDeBonus[] = [
  { meta: 50_000, bonus: 500 },
  { meta: 80_000, bonus: 1_000 },
  { meta: 100_000, bonus: 1_500 },
  { meta: 150_000, bonus: 3_000 },
];

/**
 * Põe as faixas em ordem e joga fora o que não é faixa.
 *
 * O gerente digita numa grade e pode deixar linha em branco, repetir uma meta ou
 * cadastrar fora de ordem. Quem consome (a régua, o fechamento) precisa de uma
 * lista limpa e crescente, então a limpeza acontece uma vez, aqui.
 */
export function normalizarFaixas(faixas: readonly Partial<FaixaDeBonus>[]): FaixaDeBonus[] {
  const limpas = faixas
    .filter((f): f is FaixaDeBonus => Number(f.meta) > 0 && Number(f.bonus) > 0)
    .map((f) => ({ meta: Number(f.meta), bonus: Number(f.bonus) }))
    .sort((a, b) => a.meta - b.meta);

  // Meta repetida é erro de digitação: duas bolinhas no mesmo ponto da régua
  // ficariam uma em cima da outra, e a segunda nunca seria alcançável.
  const semRepetida = limpas.filter((f, i) => i === 0 || f.meta !== limpas[i - 1]!.meta);
  return semRepetida.slice(0, MAX_FAIXAS_DE_BONUS);
}

/**
 * Os STATUS que contam para a bonificação: o que o financeiro já APROVOU.
 *
 * Regra do Yan (15/10/2026): "todos pedidos aprovados pela fábrica viram
 * bonificação". Até então a fila do financeiro (`pending_approval`) também
 * contava — era "o que saiu da mão do representante"; desde essa data o pedido
 * enviado e ainda não aprovado NÃO conta, só depois do aceite. Ficam dentro o
 * aprovado, o já lançado no Control e o lançado com problema no ERP
 * (`error_erp` é aprovado com problema, não recusado). Ficam fora o rascunho,
 * a triagem da loja (`pending_rep`), a fila e o cancelado (`rejected`).
 *
 * É a mesma lista dos pedidos que podem ganhar o carimbo "Pedido inativo"
 * (055): só sai da bonificação quem estava dentro dela.
 *
 * Quase sempre quer-se `pedidoContaParaAMeta`, que olha o carimbo também.
 */
export const STATUS_QUE_CONTAM_PARA_A_META: readonly OrderStatus[] = [
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.SENT_ERP,
  ORDER_STATUS.ERROR_ERP,
];

export function contaParaAMeta(status: OrderStatus): boolean {
  return STATUS_QUE_CONTAM_PARA_A_META.includes(status);
}

/** O que a conta da meta precisa saber de um pedido. */
export interface PedidoParaAMeta {
  status: OrderStatus;
  /**
   * O carimbo "Pedido inativo" (migração 055). Ausente ou nulo = não está
   * inativo — sem a 055 a coluna nem vem, e ninguém está inativo.
   */
  inactive?: boolean | null | undefined;
}

/**
 * O PEDIDO conta para a bonificação?
 *
 * Status aprovado E sem o carimbo "Pedido inativo". Yan (15/10/2026): "se o
 * pedido for aprovado e depois inativado a pessoa não recebe a bonificação".
 * Toda tela que soma a meta passa por aqui — não por `contaParaAMeta(status)`
 * sozinho, que não enxerga o carimbo.
 */
export function pedidoContaParaAMeta(pedido: PedidoParaAMeta): boolean {
  return contaParaAMeta(pedido.status) && pedido.inactive !== true;
}

/**
 * A soma do mês para a régua: os pedidos ENVIADOS no mês de `referencia`
 * (`created_at`, mês e ano no fuso do aparelho) que contam, pelo total do
 * pedido. É a conta que a Minha Área e os Alertas mostram — uma só, para a
 * promessa da tela ser a mesma do fechamento.
 */
export function somaParaAMetaDoMes(
  pedidos: readonly (PedidoParaAMeta & { created_at: string; total?: number | null | undefined })[],
  referencia: Date = new Date(),
): number {
  const mes = referencia.getMonth();
  const ano = referencia.getFullYear();
  let soma = 0;
  for (const pedido of pedidos) {
    const enviadoEm = new Date(pedido.created_at);
    if (enviadoEm.getMonth() !== mes || enviadoEm.getFullYear() !== ano) continue;
    if (!pedidoContaParaAMeta(pedido)) continue;
    soma += pedido.total ?? 0;
  }
  return soma;
}

/** A faixa já garantida com o total enviado — ou `null` antes da primeira. */
export function faixaAlcancada(
  enviado: number,
  faixas: readonly FaixaDeBonus[],
): FaixaDeBonus | null {
  let alcancada: FaixaDeBonus | null = null;
  for (const faixa of faixas) {
    if (enviado >= faixa.meta) alcancada = faixa;
  }
  return alcancada;
}

/** A próxima faixa a perseguir — `null` quando já está no teto. */
export function proximaFaixa(
  enviado: number,
  faixas: readonly FaixaDeBonus[],
): FaixaDeBonus | null {
  return faixas.find((f) => enviado < f.meta) ?? null;
}

/**
 * Posição na régua, de 0 a 1.
 *
 * Cada faixa ocupa um pedaço IGUAL da régua, e não o seu tamanho em reais. Numa
 * escala linear os degraus de 80 e 100 mil ficariam colados e o trecho de 100 a
 * 150 mil ocuparia um terço da barra sozinho — o representante leria "estou
 * quase lá" onde faltam R$ 40.000. Com passos iguais, cada degrau parece o que
 * é: o próximo.
 */
export function posicaoNaRegua(enviado: number, faixas: readonly FaixaDeBonus[]): number {
  if (faixas.length === 0) return 0;
  const passo = 1 / faixas.length;
  let piso = 0;
  for (let i = 0; i < faixas.length; i++) {
    const teto = faixas[i]!.meta;
    if (enviado < teto) {
      return (i + (enviado - piso) / (teto - piso)) * passo;
    }
    piso = teto;
  }
  return 1;
}

/** Primeiro dia do mês de uma data, no formato que a competência usa. */
export function competenciaDe(data: Date = new Date()): string {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-01`;
}

/**
 * As faixas que valem numa competência: as do próprio mês ou, na falta delas, as
 * do último mês cadastrado antes dele. Cadastro futuro não vale para trás.
 */
export function faixasVigentes(
  metas: readonly MetaDoRepresentante[],
  competencia: string = competenciaDe(),
): FaixaDeBonus[] {
  const valida = metas
    .filter((m) => m.competencia <= competencia && m.faixas.length > 0)
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .at(-1);
  return valida ? [...valida.faixas] : [];
}
