/**
 * A régua da carteira: quem está comprando, quem esfriou, quem parou.
 *
 * A data vem do retrato do Control (Curva ABC) e é empurrada para frente por
 * todo pedido FATURADO no app — ver a migração 036. Por isso o selo sempre
 * mostra a data junto ("última compra em 12/03/26"): um retrato velho nunca
 * engana, está escrito de quando é.
 *
 * Os DIAS de cada faixa são da fábrica, não do código (migração 043). Quem
 * muda é o admin, no Painel. Enquanto a resposta da API não chega — primeira
 * abertura, celular sem sinal — vale a última régua guardada no aparelho, e
 * antes disso a de sempre (90/180).
 */
import {
  REGUA_PADRAO,
  reguaValida,
  frescorPorDias,
  diasSemComprar,
  type ReguaDaCarteira,
  type Frescor,
} from '@csb/shared';

export type { Frescor, ReguaDaCarteira };

/**
 * A situação que a tela mostra: a faixa da régua OU "varejo".
 *
 * Varejo não é faixa de dias — é a venda interna dizendo que aquele cliente de
 * balcão não volta (migração 047). Ele sai da régua inteira: nem atenção, nem
 * esfriado, nem alerta. Fica fora de `Frescor` (shared) de propósito: aquele
 * tipo é a conta de dias, e as chaves dele estão em link salvo.
 */
export type NivelDaCarteira = Frescor | 'varejo';

const CHAVE_GUARDADA = 'csb.regua-da-carteira';

function lerDoAparelho(): ReguaDaCarteira {
  try {
    const bruto = localStorage.getItem(CHAVE_GUARDADA);
    return bruto ? reguaValida(JSON.parse(bruto) as Partial<ReguaDaCarteira>) : REGUA_PADRAO;
  } catch {
    return REGUA_PADRAO;
  }
}

let regua: ReguaDaCarteira = lerDoAparelho();

/** A régua em vigor — o que as telas usam sem precisar receber por props. */
export function reguaDaCarteira(): ReguaDaCarteira {
  return regua;
}

/**
 * Troca a régua (a API respondeu, ou o admin acabou de salvar) e guarda no
 * aparelho. Devolve `true` quando algo mudou, para a tela se redesenhar.
 */
export function definirReguaDaCarteira(nova: Partial<ReguaDaCarteira> | null | undefined): boolean {
  const arrumada = reguaValida(nova);
  if (arrumada.atencao === regua.atencao && arrumada.esfriado === regua.esfriado) return false;
  regua = arrumada;
  try {
    localStorage.setItem(CHAVE_GUARDADA, JSON.stringify(arrumada));
  } catch {
    // Aparelho com armazenamento cheio ou aba anônima: a régua vale só nesta sessão.
  }
  return true;
}

export interface SituacaoDaCompra {
  nivel: NivelDaCarteira;
  /** Pronto para a tela: "Esfriado — sem comprar há 8 meses", "Comprou há 12 dias"… */
  rotulo: string;
  /** Dias desde a última compra. `null` sem registro. */
  dias: number | null;
}

function rotuloDeTempo(dias: number): string {
  if (dias < 1) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 60) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 24) return `há ${meses} meses`;
  return `há ${Math.floor(meses / 12)} anos`;
}

export function situacaoDaCompra(
  lastPurchaseAt: string | null | undefined,
  comRegua: ReguaDaCarteira = regua,
): SituacaoDaCompra {
  const dias = diasSemComprar(lastPurchaseAt);
  if (dias === null) {
    return { nivel: 'sem_registro', rotulo: 'Sem compra registrada', dias: null };
  }
  const nivel = frescorPorDias(dias, comRegua);
  if (nivel === 'parado') return { nivel, rotulo: `Esfriado — sem comprar ${rotuloDeTempo(dias)}`, dias };
  if (nivel === 'esfriando') return { nivel, rotulo: `Atenção — sem comprar ${rotuloDeTempo(dias)}`, dias };
  return { nivel: 'ativo', rotulo: `Comprou ${rotuloDeTempo(dias)}`, dias };
}

/**
 * A situação de UM cliente — o que selo, filtro, contagem e Minha Área usam.
 *
 * Marcado como varejo pela venda interna, a régua nem é consultada: é essa a
 * promessa ao Yan, "não ficar cobrando elas para entrar em contato de novo".
 */
export function situacaoDoCliente(
  cliente: { last_purchase_at?: string | null; varejo?: boolean | null },
  comRegua: ReguaDaCarteira = regua,
): SituacaoDaCompra {
  if (cliente.varejo === true) {
    const dias = diasSemComprar(cliente.last_purchase_at);
    return { nivel: 'varejo', rotulo: 'Cliente varejo — sem cobrança de contato', dias };
  }
  return situacaoDaCompra(cliente.last_purchase_at, comRegua);
}

/**
 * O vocabulário do Yan para as cores: verde de ativo, amarelo de atenção,
 * vermelho de ESFRIADO — nasceu "desativado" (31/08/2026), virou "inativo" no
 * mesmo dia e virou "esfriado" em 11/09/2026, que é como ele fala do cliente
 * que sumiu. Nome curto para chips e títulos.
 */
export const NOME_DO_NIVEL: Record<NivelDaCarteira, string> = {
  ativo: 'Ativo',
  esfriando: 'Atenção',
  parado: 'Esfriado',
  sem_registro: 'Sem registro',
  varejo: 'Varejo',
};

/** O mesmo nome no plural, para o chip que conta ("Esfriados (37)"). */
export const NOME_DO_NIVEL_PLURAL: Record<NivelDaCarteira, string> = {
  ativo: 'Ativos',
  esfriando: 'Atenção',
  parado: 'Esfriados',
  sem_registro: 'Sem registro',
  varejo: 'Varejo',
};

/** Cor do selo, no vocabulário do Badge. Varejo é neutro: fora da régua, nem bom nem ruim. */
export const VARIANTE_DO_FRESCOR: Record<NivelDaCarteira, 'gray' | 'yellow' | 'green' | 'red' | 'brand'> = {
  ativo: 'green',
  esfriando: 'yellow',
  parado: 'red',
  sem_registro: 'gray',
  varejo: 'gray',
};

/** "90 a 180 dias sem comprar" — para explicar a faixa na tela do admin. */
export function faixaEmPalavras(nivel: Frescor, r: ReguaDaCarteira = regua): string {
  if (nivel === 'ativo') return `comprou nos últimos ${r.atencao} dias`;
  if (nivel === 'esfriando') return `${r.atencao} a ${r.esfriado} dias sem comprar`;
  if (nivel === 'parado') return `${r.esfriado} dias ou mais sem comprar`;
  return 'sem compra registrada';
}
