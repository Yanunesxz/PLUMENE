import { supabase } from '../config/supabase.js';
import { detectarOuFalhar } from './detectarColuna.js';

/**
 * O CANAL OFICIAL de cada fluxo com o Control, por empresa (migração 048, B).
 *
 * Um fluxo tem UM escritor. Hoje o número do pedido pode chegar pela tela, pela
 * API de parceiro ou pelo sync.py; o faturado, pelo botão, pela API ou por
 * script. Dois escritores no mesmo fluxo é pedido lançado duas vezes no ERP e
 * faturamento que se desfaz sozinho. O canal diz qual caminho vale para aquela
 * empresa — e os outros recusam.
 *
 * Os padrões são o comportamento de hoje (planilha e cargas à mão; API, sync.py
 * e Firebird fechados). Sem a 048 aplicada vale exatamente o padrão. A virada é
 * um UPDATE por empresa feito pelo Yan no SQL Editor.
 */

export const VALORES_DOS_CANAIS = {
  pedido_erp: ['manual', 'api', 'sync_py'],
  faturamento: ['manual', 'api'],
  cadastro: ['carga', 'api', 'firebird'],
  retrato: ['carga', 'api'],
  catalogo: ['carga', 'api', 'firebird'],
} as const;

export type NomeDoCanal = keyof typeof VALORES_DOS_CANAIS;
export type CanalPedidoErp = (typeof VALORES_DOS_CANAIS.pedido_erp)[number];
export type CanalFaturamento = (typeof VALORES_DOS_CANAIS.faturamento)[number];
export type CanalCadastro = (typeof VALORES_DOS_CANAIS.cadastro)[number];
export type CanalRetrato = (typeof VALORES_DOS_CANAIS.retrato)[number];
export type CanalCatalogo = (typeof VALORES_DOS_CANAIS.catalogo)[number];

export type ValorDoCanal<C extends NomeDoCanal> = (typeof VALORES_DOS_CANAIS)[C][number];

export interface Canais {
  pedido_erp: CanalPedidoErp;
  faturamento: CanalFaturamento;
  cadastro: CanalCadastro;
  retrato: CanalRetrato;
  catalogo: CanalCatalogo;
  /** `false` = a 048 ainda não rodou neste banco e os valores são os padrões. */
  migracao: boolean;
}

/** O comportamento de hoje. É o que vale sem a 048 e para empresa sem linha. */
export const CANAIS_PADRAO: Readonly<Omit<Canais, 'migracao'>> = Object.freeze({
  pedido_erp: 'manual',
  faturamento: 'manual',
  cadastro: 'carga',
  retrato: 'carga',
  catalogo: 'carga',
});

/** A coluna de `companies` de cada canal. */
const COLUNA: Record<NomeDoCanal, string> = {
  pedido_erp: 'canal_pedido_erp',
  faturamento: 'canal_faturamento',
  cadastro: 'canal_cadastro',
  retrato: 'canal_retrato',
  catalogo: 'canal_catalogo',
};

/**
 * Quanto tempo confiar no canal lido. A virada é rara e feita à mão; 30 s de
 * atraso não mudam nada e poupam uma consulta por requisição do parceiro.
 */
const VALIDADE_MS = 30_000;

const memoria = new Map<string, { canais: Canais; ate: number }>();

/** Para os testes (e para quem acabou de virar um canal): esquece o que leu. */
export function esquecerCanais(): void {
  memoria.clear();
}

function valorValido<C extends NomeDoCanal>(canal: C, bruto: unknown): ValorDoCanal<C> {
  const lista = VALORES_DOS_CANAIS[canal] as readonly string[];
  if (typeof bruto === 'string' && lista.includes(bruto)) return bruto as ValorDoCanal<C>;
  // O CHECK da 048 impede isto no banco. Se acontecer (SQL à mão sem a trava),
  // vale o padrão — que é o comportamento de hoje — e fica escrito.
  if (bruto != null) {
    console.error(`[canais] valor desconhecido em ${COLUNA[canal]}: ${JSON.stringify(bruto)}; usando o padrão`);
  }
  return CANAIS_PADRAO[canal] as ValorDoCanal<C>;
}

/**
 * Os canais de uma empresa.
 *
 * - Sem a 048 (coluna ausente): os padrões, com `migracao: false`.
 * - Banco que não respondeu (nem sobre o schema, nem na leitura): LANÇA. Um
 *   soluço de rede não pode abrir nem fechar canal — quem chamou responde 500
 *   e o parceiro (ou a tela) tenta de novo.
 * - Empresa sem linha: os padrões, com `migracao: true`.
 */
export async function lerCanais(company_id: string): Promise<Canais> {
  const lembrado = memoria.get(company_id);
  if (lembrado && lembrado.ate > Date.now()) return { ...lembrado.canais };

  let canais: Canais;
  if (!(await detectarOuFalhar('companies', 'canal_pedido_erp'))) {
    canais = { ...CANAIS_PADRAO, migracao: false };
  } else {
    const { data, error } = await supabase
      .from('companies')
      .select(Object.values(COLUNA).join(', '))
      .eq('id', company_id)
      .maybeSingle();
    if (error) {
      throw new Error(`Falha ao ler os canais da empresa ${company_id}: ${error.message}`);
    }
    const linha = (data ?? {}) as Record<string, unknown>;
    canais = {
      pedido_erp: valorValido('pedido_erp', linha[COLUNA.pedido_erp]),
      faturamento: valorValido('faturamento', linha[COLUNA.faturamento]),
      cadastro: valorValido('cadastro', linha[COLUNA.cadastro]),
      retrato: valorValido('retrato', linha[COLUNA.retrato]),
      catalogo: valorValido('catalogo', linha[COLUNA.catalogo]),
      migracao: true,
    };
  }

  memoria.set(company_id, { canais, ate: Date.now() + VALIDADE_MS });
  return { ...canais };
}

export interface CanalRecusado<C extends NomeDoCanal = NomeDoCanal> {
  canal: C;
  valor_atual: ValorDoCanal<C>;
}

/**
 * O canal da empresa é `valor`? `null` quando é (pode seguir); senão, qual é o
 * canal e o valor que está valendo — para a resposta 409 dizer.
 *
 * Lança como `lerCanais` quando o banco não respondeu.
 */
export async function exigirCanal<C extends NomeDoCanal>(
  company_id: string,
  canal: C,
  valor: ValorDoCanal<C>,
): Promise<CanalRecusado<C> | null> {
  const canais = await lerCanais(company_id);
  const atual = canais[canal] as ValorDoCanal<C>;
  return atual === valor ? null : { canal, valor_atual: atual };
}

const NOME_NA_MENSAGEM: Record<NomeDoCanal, string> = {
  pedido_erp: 'pedidos',
  faturamento: 'faturamento',
  cadastro: 'cadastro',
  retrato: 'retrato',
  catalogo: 'catálogo',
};

/**
 * O corpo do 409 das rotas do parceiro quando o canal não está ligado para a
 * API. Uma fonte só para o texto e o código, para as rotas não divergirem.
 */
export function corpoCanalFechado<C extends NomeDoCanal>(recusa: CanalRecusado<C>) {
  return {
    error: `Canal de ${NOME_NA_MENSAGEM[recusa.canal]} ainda não está ligado para a API nesta empresa`,
    code: 'CANAL_FECHADO' as const,
    statusCode: 409 as const,
    canal: recusa.canal,
    valor_atual: recusa.valor_atual,
  };
}
