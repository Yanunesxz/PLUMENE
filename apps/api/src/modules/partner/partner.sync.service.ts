/**
 * Recebe dados que o ERP do parceiro empurra e grava no Supabase — e devolve
 * ao parceiro o que mudou no app (a sincronização nas duas mãos).
 *
 * É a mão inversa da API de pedidos: em vez de o parceiro BUSCAR pedidos, ele
 * MANDA clientes e representantes atualizados. Leitura do lado dele, escrita do
 * nosso — e só nas tabelas que o app usa, nunca no banco do ERP.
 *
 * Política tolerante, combinada com o Yan: recusa apenas o registro que não dá
 * para usar (sem código, sem nome, código repetido) e aceita o resto,
 * devolvendo a lista do que foi ignorado e por quê. Dado incompleto entra; dado
 * impossível é reportado.
 *
 * COMO GUARDA (fase 0, 15/09/2026 — antes disto um envio só com código e razão
 * social apagava tabela, WhatsApp e endereço e desbloqueava o cliente):
 *
 *   • campo AUSENTE não mexe; `null` explícito limpa. Texto vazio ("" — o CHAR
 *     nulo do Firebird serializado à mão) conta como ausente;
 *   • a leitura do que já existe vem ANTES de qualquer gravação, e se ela falha
 *     a rota inteira vira 500 sem ter gravado nada (o robô tenta de novo);
 *   • grava só as colunas que mudaram; sem mudança, nada vai ao banco (nem
 *     `updated_at`) e o registro conta em `sem_mudanca`. Reenviar o mesmo lote é
 *     inofensivo;
 *   • a falha ao gravar UM registro vira ignorado com o motivo, e o lote segue.
 *
 * A CHAVE DO CLIENTE É O CNPJ (decisão do Yan, 16/09/2026): o casamento é
 * PRIMEIRO pelo documento só em dígitos e DEPOIS pelo código do ERP, casado pelo
 * miolo (`codigoMiolo`, de @csb/shared — "#2225", "2225" e "02225" são o mesmo
 * cadastro). Cliente que nasceu no app não tem código: o Control cria o cadastro
 * lá, manda o mesmo CNPJ com o código, e o cadastro daqui APRENDE o código. Quem
 * já tem código nunca tem o código reescrito — e o registro cujo CNPJ acha um
 * cadastro de OUTRO código é recusado inteiro (não troca nome, carteira nem
 * tabela de outro cliente). O índice único de
 * `customers(company_id, erp_id)` é exato, então o upsert é feito por mapa
 * (busca os existentes, decide update ou insert) — não por `onConflict`.
 *
 * O que o Control passou a mandar (049) fica em coluna própria, com `detectar`:
 * pendência financeira, títulos vencidos, motivo do bloqueio (block_reason, da
 * 001) e o carimbo `erp_updated_at`. Bloqueio do Control NÃO trava o
 * representante — o financeiro é avisado (o aviso é da tela).
 *
 * O CARIMBO (`erp_updated_at`) é o momento em que o app gravou o que o Control
 * mandou — nunca o `data_update` do Control, que é passado e faria o cliente
 * voltar no GET ?desde= logo em seguida. E `data_update` sozinho não é
 * mudança: reenviar o mesmo cadastro com outro DATA_UPDATE é `sem_mudanca`
 * (senão o Control, recarimbando ao gravar o que puxou, entraria num
 * pingue-pongue sem fim). As regras do eco moram em partner.eco.ts.
 *
 * A EDIÇÃO DO CADASTRO FEITA NO APP (051, 17/09/2026) não é apagada pelo
 * Control: enquanto ela está pendente (ainda não chegou lá), a coluna que o
 * Control mandar com outro valor fica com o valor do app e volta em `avisos`;
 * quando ele manda o mesmo valor, a edição é dada por resolvida pela API. As
 * pendências são lidas em lote, depois dos clientes e antes da primeira
 * gravação — e relidas depois dela, para a edição que caiu entre as duas
 * gravações da tela (passo 3b). Sem a 051, tudo como antes. As regras moram em
 * partner.edicaoNoApp.ts.
 *
 * O WHATSAPP É DO APP (22/09/2026, Yan: "numero uma coisa numero de wtss
 * outro"). No cliente EXISTENTE com WhatsApp preenchido, o `whatsapp` que o
 * Control mandar é ignorado — sem aviso: é regra, não conflito. Vazio (ou
 * nulo), é preenchido; cliente novo recebe o do Control. Vale com e sem a 051.
 * Revisão do mesmo dia: o WhatsApp que não é telefone (um nome, resto de carga
 * antiga) conta como vazio; o vazio que o APP deixou (o representante apagou —
 * está no histórico da 051) continua vazio; e o `whatsapp` vazio do Control
 * nunca apaga nada. Ver o passo 2 e o 2d.
 */
import {
  CAMPOS_SO_DO_APP,
  CAMPO_DO_CONTRATO_DO_PARCEIRO,
  algumCampoVaiParaOControl,
  apenasDigitos,
  campoSoDoAppPreenchido,
  camposNoContratoDoParceiro,
  codigoCanonico,
  codigoMiolo,
  linhaDeEndereco,
  normalizarCampoDoCadastro,
} from '@csb/shared';
import type { AlteracaoDoCliente, CampoSoDoApp, NomeNoContratoDoParceiro } from '@csb/shared';
import { supabase } from '../../config/supabase.js';
import { buscarPelaChaveOuFalhar, buscarTudoOuFalhar, depoisDaChave, emLotes } from '../../lib/paginacao.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';
import {
  alteradoNoApp,
  camposSoDoAppEditadosEmLote,
  colocarNaFilaDoControl,
  lerAlteracoesForaDaFilaEmLote,
  lerAlteracoesPendentesEmLote,
  resolverAlteracoesPelaApi,
} from '../customers/customers.alteracoes.service.js';
import { podeCarimbar, ultimaMaoFoiDoControl } from './partner.eco.js';
import { colunasQueOLoteApagou, conferirEdicoesDoApp } from './partner.edicaoNoApp.js';

// ─── Tipos do corpo que o parceiro envia ─────────────────────────────────────

export interface EnderecoParceiro {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
}

export interface ClienteParceiro {
  codigo?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cnpj_cpf?: string | null;
  representante?: string | null;
  tabela_preco?: string | null;
  /** Objeto com os pedaços, ou a linha já montada. */
  endereco?: EnderecoParceiro | string | null;
  bloqueado?: string | boolean | null;
  limite_credito?: number | string | null;
  whatsapp?: string | null;
  email?: string | null;
  /** Colunas da migração 041 — guardadas só onde ela rodou. */
  inscricao_estadual?: string | null;
  observacoes?: string | null;
  /** O motivo do bloqueio no Control (customers.block_reason). `null` limpa. */
  motivo_bloqueio?: string | null;
  /**
   * O que o Control informa da situação financeira (049): R$ em aberto e
   * quantos títulos vencidos. `null` limpa; negativo ou ilegível não mexe e
   * avisa. Sem a 049, ficam de fora com aviso.
   */
  pendencia_financeira?: number | string | null;
  titulos_vencidos?: number | string | null;
  /**
   * Quando o cadastro mudou no Control (DATA_UPDATE), momento COM fuso.
   * Informativo: é conferido (sem fuso vira aviso), mas não é gravado e não
   * conta como mudança. O carimbo do Control (customers.erp_updated_at) é o
   * momento em que o app gravou o registro.
   */
  data_update?: string | null;
}

export interface RepresentanteParceiro {
  codigo?: string | null;
  nome?: string | null;
  razao_social?: string | null;
  /**
   * O e-mail do representante NO CONTROL. Vai para users.erp_email (049);
   * NUNCA para users.email, que é o login e só muda pelas telas. Sem a 049, é
   * ignorado (com aviso quando difere do login, como sempre foi).
   */
  email?: string | null;
  ativo?: string | boolean | null;
}

export interface ResultadoSync {
  recebidos: number;
  criados: number;
  atualizados: number;
  /** Registros casados com um cadastro que já estava igual — nada foi gravado. */
  sem_mudanca: number;
  ignorados: Array<{ codigo: string | null; motivo: string }>;
  avisos: string[];
}

// ─── O que volta ao parceiro (GET ?desde=) ───────────────────────────────────

/**
 * Um cliente como o app o tem, NO MESMO FORMATO que o POST /clientes aceita —
 * o parceiro pode devolver o registro como veio. Os campos a mais são só
 * leitura e o POST os ignora.
 */
export interface ClienteAlterado {
  /** O código no Control. `null` = nasceu no app e ainda não tem código. */
  codigo: string | null;
  /** A chave entre os sistemas: CNPJ/CPF só dígitos. `null` = sem documento. */
  chave: string | null;
  /** `true` = o Control ainda não conhece este cliente (sem código): crie e devolva o código. */
  novo_no_control: boolean;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj_cpf: string | null;
  representante: string | null;
  /** O código da tabela de preço no ERP (`null` = sem tabela, ou tabela sem código). */
  tabela_preco: string | null;
  /** Os pedaços (onde a 041 rodou) ou a linha de texto. */
  endereco: EnderecoParceiro | string | null;
  inscricao_estadual?: string | null;
  observacoes?: string | null;
  bloqueado: 'S' | 'N';
  motivo_bloqueio: string | null;
  limite_credito: number | null;
  whatsapp: string | null;
  email: string | null;
  pendencia_financeira?: number | null;
  titulos_vencidos?: number | null;
  /** Quando mudou no app (customers.updated_at). */
  atualizado_em: string;
  /** Quando o Control mandou pela última vez (049). Ausente sem a migração. */
  atualizado_pelo_control_em?: string | null;
  /**
   * Edição do cadastro feita no app que ainda não chegou ao Control (051): a
   * mais recente e os campos pendentes, com os nomes deste contrato. `null` =
   * nada pendente (ou a 051 ainda não rodou). Aditivo: sai sempre.
   */
  alterado_no_app: AlteradoNoApp | null;
}

/** O `alterado_no_app` de um cliente no GET /clientes. */
export interface AlteradoNoApp {
  /** Quando foi a edição pendente mais recente. */
  em: string;
  /** Os campos com edição pendente, na ordem do contrato (o endereço é um só: `endereco`). */
  campos: NomeNoContratoDoParceiro[];
}

/** Um representante como o app o tem, no formato do POST /representantes. */
export interface RepresentanteAlterado {
  codigo: string;
  nome: string;
  razao_social: string | null;
  /** O e-mail que o Control mandou (users.erp_email). Ausente sem a 049. */
  email?: string | null;
  ativo: 'S' | 'N';
  /** Quando mudou no app (users.updated_at, da 048). `null` sem a migração. */
  atualizado_em: string | null;
}

export interface ListaAlterados<T> {
  registros: T[];
  avisos: string[];
}

// ─── Leitura do que veio ─────────────────────────────────────────────────────

/** O campo não veio (ou veio vazio), ou veio com um valor — `null` = limpar. */
type Recebido<T> = { veio: false } | { veio: true; valor: T | null };

const NAO_VEIO = { veio: false } as const;

/** Até quantos códigos um aviso lista (o resto vira "e mais N"). */
const CODIGOS_POR_AVISO = 20;

/** Momento com data, hora e fuso: `Z` ou `±hh:mm`. */
const MOMENTO_COM_FUSO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const tem = (obj: Record<string, unknown>, chave: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, chave) && obj[chave] !== undefined;

/** Texto aparado, ou null quando não há texto (ausente, vazio ou não é texto). */
const textoSimples = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * Campo de texto: ausente, "" ou só espaços não mexem; `null` limpa; número
 * vira texto; objeto ou lista (lixo) não mexe.
 */
function lerTexto(obj: Record<string, unknown>, chave: string): Recebido<string> {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  const s = textoSimples(v);
  return s === null ? NAO_VEIO : { veio: true, valor: s };
}

const SIM = new Set(['S', 'SIM', 'TRUE', '1']);
const NAO = new Set(['N', 'NAO', 'NÃO', 'FALSE', '0']);

/**
 * `bloqueado`: S/SIM/true/1 bloqueia, N/NÃO/false/0 desbloqueia, `null` limpa
 * (desbloqueia: a coluna é NOT NULL com padrão false). Ausente ou "" não mexe —
 * antes, qualquer envio sem o campo desbloqueava o cliente. Texto que não é
 * nada disso também não mexe e volta como aviso.
 */
function lerBloqueado(obj: Record<string, unknown>): Recebido<boolean> | { veio: 'invalido' } {
  if (!tem(obj, 'bloqueado')) return NAO_VEIO;
  const v = obj['bloqueado'];
  if (v === null) return { veio: true, valor: false };
  if (typeof v === 'boolean') return { veio: true, valor: v };
  const s = textoSimples(v);
  if (s === null) return NAO_VEIO;
  const S = s.toUpperCase();
  if (SIM.has(S)) return { veio: true, valor: true };
  if (NAO.has(S)) return { veio: true, valor: false };
  return { veio: 'invalido' };
}

/**
 * `ativo` do representante: SÓ S, N, true ou false mexem no acesso. É o que
 * liga e desliga o login — `null`, "" ou qualquer outra coisa não mexem (os
 * não reconhecidos voltam como aviso).
 */
function lerAtivo(obj: Record<string, unknown>): boolean | 'invalido' | undefined {
  if (!tem(obj, 'ativo')) return undefined;
  const v = obj['ativo'];
  if (typeof v === 'boolean') return v;
  if (v === null) return undefined;
  const s = textoSimples(v);
  if (s === null) return undefined;
  const S = s.toUpperCase();
  if (S === 'S' || S === 'TRUE') return true;
  if (S === 'N' || S === 'FALSE') return false;
  return 'invalido';
}

/**
 * Valor em reais (`limite_credito`, `pendencia_financeira`): número ou texto
 * numérico ("1500.50", "1.500,50"). `null` limpa. Negativo ou ilegível não
 * mexe e volta como aviso (a 013 recusa limite negativo no banco — antes isso
 * derrubava o lote inteiro).
 */
function lerValor(obj: Record<string, unknown>, chave: string): Recebido<number> | { veio: 'invalido' } {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const s = textoSimples(v);
    if (s === null) return NAO_VEIO;
    n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  }
  if (!Number.isFinite(n) || n < 0) return { veio: 'invalido' };
  return { veio: true, valor: Math.round(n * 100) / 100 };
}

/** Contagem (`titulos_vencidos`): inteiro não negativo, número ou texto. `null` limpa. */
function lerInteiro(obj: Record<string, unknown>, chave: string): Recebido<number> | { veio: 'invalido' } {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  const s = textoSimples(v);
  if (s === null) return NAO_VEIO;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) return { veio: 'invalido' };
  return { veio: true, valor: n };
}

/**
 * Momento com fuso (`data_update`). `null` e "" contam como não veio. Sem fuso
 * ou ilegível volta como aviso: "2026-09-16T10:00:00" é uma hora no Railway
 * (UTC) e outra no Control (Brasília).
 */
function lerMomento(obj: Record<string, unknown>, chave: string): Recebido<string> | { veio: 'invalido' } {
  if (!tem(obj, chave)) return NAO_VEIO;
  const s = textoSimples(obj[chave]);
  if (s === null) return NAO_VEIO;
  if (!MOMENTO_COM_FUSO.test(s) || Number.isNaN(Date.parse(s))) return { veio: 'invalido' };
  return { veio: true, valor: s };
}

/** CNPJ/CPF só dígitos — 11 (CPF) ou mais; menos que isso é lixo de digitação. */
const digitosDoDocumento = (v: unknown): string | null => {
  const s = textoSimples(v);
  if (!s) return null;
  const d = apenasDigitos(s);
  return d.length >= 11 ? d : null;
};

/** O valor que está no banco é o mesmo que chegou? (número compara em centavos) */
function mesmoValor(atual: unknown, novo: unknown): boolean {
  const a = atual === undefined ? null : atual;
  if (a === null || novo === null) return a === novo;
  if (typeof novo === 'number') {
    const n = typeof a === 'number' ? a : Number(a);
    return Number.isFinite(n) && Math.round(n * 100) === Math.round(novo * 100);
  }
  return a === novo;
}

/** "a, b, c" com no máximo CODIGOS_POR_AVISO itens. */
function listar(codigos: Iterable<string>): string {
  const todos = [...codigos];
  const mostrados = todos.slice(0, CODIGOS_POR_AVISO).join(', ');
  return todos.length > CODIGOS_POR_AVISO ? `${mostrados} e mais ${todos.length - CODIGOS_POR_AVISO}` : mostrados;
}

/** Número de uma coluna NUMERIC que o banco pode devolver como texto. */
function numeroOuNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Clientes ────────────────────────────────────────────────────────────────

/** Os pedaços do endereço: mesmos nomes no corpo e nas colunas da 041. */
const PECAS_DO_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'] as const;
type PecaDoEndereco = (typeof PECAS_DO_ENDERECO)[number];

/** Colunas de `customers` que esta rota compara e grava. */
const COLUNAS_DO_CLIENTE =
  'id, erp_id, name, trade_name, cnpj, rep_erp_id, price_table_id, blocked, block_reason, credit_limit, whatsapp, email, address';
/** As da migração 041, só onde ela rodou. */
const COLUNAS_DA_041 = `${PECAS_DO_ENDERECO.join(', ')}, inscricao_estadual, observacoes`;
/** As da migração 049 que esta rota grava, só onde ela rodou. */
const COLUNAS_DA_049 = 'erp_updated_at, pendencia_financeira, pendencia_financeira_em, titulos_vencidos';

type LinhaCliente = { id: string; erp_id: string | null; cnpj: string | null } & Record<string, unknown>;

/** A 041 em customers existe? Lança quando o banco não respondeu. */
const detectarCadastroReal = () => detectarOuFalhar('customers', 'cep');
/** As colunas da 049 em customers existem? Nascem juntas; a sonda é uma. */
const detectarClienteDa049 = () => detectarOuFalhar('customers', 'pendencia_financeira');

/**
 * O que o `endereco` recebido pede para gravar.
 *
 *   • ausente, "" ou {} → nada;
 *   • null → limpa a linha (e os pedaços, com a 041);
 *   • texto → a linha como veio; os pedaços não são mexidos;
 *   • objeto → com a 041, grava os pedaços que vieram e remonta a linha a
 *     partir do resultado FINAL (o que veio por cima do que já estava). Sem a
 *     041 não há pedaços guardados para completar: a linha é montada só com o
 *     que veio, como sempre foi.
 */
function enderecoPedido(
  raw: Record<string, unknown>,
  cadastroReal: boolean,
  atual: LinhaCliente | undefined,
): { campos: Record<string, unknown>; pedacosSem041: boolean } {
  const nada = { campos: {}, pedacosSem041: false };
  if (!tem(raw, 'endereco')) return nada;
  const e = raw['endereco'];

  if (e === null) {
    const campos: Record<string, unknown> = { address: null };
    if (cadastroReal) for (const p of PECAS_DO_ENDERECO) campos[p] = null;
    return { campos, pedacosSem041: false };
  }
  if (typeof e === 'string') {
    const s = e.trim();
    return s === '' ? nada : { campos: { address: s }, pedacosSem041: false };
  }
  if (!ehObjeto(e)) return nada;

  const pecas: Partial<Record<PecaDoEndereco, string | null>> = {};
  for (const p of PECAS_DO_ENDERECO) {
    const lido = lerTexto(e, p);
    if (!lido.veio) continue;
    if (lido.valor === null) pecas[p] = null;
    else if (p === 'cep') {
      // CEP guardado só com dígitos (como o cadastro do app, 041). Texto sem
      // dígito nenhum não é CEP: não mexe.
      const d = apenasDigitos(lido.valor);
      if (d !== '') pecas[p] = d;
    } else pecas[p] = p === 'uf' ? lido.valor.toUpperCase() : lido.valor;
  }
  if (Object.keys(pecas).length === 0) return nada;

  if (!cadastroReal) {
    return { campos: { address: linhaDeEndereco(pecas) || null }, pedacosSem041: true };
  }
  const final: Partial<Record<PecaDoEndereco, string | null>> = {};
  for (const p of PECAS_DO_ENDERECO) {
    const guardado = atual?.[p];
    final[p] = p in pecas ? (pecas[p] ?? null) : typeof guardado === 'string' ? guardado : null;
  }
  return { campos: { ...pecas, address: linhaDeEndereco(final) || null }, pedacosSem041: false };
}

/**
 * Os códigos de representante que têm login, por miolo → as grafias gravadas
 * nos logins. Só alimenta avisos: se a leitura falhar, devolve null e o lote
 * segue (o aviso diz que não deu para conferir).
 */
async function codigosDosLogins(company_id: string): Promise<Map<string, Set<string>> | null> {
  const { data, error } = await supabase
    .from('users')
    .select('erp_rep_id')
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .not('erp_rep_id', 'is', null);
  if (error) return null;
  const mapa = new Map<string, Set<string>>();
  for (const u of (Array.isArray(data) ? data : []) as Array<{ erp_rep_id: string | null }>) {
    const m = codigoMiolo(u.erp_rep_id);
    if (!m || typeof u.erp_rep_id !== 'string') continue;
    const grafias = mapa.get(m) ?? new Set<string>();
    grafias.add(u.erp_rep_id);
    mapa.set(m, grafias);
  }
  return mapa;
}

/** As tabelas de preço da empresa: id ↔ código do ERP. Lança quando a leitura falha. */
async function tabelasDePreco(company_id: string): Promise<Array<{ id: string; erp_code: string | null }>> {
  const { data, error } = await supabase
    .from('price_tables')
    .select('id, erp_code')
    .eq('company_id', company_id);
  if (error) throw new Error(`Ler as tabelas de preço falhou: ${error.message}`);
  return (Array.isArray(data) ? data : []) as Array<{ id: string; erp_code: string | null }>;
}

/**
 * O motivo de `ignorados` do registro cujo cadastro mudou no app entre a
 * leitura do lote e a gravação (compare-and-set do passo 3). Contrato
 * publicado (docs/API-PARCEIRO.md e api-parceiro.html): texto exato.
 */
export const MOTIVO_MUDOU_NO_APP_DURANTE_O_ENVIO = 'cadastro alterado no app durante o envio — reenvie';

/**
 * Os documentos ANTIGOS dos clientes cujo CPF/CNPJ foi trocado no app e ainda
 * não chegou ao Control (051), por miolo do código: o passo 1b de
 * `receberClientes`.
 *
 * Só olha os registros cujo código acha UM cadastro no app com documento
 * diferente do que veio — é só aí que o casamento pelo documento pode achar a
 * loja errada — e lê as pendências só desses, numa consulta por lote. Sem
 * candidato, nem sonda a 051. Sem a 051, mapa vazio (tudo como antes). Falha
 * na leitura LANÇA, antes de qualquer gravação.
 *
 * Serve também o POST /partner/v1/retrato (revisão de 17/09/2026), que casa o
 * cliente pelo mesmo caminho (documento primeiro) e manda o documento em
 * `cnpj` — `chaveDoDocumento` diz qual chave do registro ler.
 */
export async function documentosAntigosPendentes<L extends { id: string; cnpj: string | null }>(
  company_id: string,
  clientes: readonly unknown[],
  porMiolo: ReadonlyMap<string, L>,
  mioloComDoisCadastros: ReadonlySet<string>,
  chaveDoDocumento = 'cnpj_cpf',
): Promise<Map<string, { cliente: L; antigos: Set<string> }>> {
  const candidatos = new Map<string, L>();
  for (const raw of clientes) {
    if (!ehObjeto(raw)) continue;
    const miolo = codigoMiolo(textoSimples(raw['codigo']));
    const documento = digitosDoDocumento(raw[chaveDoDocumento]);
    if (!miolo || !documento || mioloComDoisCadastros.has(miolo)) continue;
    const cliente = porMiolo.get(miolo);
    if (cliente && digitosDoDocumento(cliente.cnpj) !== documento) candidatos.set(miolo, cliente);
  }
  const trocados = new Map<string, { cliente: L; antigos: Set<string> }>();
  if (candidatos.size === 0) return trocados;
  const pendentes = await lerAlteracoesPendentesEmLote(
    company_id,
    [...candidatos.values()].map((c) => c.id),
  );
  if (!pendentes) return trocados;
  for (const [miolo, cliente] of candidatos) {
    const antigos = new Set<string>();
    for (const a of pendentes.get(cliente.id) ?? []) {
      const antigo = digitosDoDocumento(a.campos.cnpj?.antes);
      if (antigo) antigos.add(antigo);
    }
    if (antigos.size > 0) trocados.set(miolo, { cliente, antigos });
  }
  return trocados;
}

/**
 * Os clientes do app SEM CÓDIGO cujo CPF/CNPJ foi corrigido aqui, por documento
 * ANTIGO — o que o Control ainda tem (051, revisão de 17/09/2026).
 *
 * O buraco que isto fecha: o cliente nasce no app sem código, o Control o puxa
 * no GET (`novo_no_control`) e leva horas para devolver o código; nesse meio o
 * financeiro corrige o documento aqui — é o que a tela convida a fazer, porque
 * ela diz "ainda sem código no Control". Quando o código enfim chega no POST,
 * ele vem com o documento ANTIGO: o casamento pelo documento não acha nada (o
 * app tem o novo) e o casamento pelo código também não (o cliente ainda não tem
 * código). O registro virava INSERT calado — duas lojas no app, a nova com o
 * código, a carteira, o bloqueio e o limite, e a original (com os pedidos e o
 * documento certo) saindo de novo no GET como nova, para o Control criar um
 * segundo cadastro do lado dele.
 *
 * Achado por aqui, o cliente é ADOTADO como qualquer outro: aprende o código, o
 * documento do app é mantido (o passo 2c tira a coluna e avisa) e a correção
 * entra na fila do Control. A edição de cliente sem código nasce FORA da fila
 * (`erp_pendente = false`, ela iria junto na inclusão), então aqui se olham
 * TODAS as trocas de documento — pendentes ou não.
 *
 * Só custa uma consulta quando algum registro do lote traz documento e um
 * código que o app ainda não tem; sem isso, nem sonda a 051. Falha na leitura
 * LANÇA, antes de gravar. O mesmo documento antigo em dois clientes sem código
 * não escolhe nenhum: adivinhar fundiria duas lojas.
 *
 * O documento que HOJE é de outro cadastro também é candidato (revisão de
 * 17/09/2026). Era justamente o caso comum — a correção tira do cliente um
 * CNPJ que era de outra loja, e essa loja se cadastra depois com ele —, e o
 * corte "só documento sem dono" mandava o registro para a outra loja: ela
 * ganhava o código, a razão social, a carteira, o bloqueio e o limite do
 * cliente certo, que seguia sem código. Quem decide entre os dois é
 * `clientePeloDocumentoAntigo`.
 */
export async function clientesSemCodigoComDocumentoCorrigido<
  L extends { id: string; erp_id: string | null; cnpj: string | null },
>(
  company_id: string,
  clientes: readonly unknown[],
  existentes: readonly L[],
  porMiolo: ReadonlyMap<string, L>,
  mioloComDoisCadastros: ReadonlySet<string>,
  chaveDoDocumento = 'cnpj_cpf',
): Promise<Map<string, L>> {
  const achados = new Map<string, L>();

  // Os documentos dos registros cujo CÓDIGO o app ainda não tem: só eles podem
  // ser o documento ANTIGO de um cliente sem código. O documento que o app tem
  // hoje noutro cadastro entra também (ver acima).
  const semDono = new Set<string>();
  for (const raw of clientes) {
    if (!ehObjeto(raw)) continue;
    const documento = digitosDoDocumento(raw[chaveDoDocumento]);
    if (!documento) continue;
    const miolo = codigoMiolo(textoSimples(raw['codigo']));
    if (miolo && (porMiolo.has(miolo) || mioloComDoisCadastros.has(miolo))) continue;
    semDono.add(documento);
  }
  if (semDono.size === 0) return achados;

  const semCodigo = new Map<string, L>();
  for (const c of existentes) if (!codigoMiolo(c.erp_id)) semCodigo.set(c.id, c);
  if (semCodigo.size === 0) return achados;
  if (!(await detectarOuFalhar('customer_changes', 'id'))) return achados;

  const ambiguos = new Set<string>();
  for (const lote of emLotes([...semDono])) {
    const linhas = await buscarTudoOuFalhar<{ customer_id: string; campos: unknown }>((de, ate) =>
      supabase
        .from('customer_changes')
        .select('id, customer_id, campos')
        .eq('company_id', company_id)
        // O `antes` do histórico é o valor NORMALIZADO (só dígitos), como o
        // documento do lote: o filtro por caminho do jsonb casa direto.
        .in('campos->cnpj->>antes', lote)
        .order('id')
        .range(de, ate),
    );
    for (const l of linhas) {
      const campos = ehObjeto(l.campos) ? l.campos : {};
      const cnpj = ehObjeto(campos['cnpj']) ? campos['cnpj'] : {};
      const antigo = digitosDoDocumento(cnpj['antes']);
      if (!antigo || !semDono.has(antigo)) continue;
      const cliente = semCodigo.get(l.customer_id);
      if (!cliente) continue;
      const jaAchado = achados.get(antigo);
      if (jaAchado && jaAchado.id !== cliente.id) ambiguos.add(antigo);
      else achados.set(antigo, cliente);
    }
  }
  for (const documento of ambiguos) achados.delete(documento);
  return achados;
}

/**
 * O motivo de `ignorados` do registro que não dá para casar sem adivinhar: o
 * documento dele é o ANTIGO de um cliente sem código e o de hoje de outro
 * cadastro sem código (revisão de 17/09/2026). Contrato publicado: texto exato.
 */
export const MOTIVO_DOCUMENTO_ANTIGO_AMBIGUO =
  'CNPJ corrigido no app num cliente sem código e hoje de outro cadastro sem código — confira qual dos dois é este cliente';

/** A razão social para comparar: sem acento, sem pontuação, sem espaço, maiúscula. */
const nomeComparavel = (v: unknown): string =>
  typeof v === 'string'
    ? v
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
    : '';

/**
 * O registro cujo código o app ainda não tem traz o documento ANTIGO de um
 * cliente sem código (`corrigido`, achado por
 * `clientesSemCodigoComDocumentoCorrigido`): é dele? (revisão de 17/09/2026)
 *
 *   • ninguém mais tem o documento hoje → é do corrigido (como sempre foi);
 *   • quem tem o documento hoje tem OUTRO código → não é este registro (o
 *     código dele o app nem tem): é do corrigido — é o "comum" dos docs, a
 *     correção que tirou do cliente o CNPJ de uma loja já no Control;
 *   • quem tem o documento hoje também está SEM código → os dois podem ser o
 *     cliente que o Control puxou. A razão social desempata (o Control criou o
 *     cadastro com a do cliente que puxou): bate só com a do corrigido, é dele;
 *     bate só com a de quem tem o documento, `null` — o casamento de sempre,
 *     pelo documento. Sem como decidir, `'ambiguo'`: nem um nem outro, e o
 *     registro volta em `ignorados` — adivinhar gravaria o código, a carteira,
 *     o bloqueio e o limite de uma loja na outra.
 *
 * `null` também quando não há corrigido: o caminho de sempre.
 */
export function clientePeloDocumentoAntigo<L extends { id: string; erp_id: string | null }>(
  corrigido: L | undefined,
  donosDeHoje: readonly L[],
  razaoSocial: string | null,
  nomeDe: (c: L) => unknown,
): { cliente: L } | 'ambiguo' | null {
  if (!corrigido) return null;
  const outros = donosDeHoje.filter((c) => c.id !== corrigido.id);
  const semCodigo = outros.filter((c) => !codigoMiolo(c.erp_id));
  if (semCodigo.length === 0) return { cliente: corrigido };
  const nome = nomeComparavel(razaoSocial);
  if (nome) {
    const doCorrigido = nomeComparavel(nomeDe(corrigido)) === nome;
    const deQuemTem = semCodigo.some((c) => nomeComparavel(nomeDe(c)) === nome);
    if (doCorrigido && !deQuemTem) return { cliente: corrigido };
    if (!doCorrigido && deQuemTem) return null;
  }
  return 'ambiguo';
}

/** Todos os clientes da empresa, paginados e ordenados por id (o PostgREST corta em 1.000 sem avisar). */
async function clientesDaEmpresa(company_id: string, colunas: string): Promise<LinhaCliente[]> {
  return buscarTudoOuFalhar<LinhaCliente>((de, ate) =>
    supabase.from('customers').select(colunas).eq('company_id', company_id).order('id').range(de, ate),
  );
}

export async function receberClientes(
  company_id: string,
  clientes: readonly unknown[],
): Promise<ResultadoSync> {
  const ignorados: ResultadoSync['ignorados'] = [];
  const avisos: string[] = [];
  const agora = new Date().toISOString();

  // ── 1. Leituras. Todas antes da primeira gravação: se uma falhar, lança
  // (500) sem ter gravado nada. Engolir o erro seria tratar a base inteira
  // como vazia — e criar de novo cada cliente que já existe.
  const cadastroReal = await detectarCadastroReal();
  const com049 = await detectarClienteDa049();

  const tabelaPorMiolo = new Map<string, string>();
  const tabelasComCodigoRepetido = new Set<string>();
  for (const t of await tabelasDePreco(company_id)) {
    const m = codigoMiolo(t.erp_code);
    if (!m) continue;
    if (tabelaPorMiolo.has(m) && tabelaPorMiolo.get(m) !== t.id) tabelasComCodigoRepetido.add(m);
    else tabelaPorMiolo.set(m, t.id);
  }

  // Existentes por CNPJ (a chave entre os sistemas) e por código (miolo).
  //
  // PAGINADO e ordenado por id: o PostgREST corta em 1.000 linhas sem avisar,
  // e a CS já tem mais de 2.600 clientes. Sem paginar, todo cliente da página
  // 2 em diante ficava fora deste mapa — e a carga o CRIARIA de novo.
  // Com a 049, `updated_at` junto do carimbo: é o que diz se o app mexeu
  // depois da última mão do Control (e aí o carimbo não é regravado). E sempre
  // (a coluna existe desde a 001): o cliente adotado pelo CNPJ é gravado com o
  // `updated_at` lido na condição (051, revisão de 17/09/2026 — ver o passo 3).
  const colunas = [
    COLUNAS_DO_CLIENTE,
    'updated_at',
    cadastroReal ? COLUNAS_DA_041 : null,
    com049 ? COLUNAS_DA_049 : null,
  ]
    .filter(Boolean)
    .join(', ');
  const existentes = await clientesDaEmpresa(company_id, colunas);
  const porMiolo = new Map<string, LinhaCliente>();
  const mioloComDoisCadastros = new Set<string>();
  const porCnpj = new Map<string, LinhaCliente[]>();
  for (const c of existentes) {
    const m = codigoMiolo(c.erp_id);
    if (m) {
      if (porMiolo.has(m)) mioloComDoisCadastros.add(m);
      else porMiolo.set(m, c);
    }
    const d = digitosDoDocumento(c.cnpj);
    if (d) porCnpj.set(d, [...(porCnpj.get(d) ?? []), c]);
  }

  // ── 1b. CPF/CNPJ trocado no app e ainda pendente (051, revisão de 17/09/2026).
  // O financeiro corrigiu no app o documento de um cliente que o Control ainda
  // tem com o antigo — muitas vezes justamente porque o antigo era o de OUTRA
  // loja. Casando primeiro pelo documento, o registro acharia essa outra loja:
  // era recusado ("CNPJ já é do cliente de código X") ou, com a outra loja sem
  // código, a adotava — e o bloqueio, o limite e a carteira do cliente certo
  // deixavam de chegar até o Control trocar o documento. O cliente cujo CÓDIGO
  // veio no registro e cuja troca pendente tem esse documento como `antes` é o
  // cliente certo: para ele, vale o código. Lê só as pendências desses
  // candidatos, em lote, antes de qualquer gravação.
  const documentosTrocadosNoApp = await documentosAntigosPendentes(company_id, clientes, porMiolo, mioloComDoisCadastros);
  // E o mesmo cliente ANTES de o código voltar: sem código, o documento
  // corrigido no app deixava o registro do Control sem cadastro nenhum para
  // casar — e ele virava um segundo cadastro, calado (17/09/2026).
  const semCodigoComDocumentoCorrigido = await clientesSemCodigoComDocumentoCorrigido(
    company_id,
    clientes,
    existentes,
    porMiolo,
    mioloComDoisCadastros,
  );

  // ── 2. Decide, registro a registro, o que gravar.
  const paraInserir: Array<{ codigo: string; linha: Record<string, unknown> }> = [];
  /** Os registros que casaram com um cadastro: o patch sai depois de ler as edições do app (2b). */
  const casados: Array<{
    codigo: string;
    raw: Record<string, unknown>;
    existente: LinhaCliente;
    pedido: Record<string, unknown>;
    adotado: boolean;
  }> = [];
  const paraAtualizar: Array<{
    codigo: string;
    id: string;
    patch: Record<string, unknown>;
    adotado: boolean;
    /** Grava o carimbo do Control nesta gravação (049, ver partner.eco.ts). */
    carimbar: boolean;
    /** O valor lido das colunas que o app edita e o patch muda (compare-and-set, 051). */
    antes: Record<string, unknown>;
    /** Edições de quando o cliente não tinha código a pôr na fila do Control, se gravar (2c). */
    paraAFilaDoControl: AlteracaoDoCliente[];
    /**
     * Cliente adotado pelo CNPJ, com a 051: o `updated_at` lido (vai na condição
     * do UPDATE) e o que a reconferência depois de gravar precisa (passo 3a).
     */
    adocao: {
      lidoEm: unknown;
      raw: Record<string, unknown>;
      existente: LinhaCliente;
      /** As edições fora da fila que o 2c já leu deste cliente. */
      vistas: Set<string>;
    } | null;
  }> = [];
  const vistosNoLote = new Set<string>();
  const cnpjsNoLote = new Set<string>();
  const alvosNoLote = new Set<string>();
  const tabelasNaoAchadas = new Set<string>();
  const tabelasAmbiguas = new Set<string>();
  const limitesInvalidos = new Set<string>();
  const pendenciasInvalidas = new Set<string>();
  const titulosInvalidos = new Set<string>();
  const datasInvalidas = new Set<string>();
  const bloqueiosInvalidos = new Set<string>();
  const codigosDeRepresentante = new Set<string>();
  const cnpjAmbiguo = new Set<string>();
  let camposQuePrecisamDa041 = false;
  let camposQuePrecisamDa049 = false;
  let algumaTabelaVeio = false;
  let semMudanca = 0;

  for (const raw of clientes) {
    if (!ehObjeto(raw)) {
      ignorados.push({ codigo: null, motivo: 'registro inválido' });
      continue;
    }
    const codigo = textoSimples(raw['codigo']);
    const miolo = codigoMiolo(codigo);
    if (!codigo || !miolo) {
      ignorados.push({ codigo, motivo: 'sem código do ERP' });
      continue;
    }
    const nome = textoSimples(raw['razao_social']);
    if (!nome) {
      ignorados.push({ codigo, motivo: 'sem razão social' });
      continue;
    }
    // Duas linhas do mesmo cliente no lote: vale a primeira. Sem isto, as duas
    // viravam insert (e a segunda estourava o índice) ou dois updates brigando.
    if (vistosNoLote.has(miolo)) {
      ignorados.push({ codigo, motivo: 'código repetido no lote' });
      continue;
    }
    vistosNoLote.add(miolo);
    const documento = digitosDoDocumento(raw['cnpj_cpf']);
    if (documento) {
      if (cnpjsNoLote.has(documento)) {
        ignorados.push({ codigo, motivo: 'CNPJ repetido no lote' });
        continue;
      }
      cnpjsNoLote.add(documento);
    }

    // O casamento: PRIMEIRO pelo CNPJ, DEPOIS pelo código.
    //
    // O CNPJ é a chave entre os sistemas. O cliente que nasceu no app (sem
    // código) e o que veio da carga de carteira (Curva ABC, também sem código)
    // são achados por ele — e aprendem o código do Control. CNPJ com mais de
    // um cadastro no app: fica com o que tem este código; senão com o que não
    // tem código nenhum (com aviso); senão o registro é recusado — escolher às
    // cegas fundiria duas lojas.
    let existente: LinhaCliente | undefined;
    const peloCodigoComDocumentoTrocado = documento ? documentosTrocadosNoApp.get(miolo) : undefined;
    // O documento antigo de um cliente que o app corrigiu ANTES de ter código
    // (ver 1b) vem antes do casamento pelo documento — mesmo que outro cadastro
    // tenha esse documento hoje (17/09/2026). Só para código que o app não tem.
    const peloDocumentoAntigo =
      documento && !porMiolo.has(miolo) && !mioloComDoisCadastros.has(miolo)
        ? clientePeloDocumentoAntigo(
            semCodigoComDocumentoCorrigido.get(documento),
            porCnpj.get(documento) ?? [],
            nome,
            (c) => c['name'],
          )
        : null;
    if (peloCodigoComDocumentoTrocado?.antigos.has(documento!)) {
      // O documento antigo de um cliente que o app corrigiu (ver 1b): casa pelo código.
      existente = peloCodigoComDocumentoTrocado.cliente;
    } else if (peloDocumentoAntigo === 'ambiguo') {
      ignorados.push({ codigo, motivo: MOTIVO_DOCUMENTO_ANTIGO_AMBIGUO });
      continue;
    } else if (peloDocumentoAntigo) {
      existente = peloDocumentoAntigo.cliente;
    } else if (documento) {
      const candidatos = porCnpj.get(documento) ?? [];
      if (candidatos.length === 1) existente = candidatos[0];
      else if (candidatos.length > 1) {
        const peloCodigo = candidatos.find((c) => codigoMiolo(c.erp_id) === miolo);
        const semCodigo = candidatos.find((c) => !codigoMiolo(c.erp_id));
        existente = peloCodigo ?? semCodigo;
        if (!existente) {
          ignorados.push({ codigo, motivo: 'CNPJ com mais de um cadastro no app' });
          continue;
        }
        cnpjAmbiguo.add(codigo);
      }
    }
    if (!existente) {
      if (mioloComDoisCadastros.has(miolo)) {
        ignorados.push({ codigo, motivo: 'código com mais de um cadastro no app' });
        continue;
      }
      existente = porMiolo.get(miolo);
    }
    // (O cliente que nasceu no app, teve o CPF/CNPJ corrigido aqui e só agora
    // recebe o código — o registro vem com o documento ANTIGO — já foi achado
    // acima, por `clientePeloDocumentoAntigo`: adotado em vez de virar um
    // cadastro duplicado, 17/09/2026.)
    const mioloGravado = existente ? codigoMiolo(existente.erp_id) : null;
    // O CNPJ achou um cadastro que JÁ TEM OUTRO código: não é este cliente para
    // o app. Aplicar o registro trocaria nome, representante (a carteira, que o
    // CRM lê) e tabela de outro código — e, com dois códigos do mesmo CNPJ no
    // Control, o cliente mudaria de dono a cada lote conforme o registro que
    // chegasse (revisão de 16/09/2026). Nada é gravado; o Control confere.
    if (existente && mioloGravado && mioloGravado !== miolo) {
      ignorados.push({ codigo, motivo: `CNPJ já é do cliente de código ${String(existente.erp_id)} no app` });
      continue;
    }
    // Um cadastro é alvo de UM registro do lote: dois registros (um pelo CNPJ,
    // outro pelo código) apontando para a mesma linha seriam dois updates brigando.
    if (existente) {
      if (alvosNoLote.has(existente.id)) {
        ignorados.push({ codigo, motivo: 'cadastro já atualizado por outro registro do lote' });
        continue;
      }
      alvosNoLote.add(existente.id);
    }
    // Quem não tinha código aprende o do Control; quem tem, é o mesmo código.
    const adotado = existente !== undefined && !mioloGravado;

    // Só entram as chaves que vieram. `name` sempre vem (é obrigatório).
    const pedido: Record<string, unknown> = { name: nome };
    const copiarTexto = (campo: string, coluna: string) => {
      const lido = lerTexto(raw, campo);
      if (lido.veio) pedido[coluna] = lido.valor;
    };
    copiarTexto('nome_fantasia', 'trade_name');
    copiarTexto('cnpj_cpf', 'cnpj'); // como veio (aparado); o casamento é por dígitos
    copiarTexto('whatsapp', 'whatsapp');
    copiarTexto('email', 'email');
    copiarTexto('motivo_bloqueio', 'block_reason');

    const rep = lerTexto(raw, 'representante');
    if (rep.veio) {
      // Uma grafia só no banco: "779" e "#00779" gravam "00779".
      const canonico = rep.valor === null ? null : codigoCanonico(rep.valor);
      if (rep.valor === null || canonico !== null) pedido['rep_erp_id'] = canonico;
      if (canonico) codigosDeRepresentante.add(canonico);
    }

    const tabela = lerTexto(raw, 'tabela_preco');
    if (tabela.veio) {
      if (tabela.valor === null) pedido['price_table_id'] = null;
      else {
        algumaTabelaVeio = true;
        const m = codigoMiolo(tabela.valor);
        const id = m ? tabelaPorMiolo.get(m) : undefined;
        if (m && tabelasComCodigoRepetido.has(m)) tabelasAmbiguas.add(tabela.valor);
        else if (id) pedido['price_table_id'] = id;
        else tabelasNaoAchadas.add(tabela.valor); // não mexe na tabela que o cliente tem
      }
    }

    const bloqueado = lerBloqueado(raw);
    if (bloqueado.veio === true) pedido['blocked'] = bloqueado.valor;
    else if (bloqueado.veio === 'invalido') bloqueiosInvalidos.add(codigo);

    const limite = lerValor(raw, 'limite_credito');
    if (limite.veio === true) pedido['credit_limit'] = limite.valor;
    else if (limite.veio === 'invalido') limitesInvalidos.add(codigo);

    // O que o Control informa da situação financeira e o carimbo dele (049).
    const pendencia = lerValor(raw, 'pendencia_financeira');
    if (pendencia.veio === 'invalido') pendenciasInvalidas.add(codigo);
    else if (pendencia.veio) {
      if (com049) pedido['pendencia_financeira'] = pendencia.valor;
      else camposQuePrecisamDa049 = true;
    }
    const titulos = lerInteiro(raw, 'titulos_vencidos');
    if (titulos.veio === 'invalido') titulosInvalidos.add(codigo);
    else if (titulos.veio) {
      if (com049) pedido['titulos_vencidos'] = titulos.valor;
      else camposQuePrecisamDa049 = true;
    }
    // `data_update` é só conferido: não é gravado nem conta como mudança.
    if (lerMomento(raw, 'data_update').veio === 'invalido') datasInvalidas.add(codigo);

    for (const [campo, coluna] of [
      ['inscricao_estadual', 'inscricao_estadual'],
      ['observacoes', 'observacoes'],
    ] as const) {
      const lido = lerTexto(raw, campo);
      if (!lido.veio) continue;
      if (cadastroReal) pedido[coluna] = lido.valor;
      else camposQuePrecisamDa041 = true;
    }

    const endereco = enderecoPedido(raw, cadastroReal, existente);
    Object.assign(pedido, endereco.campos);
    if (endereco.pedacosSem041) camposQuePrecisamDa041 = true;

    if (existente) {
      // Os campos só do app (o WhatsApp, 22/09/2026) que o cliente já tem
      // preenchidos não são tocados pelo Control: o telefone de lá é outra
      // coisa. Sem aviso — é a regra, não um conflito. Vazio, o do Control
      // preenche. Vale com e sem a 051 (não depende de edição pendente).
      //
      // Revisão do mesmo dia: "preenchido" é ter um telefone — o nome que a
      // carga de carteira gravou no lugar do número conta como vazio, e o
      // número do Control o troca (`campoSoDoAppPreenchido`). E o `whatsapp`
      // vazio do Control nunca apaga nada: preencher com nada não é preencher
      // (e o lixo fica para o conserto, que o acha pelo valor). O vazio que o
      // app deixou de propósito é conferido no 2d, com o histórico.
      for (const campo of CAMPOS_SO_DO_APP) {
        if (!(campo in pedido)) continue;
        if (campoSoDoAppPreenchido(campo, existente[campo]) || normalizarCampoDoCadastro(campo, pedido[campo]) === null) {
          delete pedido[campo];
        }
      }
      casados.push({ codigo, raw, existente, pedido, adotado });
    } else {
      // Cliente novo não tem nada a preservar: a linha vai completa, com as
      // mesmas chaves em todas (o insert em lote do PostgREST grava NULL — e
      // não o padrão da coluna — na chave que falta numa linha e existe noutra).
      const base: Record<string, unknown> = {
        company_id,
        erp_id: codigoCanonico(codigo),
        trade_name: null,
        cnpj: null,
        rep_erp_id: null,
        price_table_id: null,
        blocked: false,
        block_reason: null,
        credit_limit: null,
        whatsapp: null,
        email: null,
        address: null,
      };
      if (cadastroReal) {
        for (const p of PECAS_DO_ENDERECO) base[p] = null;
        base['inscricao_estadual'] = null;
        base['observacoes'] = null;
      }
      if (com049) {
        base['erp_updated_at'] = agora;
        base['pendencia_financeira'] = null;
        base['pendencia_financeira_em'] = null;
        base['titulos_vencidos'] = null;
      }
      const linha: Record<string, unknown> = { ...base, ...pedido, updated_at: agora };
      if (com049 && linha['pendencia_financeira'] != null) linha['pendencia_financeira_em'] = agora;
      paraInserir.push({ codigo, linha });
    }
  }

  // ── 2b. As edições do cadastro feitas no app que ainda não chegaram ao
  // Control (051). Uma leitura por lote de clientes casados — nunca uma por
  // cliente —, DEPOIS da leitura dos clientes (a edição que cair entre as duas
  // é vista aqui, se a tela já gravou o histórico; se ainda não, o 3b a pega)
  // e antes da primeira gravação: se ela falhar, lança (500) sem
  // ter gravado nada. Tratar a falha como "nada pendente" deixaria o lote
  // sobrescrever a edição do app. `null` = sem a 051: tudo como antes.
  const pendentesDoApp =
    casados.length > 0
      ? await lerAlteracoesPendentesEmLote(
          company_id,
          casados.map((c) => c.existente.id),
        )
      : null;
  // ── 2c. O resto do histórico de dois tipos de cliente casado (revisão de
  // 17/09/2026), numa leitura em lote, também antes de gravar:
  //   • o que tem edição pendente: uma edição MAIS NOVA da mesma coluna, já
  //     resolvida, é o valor atual do app — o Control que aplicou só a mais
  //     nova levava aviso falso para sempre, ou gravava o `depois` vencido da
  //     mais velha por cima (partner.edicaoNoApp.ts);
  //   • o adotado pelo CNPJ: a edição feita quando ele não tinha código nasce
  //     fora da fila ("vai para lá com os dados de hoje, pela fila de incluir").
  //     Mas o Control puxa o cliente novo no GET e só devolve o código no POST
  //     do ciclo seguinte — a correção do representante nesse meio chegava
  //     aqui com o valor antigo do Control, que gravava por cima, carimbava e
  //     tirava o cliente do GET: a edição sumia nos dois lados, sem aviso. Ela
  //     é conferida como pendente: igual, nada a fazer; diferente, fica o valor
  //     do app, o lote avisa e ela entra na fila do Control (passo 3).
  const foraDaFila =
    pendentesDoApp !== null
      ? await lerAlteracoesForaDaFilaEmLote(
          company_id,
          casados
            .filter((c) => c.adotado || (pendentesDoApp.get(c.existente.id)?.length ?? 0) > 0)
            .map((c) => c.existente.id),
        )
      : new Map<string, AlteracaoDoCliente[]>();
  // ── 2d. O campo só do app que o APP esvaziou (revisão de 22/09/2026). O
  // passo 2 deixa o Control preencher o WhatsApp vazio — mas vazio porque o
  // representante apagou (a régua aceita "ou deixe em branco", e o diálogo
  // diz "Fica só no app") não é "nunca teve": sem isto, o telefone do Control
  // voltava no envio seguinte, sem aviso nem linha no histórico, e o "Enviar
  // pedido para o cliente" ia para o fixo de lá. A edição mista (WhatsApp
  // limpo e e-mail) também. Com o campo editado alguma vez no histórico (051),
  // quem decide o valor é o app: o do Control sai do pedido. Uma leitura em
  // lote, só dos casados que o lote ia preencher, antes de gravar (se falhar,
  // lança). Sem a 051 não há histórico: fica a regra do passo 2.
  const aPreencher = casados.filter((c) => CAMPOS_SO_DO_APP.some((campo) => campo in c.pedido));
  const editadosNoApp =
    pendentesDoApp !== null && aPreencher.length > 0
      ? await camposSoDoAppEditadosEmLote(
          company_id,
          aPreencher.map((c) => c.existente.id),
        )
      : new Map<string, Set<CampoSoDoApp>>();
  for (const { existente, pedido } of aPreencher) {
    const editados = editadosNoApp.get(existente.id);
    if (!editados) continue;
    for (const campo of CAMPOS_SO_DO_APP) if (editados.has(campo)) delete pedido[campo];
  }
  const mantidosNoApp: Array<{ codigo: string; campos: NomeNoContratoDoParceiro[] }> = [];
  const edicoesAlcancadas: string[] = [];

  for (const { codigo, raw, existente, pedido, adotado } of casados) {
    let edicaoDoAppPendente = false;
    /** As edições de quando o cliente não tinha código que o Control mostrou não ter. */
    let semCodigoParaAFila: AlteracaoDoCliente[] = [];
    if (pendentesDoApp) {
      const pendentes = pendentesDoApp.get(existente.id) ?? [];
      const outras = foraDaFila.get(existente.id) ?? [];
      // Só a edição com campo que vai para o Control (22/09/2026): a só de
      // WhatsApp, feita sem código, continua fora da fila — o WhatsApp é do app.
      const semCodigo = new Set(
        adotado
          ? outras
              .filter((a) => !a.erp_pendente && !a.erp_atualizado_em && algumCampoVaiParaOControl(Object.keys(a.campos)))
              .map((a) => a.id)
          : [],
      );
      const conferencia = conferirEdicoesDoApp(raw, pedido, existente, [
        ...pendentes,
        ...outras.map((a) => (semCodigo.has(a.id) ? { ...a, erp_pendente: true } : a)),
      ]);
      if (conferencia.mantidos.length > 0) mantidosNoApp.push({ codigo, campos: conferencia.mantidos });
      // A de quando não tinha código e que o Control já tem continua fora da fila (nunca entrou).
      edicoesAlcancadas.push(...conferencia.alcancadas.filter((id) => !semCodigo.has(id)));
      // As outras entram na fila — TODAS as que o registro não deu por
      // alcançadas, e não só as de coluna que ele trouxe diferente (revisão de
      // 17/09/2026). A adoção é a única janela: depois dela o cliente tem código,
      // e a edição de quando não tinha nunca mais é conferida. O registro que não
      // trazia a coluna (o contrato deixa mandar só parte) deixava a correção
      // fora da fila; o envio seguinte, com o valor antigo do Control, gravava
      // por cima, sem aviso, sem pendência e sem `alterado_no_app`. Na fila, ela
      // é protegida como as outras e fecha sozinha no primeiro envio que trouxer
      // o mesmo valor.
      const alcancadas = new Set(conferencia.alcancadas);
      semCodigoParaAFila = outras.filter((a) => semCodigo.has(a.id) && !alcancadas.has(a.id));
      edicaoDoAppPendente = conferencia.aindaPendente;
    }

    const patch: Record<string, unknown> = {};
    for (const [coluna, valor] of Object.entries(pedido)) {
      if (!mesmoValor(existente[coluna], valor)) patch[coluna] = valor;
    }
    // O `erp_id` de quem já tem código nunca é reescrito — só casa. Quem é
    // achado pelo CNPJ sem código aprende o do Control.
    if (adotado) patch['erp_id'] = codigoCanonico(codigo);
    if (Object.keys(patch).length === 0) {
      semMudanca++;
      continue;
    }
    if (com049 && 'pendencia_financeira' in patch) patch['pendencia_financeira_em'] = agora;
    // `updated_at` e o carimbo entram na hora de gravar (passo 3), com o
    // momento daquela gravação — não o do começo do lote. Com edição do app
    // ainda pendente, a última mão que importa é a do app: carimbar agora
    // esconderia o cliente do GET ?desde= antes de o Control ter a edição.
    const carimbar =
      com049 && !edicaoDoAppPendente && podeCarimbar(existente['updated_at'], existente['erp_updated_at']);
    // As colunas que a tela de edição do cadastro também grava vão com o valor
    // lido na condição do UPDATE (ver o passo 3). Só com a 051: sem ela não há
    // edição do cadastro no app a proteger, e a gravação fica como sempre foi.
    const antes: Record<string, unknown> = {};
    if (pendentesDoApp) {
      for (const coluna of Object.keys(patch)) {
        if (Object.prototype.hasOwnProperty.call(CAMPO_DO_CONTRATO_DO_PARCEIRO, coluna)) {
          antes[coluna] = existente[coluna] ?? null;
        }
      }
    }
    const adocao =
      adotado && pendentesDoApp
        ? {
            lidoEm: existente['updated_at'],
            raw,
            existente,
            vistas: new Set((foraDaFila.get(existente.id) ?? []).map((a) => a.id)),
          }
        : null;
    paraAtualizar.push({
      codigo,
      id: existente.id,
      patch,
      adotado,
      carimbar,
      antes,
      paraAFilaDoControl: semCodigoParaAFila,
      adocao,
    });
  }

  // Conferência da carteira (só avisos, antes de gravar): o cliente é da
  // carteira do login cujo `erp_rep_id` é IGUAL ao código gravado — a
  // comparação é exata no app e no CRM.
  if (codigosDeRepresentante.size > 0) {
    const logins = await codigosDosLogins(company_id);
    if (!logins) {
      avisos.push('Não deu para conferir os códigos de representante contra os logins do app nesta chamada.');
    } else {
      const semLogin: string[] = [];
      const outraGrafia: string[] = [];
      for (const cod of codigosDeRepresentante) {
        const grafias = logins.get(codigoMiolo(cod) ?? '');
        if (!grafias) semLogin.push(cod);
        else if (!grafias.has(cod)) outraGrafia.push(`${cod} (login com ${listar(grafias)})`);
      }
      if (semLogin.length > 0) {
        avisos.push(
          `Código de representante sem login no app — os clientes dele ficam fora de carteira até alguém criar o acesso: ${listar(semLogin)}.`,
        );
      }
      if (outraGrafia.length > 0) {
        avisos.push(
          `Código de representante gravado numa grafia diferente da do login — a carteira só enxerga quando as duas forem iguais: ${listar(outraGrafia)}.`,
        );
      }
    }
  }

  // ── 3. Gravações. Nunca apagamos cliente — cliente com pedido tem histórico
  // preso a ele. O ERP desativa mandando bloqueado; o app respeita o bloqueio.
  let criados = 0;
  for (const lote of emLotes(paraInserir, 500)) {
    const { error } = await supabase.from('customers').insert(lote.map((i) => i.linha));
    if (!error) {
      criados += lote.length;
      continue;
    }
    // Um registro ruim não derruba os outros: repete um a um e isola o culpado.
    if (lote.length === 1) {
      ignorados.push({ codigo: lote[0]?.codigo ?? null, motivo: `falha ao gravar: ${error.message}` });
      continue;
    }
    for (const item of lote) {
      const { error: erroDoItem } = await supabase.from('customers').insert([item.linha]);
      if (erroDoItem) ignorados.push({ codigo: item.codigo, motivo: `falha ao gravar: ${erroDoItem.message}` });
      else criados++;
    }
  }

  let atualizados = 0;
  let adotadosPorCnpj = 0;
  const paraAFilaDoControl: AlteracaoDoCliente[] = [];
  /** Um UPDATE do lote que gravou: o valor lido das colunas do app e o que foi gravado. */
  type Gravado = { codigo: string; id: string; lidas: Record<string, unknown>; gravadas: Record<string, unknown> };
  /** Os UPDATEs que gravaram coluna que a tela de edição também grava — a reconferência do 3b. */
  const gravadosComColunaDoApp: Gravado[] = [];
  /** Os adotados pelo CNPJ que gravaram — a reconferência do 3a. */
  const adotadosGravados: Array<Gravado & { adocao: NonNullable<(typeof paraAtualizar)[number]['adocao']> }> = [];
  for (const u of paraAtualizar) {
    // O momento desta gravação, tomado logo antes dela: é o carimbo que a
    // trigger da 013 vai ultrapassar só pela folga (partner.eco.ts). Com o
    // `agora` do começo do lote, um lote longo passaria da folga.
    const momento = new Date().toISOString();
    u.patch['updated_at'] = momento;
    if (u.carimbar) u.patch['erp_updated_at'] = momento;
    // Compare-and-set nas colunas que o app também edita (revisão de
    // 17/09/2026). As pendências foram lidas no passo 2b, mas os UPDATEs saem
    // um a um: num lote longo, a pessoa pode salvar a ficha DEPOIS dessa
    // leitura e ANTES do UPDATE deste cliente. A edição dela passa (o banco
    // ainda tinha o valor antigo) e grava a pendência — e um UPDATE sem
    // condição apagaria, calado, a edição, deixando a pendência apontar para
    // um valor que não está em lugar nenhum. Com o valor lido na condição, o
    // cliente que mudou no meio não é gravado e volta para o Control reenviar:
    // no próximo envio a conferência já vê a edição.
    const conferidas = Object.entries(u.antes);
    let consulta = supabase.from('customers').update(u.patch).eq('id', u.id).eq('company_id', company_id);
    for (const [coluna, valor] of conferidas) {
      consulta = valor == null ? consulta.is(coluna, null) : consulta.eq(coluna, valor);
    }
    // O ADOTADO pelo CNPJ vai também com o `updated_at` lido na condição
    // (revisão de 17/09/2026). A edição feita enquanto ele não tinha código nasce
    // fora da fila, e só o 2c a confere — com o que já estava gravado na leitura.
    // A correção que o representante salva DEPOIS dela e antes deste UPDATE não
    // entra no patch (o Control mandou o mesmo valor que o lote leu): o UPDATE
    // passava sem condição, gravava o código (e, com a 049, o carimbo, que tirava
    // o cliente do GET ?desde=), e o envio seguinte — cliente já com código, que
    // o 2c não olha mais — gravava o valor antigo por cima, sem aviso. Qualquer
    // gravação do app depois da leitura faz o registro voltar para reenviar; no
    // reenvio, o 2c já vê a edição.
    const comCondicao = conferidas.length > 0 || u.adocao !== null;
    if (u.adocao) {
      const lidoEm = u.adocao.lidoEm;
      consulta = lidoEm == null ? consulta.is('updated_at', null) : consulta.eq('updated_at', lidoEm);
    }
    const { data: gravadas, error } = comCondicao ? await consulta.select('id') : await consulta;
    if (error) {
      ignorados.push({ codigo: u.codigo, motivo: `falha ao gravar: ${error.message}` });
      continue;
    }
    // 0 linhas = a condição não bateu: o cadastro mudou depois da leitura.
    if (comCondicao && Array.isArray(gravadas) && gravadas.length === 0) {
      ignorados.push({ codigo: u.codigo, motivo: MOTIVO_MUDOU_NO_APP_DURANTE_O_ENVIO });
      continue;
    }
    atualizados++;
    if (u.adotado) adotadosPorCnpj++;
    const gravado: Gravado = { codigo: u.codigo, id: u.id, lidas: u.antes, gravadas: u.patch };
    if (conferidas.length > 0) gravadosComColunaDoApp.push(gravado);
    if (u.adocao) adotadosGravados.push({ ...gravado, adocao: u.adocao });
    paraAFilaDoControl.push(...u.paraAFilaDoControl);
  }

  /**
   * Devolve ao valor lido as colunas que o lote gravou por cima de uma edição do
   * app que ele não tinha visto, com a condição inversa (só onde ainda está o que
   * o lote gravou), e põe os campos no aviso. Sem resposta, ou com o cadastro já
   * mudado de novo, só o log.
   */
  const devolverAoValorDoApp = async (g: Gravado, apagadas: ReturnType<typeof colunasQueOLoteApagou>) => {
    const devolver: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of apagadas) devolver[c] = g.lidas[c] ?? null;
    let consulta = supabase.from('customers').update(devolver).eq('id', g.id).eq('company_id', company_id);
    for (const c of apagadas) {
      const gravado = g.gravadas[c];
      consulta = gravado == null ? consulta.is(c, null) : consulta.eq(c, gravado);
    }
    const { data: devolvidas, error: erroAoDevolver } = await consulta.select('id');
    if (erroAoDevolver || !Array.isArray(devolvidas) || devolvidas.length === 0) {
      // Sem resposta, ou o cadastro já mudou de novo (outra edição por cima): o
      // que está lá não é mais o que o lote gravou. Só o log.
      console.error(
        `[parceiro] cliente ${g.codigo}: a edição do app gravada durante o envio não foi devolvida (${
          erroAoDevolver?.message ?? 'o cadastro já tinha mudado'
        }); colunas: ${apagadas.join(', ')}`,
      );
      return;
    }
    const campos = camposNoContratoDoParceiro(apagadas);
    const jaAvisado = mantidosNoApp.find((m) => m.codigo === g.codigo);
    if (jaAvisado) jaAvisado.campos = [...new Set([...jaAvisado.campos, ...campos])];
    else mantidosNoApp.push({ codigo: g.codigo, campos });
  };

  // ── 3a. O adotado pelo CNPJ e a edição feita sem código que chegou DEPOIS da
  // leitura do 2c (revisão de 17/09/2026). O 3b abaixo só relê edições
  // PENDENTES — e a de cliente sem código nasce fora da fila. A tela grava o
  // cliente e só depois o histórico: o lote que leu o cliente nesse meio viu a
  // correção sem histórico, o compare-and-set passou (a condição era o próprio
  // valor novo) e o valor antigo do Control ficava, com a edição fora da fila
  // para sempre — nem aviso, nem pendência. Relê, em lote, as edições fora da
  // fila dos adotados que gravaram, e as que o 2c não viu seguem a regra dele:
  // o que o Control já tem fica fora da fila; o resto entra, e a coluna que o
  // lote gravou por cima volta ao valor do app, com o aviso de sempre.
  if (adotadosGravados.length > 0) {
    let depoisDeAdotar: Map<string, AlteracaoDoCliente[]> | null = null;
    try {
      depoisDeAdotar = await lerAlteracoesForaDaFilaEmLote(
        company_id,
        adotadosGravados.map((g) => g.id),
      );
    } catch (e) {
      // Os clientes já foram gravados: não derruba o lote (como o 3b).
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[parceiro] não deu para reconferir as edições dos clientes adotados pelo CNPJ depois de gravar: ${msg}`);
    }
    for (const g of adotadosGravados) {
      // Só as com campo que vai para o Control (22/09/2026): a só de WhatsApp
      // continua fora da fila, como no 2c.
      const novas = (depoisDeAdotar?.get(g.id) ?? [])
        .filter(
          (a) =>
            !g.adocao.vistas.has(a.id) &&
            !a.erp_pendente &&
            !a.erp_atualizado_em &&
            algumCampoVaiParaOControl(Object.keys(a.campos)),
        )
        .map((a) => ({ ...a, erp_pendente: true }));
      if (novas.length === 0) continue;
      const conferencia = conferirEdicoesDoApp(g.adocao.raw, {}, g.adocao.existente, novas);
      const alcancadas = new Set(conferencia.alcancadas);
      paraAFilaDoControl.push(...novas.filter((a) => !alcancadas.has(a.id)));
      const apagadas = colunasQueOLoteApagou(novas, g.lidas, g.gravadas);
      if (apagadas.length > 0) await devolverAoValorDoApp(g, apagadas);
    }
  }

  // A edição de quando o cliente não tinha código, que o Control acabou de
  // mostrar não ter (2c), entra na fila — só agora, com o cliente gravado com o
  // código: antes disso, uma pendência num cliente fora do Control. Daqui em
  // diante é uma edição pendente como as outras: protegida nos próximos envios,
  // no alterado_no_app do GET e no cartão do financeiro. Falhar aqui não derruba
  // o lote (os clientes já foram gravados, com o valor do app), mas o próximo
  // envio já não a protege — o aviso diz isso ao Control.
  let edicoesForaDaFila = false;
  if (paraAFilaDoControl.length > 0) {
    try {
      await colocarNaFilaDoControl(company_id, paraAFilaDoControl);
    } catch (e) {
      edicoesForaDaFila = true;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[parceiro] edições do cadastro de clientes adotados pelo CNPJ não entraram na fila do Control: ${msg}`);
    }
  }

  // ── 3b. A edição do app que caiu entre as DUAS gravações dela (revisão de
  // 17/09/2026). A tela grava o cliente e só depois a linha do histórico: o
  // lote que leu o cliente e as pendências nesse meio viu o valor novo do app
  // sem pendência — e o compare-and-set acima passou, porque a condição era o
  // próprio valor novo. A edição sumia calada, e o aviso "mantido o valor do
  // app" dos envios seguintes mentia para sempre. Relê as pendências dos
  // clientes gravados (em lote, como o 2b): a edição que o lote não tinha visto
  // e cujo `depois` é o valor que ele trocou volta ao cadastro, com a condição
  // inversa (só onde ainda está o que o lote gravou), e entra no aviso.
  if (pendentesDoApp && gravadosComColunaDoApp.length > 0) {
    const vistasNoLote = new Set<string>(paraAFilaDoControl.map((a) => a.id));
    for (const lista of pendentesDoApp.values()) for (const a of lista) vistasNoLote.add(a.id);
    let depoisDeGravar: Map<string, AlteracaoDoCliente[]> | null = null;
    try {
      depoisDeGravar = await lerAlteracoesPendentesEmLote(
        company_id,
        gravadosComColunaDoApp.map((g) => g.id),
      );
    } catch (e) {
      // Os clientes já foram gravados: não derruba o lote. É preciso outra falha
      // (a edição cair justo no meio) para isto importar — fica no log.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[parceiro] não deu para reconferir as edições do cadastro depois de gravar o lote: ${msg}`);
    }
    for (const g of gravadosComColunaDoApp) {
      const naoVistas = (depoisDeGravar?.get(g.id) ?? []).filter((a) => !vistasNoLote.has(a.id));
      const apagadas = colunasQueOLoteApagou(naoVistas, g.lidas, g.gravadas);
      if (apagadas.length > 0) await devolverAoValorDoApp(g, apagadas);
    }
  }

  // As edições do app que o Control alcançou (mandou o mesmo valor) saem da
  // fila do financeiro, marcadas como atualizadas pela API. Independe de o
  // registro ter gravado outra coluna: o valor do app já está no cadastro e o
  // Control acabou de mostrar que tem o mesmo. Falhar aqui não derruba o lote
  // (os clientes já foram gravados): as edições continuam pendentes — o lado
  // seguro — e são conferidas de novo no próximo envio.
  let edicoesNaoMarcadas = false;
  if (edicoesAlcancadas.length > 0) {
    try {
      await resolverAlteracoesPelaApi(company_id, edicoesAlcancadas);
    } catch (e) {
      edicoesNaoMarcadas = true;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[parceiro] edições do cadastro alcançadas pelo Control não foram marcadas: ${msg}`);
    }
  }

  // ── 4. Avisos do lote.
  if (mantidosNoApp.length > 0) {
    // Um aviso por cliente, com os campos: é o Control que precisa corrigir o
    // cadastro dele. A lista é cortada como os códigos dos outros avisos.
    for (const m of mantidosNoApp.slice(0, CODIGOS_POR_AVISO)) {
      avisos.push(
        `Cliente ${m.codigo}: ${m.campos.join(', ')} alterados no app ainda não aplicados no Control — mantido o valor do app.`,
      );
    }
    if (mantidosNoApp.length > CODIGOS_POR_AVISO) {
      avisos.push(
        `E mais ${mantidosNoApp.length - CODIGOS_POR_AVISO} cliente(s) com campos alterados no app ainda não aplicados no Control — mantido o valor do app (veja alterado_no_app no GET /clientes).`,
      );
    }
  }
  if (edicoesNaoMarcadas) {
    avisos.push(
      'Não deu para registrar no app as edições de cadastro que o Control já tem — elas continuam pendentes e são conferidas de novo no próximo envio.',
    );
  }
  if (edicoesForaDaFila) {
    avisos.push(
      'Não deu para registrar no app que o Control ainda não tem campos editados no app antes de o cliente ter código — o valor do app foi mantido neste envio; puxe o GET /clientes antes de reenviar esses clientes.',
    );
  }
  if (algumaTabelaVeio && tabelaPorMiolo.size === 0) {
    avisos.push(
      'Nenhuma tabela de preço tem código do ERP preenchido — a tabela dos clientes não foi mexida. Preencha o erp_code das tabelas para o vínculo funcionar.',
    );
  } else if (tabelasNaoAchadas.size > 0) {
    avisos.push(
      `Tabelas de preço não encontradas (a tabela do cliente não foi mexida): ${listar(tabelasNaoAchadas)}.`,
    );
  }
  if (tabelasAmbiguas.size > 0) {
    avisos.push(
      `Código de tabela de preço usado por mais de uma tabela no app (a tabela do cliente não foi mexida): ${listar(tabelasAmbiguas)}.`,
    );
  }
  if (bloqueiosInvalidos.size > 0) {
    avisos.push(
      `"bloqueado" não reconhecido (aceito S, N, true ou false) — o bloqueio não foi mexido: ${listar(bloqueiosInvalidos)}.`,
    );
  }
  if (limitesInvalidos.size > 0) {
    avisos.push(
      `"limite_credito" negativo ou ilegível — o limite não foi mexido: ${listar(limitesInvalidos)}.`,
    );
  }
  if (pendenciasInvalidas.size > 0) {
    avisos.push(
      `"pendencia_financeira" negativa ou ilegível — a pendência não foi mexida: ${listar(pendenciasInvalidas)}.`,
    );
  }
  if (titulosInvalidos.size > 0) {
    avisos.push(
      `"titulos_vencidos" precisa ser um inteiro não negativo — não foi mexido: ${listar(titulosInvalidos)}.`,
    );
  }
  if (datasInvalidas.size > 0) {
    avisos.push(
      `"data_update" precisa ser um momento com fuso (Z ou -03:00) — o registro foi tratado sem ele: ${listar(datasInvalidas)}.`,
    );
  }
  if (camposQuePrecisamDa041) {
    avisos.push(
      'Endereço em campos separados, inscrição estadual e observações ficam guardados depois da migração 041 — por ora só a linha do endereço foi gravada.',
    );
  }
  if (camposQuePrecisamDa049) {
    avisos.push(
      'Pendência financeira e títulos vencidos ficam guardados depois da migração 049 — por ora foram ignorados.',
    );
  }
  if (adotadosPorCnpj > 0) {
    avisos.push(
      `${adotadosPorCnpj} cliente(s) já existiam sem código e foram casados pelo CNPJ — agora têm o código do Control.`,
    );
  }
  if (cnpjAmbiguo.size > 0) {
    avisos.push(
      `CNPJ com mais de um cadastro no app — o registro foi para o que tem este código, ou para o que não tem código; confira os outros: ${listar(cnpjAmbiguo)}.`,
    );
  }

  return {
    recebidos: clientes.length,
    criados,
    atualizados,
    sem_mudanca: semMudanca,
    ignorados,
    avisos,
  };
}

// ─── Representantes ──────────────────────────────────────────────────────────

type LinhaLogin = {
  id: string;
  erp_rep_id: string | null;
  name?: string | null;
  legal_name?: string | null;
  email?: string | null;
  erp_email?: string | null;
  active?: boolean | null;
  updated_at?: string | null;
};

/** Aviso fixo quando o Control manda um e-mail diferente do login (sem a 049). */
export const AVISO_EMAIL_DO_REPRESENTANTE = 'e-mail do Control não troca o login do representante';

/** users.erp_email (049) existe? Lança quando o banco não respondeu. */
const detectarEmailDoControl = () => detectarOuFalhar('users', 'erp_email');

/**
 * Atualiza os representantes que JÁ EXISTEM (nome, razão social, ativo, e o
 * e-mail do Control), casando pelo miolo do código do ERP dentro da empresa e
 * do papel `rep`.
 *
 * Não cria login novo: conta de acesso nasce com senha, e uma senha vinda de um
 * POST externo é risco que ninguém pediu. Rep que o Control tem mas o app ainda
 * não vem na lista `novos`, para o admin criar à mão.
 *
 * NÃO grava `users.email`: é o login (e único no banco inteiro). O e-mail que
 * chega vai para `users.erp_email` (049); sem a coluna, é ignorado com aviso
 * quando difere do login.
 */
export async function receberRepresentantes(
  company_id: string,
  reps: readonly unknown[],
): Promise<ResultadoSync & { novos: Array<{ codigo: string; nome: string | null }> }> {
  const ignorados: ResultadoSync['ignorados'] = [];
  const novos: Array<{ codigo: string; nome: string | null }> = [];

  // Leitura antes de gravar; falhou, lança (500) — sem ela todo rep viraria
  // "novo" e o Control concluiria que ninguém tem login.
  const comEmailDoControl = await detectarEmailDoControl();
  // `string` de propósito: o select dinâmico (com/sem erp_email) tira do
  // supabase-js a inferência do shape, e a linha é lida como LinhaLogin.
  const colunasDoLogin: string = comEmailDoControl
    ? 'id, erp_rep_id, name, legal_name, email, erp_email, active'
    : 'id, erp_rep_id, name, legal_name, email, active';
  const { data: existentes, error: erroLeitura } = await supabase
    .from('users')
    .select(colunasDoLogin)
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .not('erp_rep_id', 'is', null);
  if (erroLeitura) throw new Error(`Ler os representantes falhou: ${erroLeitura.message}`);

  const porMiolo = new Map<string, LinhaLogin>();
  const mioloComDoisLogins = new Set<string>();
  for (const u of (Array.isArray(existentes) ? existentes : []) as unknown as LinhaLogin[]) {
    const m = codigoMiolo(u.erp_rep_id);
    if (!m) continue;
    if (porMiolo.has(m)) mioloComDoisLogins.add(m);
    else porMiolo.set(m, u);
  }

  const vistosNoLote = new Set<string>();
  const emailsDiferentes = new Set<string>();
  const ativosInvalidos = new Set<string>();
  // `users` só tem `updated_at` depois da migração 048 — gravar a coluna sem
  // ela fazia TODO update da rota falhar. Pergunta uma vez, na primeira gravação.
  let temUpdatedAt: boolean | null = null;
  let atualizados = 0;
  let semMudanca = 0;

  for (const raw of reps) {
    if (!ehObjeto(raw)) {
      ignorados.push({ codigo: null, motivo: 'registro inválido' });
      continue;
    }
    const codigo = textoSimples(raw['codigo']);
    const miolo = codigoMiolo(codigo);
    if (!codigo || !miolo) {
      ignorados.push({ codigo, motivo: 'sem código do ERP' });
      continue;
    }
    const nome = textoSimples(raw['nome']);
    if (!nome) {
      ignorados.push({ codigo, motivo: 'sem nome' });
      continue;
    }
    if (vistosNoLote.has(miolo)) {
      ignorados.push({ codigo, motivo: 'código repetido no lote' });
      continue;
    }
    vistosNoLote.add(miolo);
    if (mioloComDoisLogins.has(miolo)) {
      ignorados.push({ codigo, motivo: 'código repetido no app (dois logins com o mesmo código)' });
      continue;
    }

    const login = porMiolo.get(miolo);
    if (!login) {
      novos.push({ codigo, nome });
      continue;
    }

    const pedido: Record<string, unknown> = { name: nome };
    const razao = lerTexto(raw, 'razao_social');
    if (razao.veio) pedido['legal_name'] = razao.valor;

    // "Só é alterado quando vem": string vazia (um CHAR nulo do Firebird
    // serializado como "") NÃO é "veio" — antes ela desligava o login do rep a
    // cada envio, em silêncio.
    const ativo = lerAtivo(raw);
    if (ativo === 'invalido') ativosInvalidos.add(codigo);
    else if (ativo !== undefined) pedido['active'] = ativo;

    // O e-mail do Control: coluna própria (049). O login (users.email) nunca.
    const email = lerTexto(raw, 'email');
    if (email.veio) {
      if (comEmailDoControl) pedido['erp_email'] = email.valor;
      else if (email.valor !== null) {
        const doLogin = (login.email ?? '').trim().toLowerCase();
        if (email.valor.toLowerCase() !== doLogin) emailsDiferentes.add(codigo);
      }
    }

    const patch: Record<string, unknown> = {};
    for (const [coluna, valor] of Object.entries(pedido)) {
      if (!mesmoValor(login[coluna as keyof LinhaLogin], valor)) patch[coluna] = valor;
    }
    if (Object.keys(patch).length === 0) {
      semMudanca++;
      continue;
    }
    if (temUpdatedAt === null) temUpdatedAt = await detectar('users', 'updated_at');
    if (temUpdatedAt) patch['updated_at'] = new Date().toISOString();

    const { error } = await supabase
      .from('users')
      .update(patch)
      .eq('id', login.id)
      .eq('company_id', company_id)
      .eq('role', 'rep');
    if (error) {
      // Restrição do banco (valor repetido ou fora do formato) é defeito DESTE
      // registro: vira ignorado e o lote segue. Qualquer outro erro continua
      // 500 — o Control reenvia, e o que já foi gravado volta como sem_mudanca.
      const codigoDoErro = (error as { code?: string }).code;
      if (codigoDoErro === '23505' || codigoDoErro === '23514') {
        ignorados.push({ codigo, motivo: `falha ao gravar: ${error.message}` });
        continue;
      }
      throw new Error(`Atualizar rep ${codigo} falhou: ${error.message}`);
    }
    atualizados++;
  }

  const avisos: string[] = [];
  if (novos.length > 0) {
    avisos.push(
      `${novos.length} representante(s) do Control ainda não têm login no app — crie o acesso deles na tela de Representantes para receberem os dados.`,
    );
  }
  if (emailsDiferentes.size > 0) {
    avisos.push(
      `${AVISO_EMAIL_DO_REPRESENTANTE} — e-mail diferente do login, não gravado (fica guardado depois da migração 049): ${listar(emailsDiferentes)}.`,
    );
  }
  if (ativosInvalidos.size > 0) {
    avisos.push(
      `"ativo" não reconhecido (aceito S, N, true ou false) — o acesso não foi mexido: ${listar(ativosInvalidos)}.`,
    );
  }

  return {
    recebidos: reps.length,
    criados: 0,
    atualizados,
    sem_mudanca: semMudanca,
    ignorados,
    avisos,
    novos,
  };
}

// ─── O que mudou no app (a outra mão: o Control PUXA) ────────────────────────
//
// O Control busca a cada ~5 min o que o app mudou (GET ?desde=): cliente
// cadastrado ou editado pelo representante, representante mexido pelo admin.
// Sai no MESMO formato que o POST aceita, para o Control gravar do lado dele e
// — se quiser — devolver como veio (reenviar é `sem_mudanca`).
//
// Com a 049, o que o próprio Control gravou e ninguém mexeu depois NÃO volta:
// updated_at até a folga depois de erp_updated_at é "a última mão foi a dele"
// (partner.eco.ts — a trigger da 013 grava updated_at com a hora do banco, um
// pouco depois do carimbo). Sem a 049 não há como saber, e a lista traz tudo
// que mudou desde `desde` — inclusive o que o Control acabou de mandar;
// inofensivo, só maior.
//
// Com a 051, cada cliente diz em `alterado_no_app` quais campos o app editou
// e o Control ainda não tem — e o cliente com edição pendente nunca é tirado
// da lista pelo anti-eco.

/**
 * Os clientes que mudaram no app desde `desde` (ou todos, sem `desde`),
 * ordenados por `updated_at`. Paginado; erro em qualquer página sobe (500)
 * para o Control tentar de novo — uma lista pela metade seria lida como "o
 * resto não mudou".
 */
export async function listarClientesAlterados(
  company_id: string,
  desde?: string | null,
): Promise<ListaAlterados<ClienteAlterado>> {
  const cadastroReal = await detectarCadastroReal();
  const com049 = await detectarClienteDa049();

  const codigoDaTabela = new Map<string, string | null>();
  for (const t of await tabelasDePreco(company_id)) codigoDaTabela.set(t.id, t.erp_code);

  const colunas = [
    `${COLUNAS_DO_CLIENTE}, updated_at`,
    cadastroReal ? COLUNAS_DA_041 : null,
    com049 ? COLUNAS_DA_049 : null,
  ]
    .filter(Boolean)
    .join(', ');
  // Paginado pela CHAVE (updated_at, id), não pela posição: um cliente gravado
  // de novo durante a leitura empurrava outro para uma página já lida — e esse
  // não saía nunca (revisão de 17/09/2026, ver `buscarPelaChaveOuFalhar`).
  const linhas = await buscarPelaChaveOuFalhar<LinhaCliente & { updated_at: string }>((ultima, limite) => {
    let query = supabase.from('customers').select(colunas).eq('company_id', company_id);
    if (desde) query = query.gte('updated_at', desde);
    if (ultima) query = query.or(depoisDaChave(ultima));
    return query.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(limite);
  });

  // As edições do cadastro que ainda não chegaram ao Control (051): todas as
  // pendentes da empresa numa leitura paginada (a fila é pequena; a lista de
  // clientes pode ter milhares). Falhar LANÇA (500), como uma página de
  // clientes: sem ela o Control não saberia o que o app editou. `null` = sem
  // a 051 — `alterado_no_app` sai null.
  const pendentesDoApp = linhas.length > 0 || desde ? await lerAlteracoesPendentesEmLote(company_id) : null;

  // O cliente com edição pendente sai em TODA puxada até o Control ter a
  // edição (revisão de 17/09/2026) — é o que o contrato promete. Pelo
  // `updated_at` ele saía uma vez só: se o Control lesse e não aplicasse (ou
  // reenviasse o valor antigo, que o POST não grava e portanto não mexe no
  // `updated_at`), o `desde` seguinte já o deixava de fora e a edição sumia do
  // caminho automático. Os que não vieram pelo `desde` são lidos por id, em lote.
  if (desde && pendentesDoApp && pendentesDoApp.size > 0) {
    const naLista = new Set(linhas.map((l) => l.id));
    const faltando = [...pendentesDoApp.keys()].filter((id) => !naLista.has(id));
    for (const lote of emLotes(faltando)) {
      linhas.push(
        ...(await buscarTudoOuFalhar<LinhaCliente & { updated_at: string }>((de, ate) =>
          supabase
            .from('customers')
            .select(colunas)
            .eq('company_id', company_id)
            .in('id', lote)
            .order('id', { ascending: true })
            .range(de, ate),
        )),
      );
    }
    if (faltando.length > 0) {
      const instante = (v: string) => Date.parse(v) || 0;
      linhas.sort((a, b) => instante(a.updated_at) - instante(b.updated_at) || a.id.localeCompare(b.id));
    }
  }

  const registros: ClienteAlterado[] = [];
  for (const c of linhas) {
    const doApp = alteradoNoApp(pendentesDoApp?.get(c.id));
    // A última mão foi a do Control? Então ele já tem isto — a não ser que haja
    // edição do app esperando por ele: a edição feita nos segundos de folga
    // depois de uma gravação do Control (partner.eco.ts) não pode sumir do GET.
    const carimboDoControl = typeof c['erp_updated_at'] === 'string' ? c['erp_updated_at'] : null;
    if (com049 && !doApp && ultimaMaoFoiDoControl(c.updated_at, carimboDoControl)) continue;

    const texto = (coluna: string): string | null => {
      const v = c[coluna];
      return typeof v === 'string' && v.trim() !== '' ? v : null;
    };
    const erpId = texto('erp_id');
    const tabelaId = texto('price_table_id');
    const registro: ClienteAlterado = {
      codigo: erpId,
      chave: digitosDoDocumento(c.cnpj),
      novo_no_control: erpId === null,
      razao_social: texto('name') ?? '',
      nome_fantasia: texto('trade_name'),
      cnpj_cpf: texto('cnpj'),
      representante: texto('rep_erp_id'),
      tabela_preco: tabelaId ? (codigoDaTabela.get(tabelaId) ?? null) : null,
      endereco: cadastroReal
        ? {
            logradouro: texto('logradouro'),
            numero: texto('numero'),
            complemento: texto('complemento'),
            bairro: texto('bairro'),
            cidade: texto('cidade'),
            uf: texto('uf'),
            cep: texto('cep'),
          }
        : texto('address'),
      bloqueado: c['blocked'] === true ? 'S' : 'N',
      motivo_bloqueio: texto('block_reason'),
      limite_credito: numeroOuNull(c['credit_limit']),
      whatsapp: texto('whatsapp'),
      email: texto('email'),
      atualizado_em: c.updated_at,
      alterado_no_app: doApp,
    };
    if (cadastroReal) {
      registro.inscricao_estadual = texto('inscricao_estadual');
      registro.observacoes = texto('observacoes');
    }
    if (com049) {
      registro.pendencia_financeira = numeroOuNull(c['pendencia_financeira']);
      registro.titulos_vencidos = numeroOuNull(c['titulos_vencidos']);
      registro.atualizado_pelo_control_em = carimboDoControl;
    }
    registros.push(registro);
  }

  const avisos: string[] = [];
  if (!com049) {
    avisos.push(
      'Sem a migração 049 a lista inclui também o que o próprio Control gravou nesta janela — reenviar é inofensivo (sem_mudanca).',
    );
  }
  return { registros, avisos };
}

/**
 * Os representantes (logins com código do ERP) que mudaram no app desde
 * `desde`, ordenados por `updated_at`. `users.updated_at` vem da 048: sem ela
 * não há como saber o que mudou — a lista vem inteira, com aviso.
 */
export async function listarRepresentantesAlterados(
  company_id: string,
  desde?: string | null,
): Promise<ListaAlterados<RepresentanteAlterado>> {
  const temUpdatedAt = await detectarOuFalhar('users', 'updated_at');
  const comEmailDoControl = await detectarEmailDoControl();

  const colunas = [
    'id, erp_rep_id, name, legal_name, active',
    temUpdatedAt ? 'updated_at' : null,
    comEmailDoControl ? 'erp_email' : null,
  ]
    .filter(Boolean)
    .join(', ');
  // Pela chave, como os clientes (ver `buscarPelaChaveOuFalhar`).
  const linhas = await buscarPelaChaveOuFalhar<LinhaLogin>((ultima, limite) => {
    let query = supabase
      .from('users')
      .select(colunas)
      .eq('company_id', company_id)
      .eq('role', 'rep')
      .not('erp_rep_id', 'is', null);
    if (desde && temUpdatedAt) query = query.gte('updated_at', desde);
    if (ultima) query = temUpdatedAt ? query.or(depoisDaChave(ultima)) : query.gt('id', ultima.id);
    if (temUpdatedAt) query = query.order('updated_at', { ascending: true });
    return query.order('id', { ascending: true }).limit(limite);
  });

  const registros: RepresentanteAlterado[] = [];
  for (const u of linhas) {
    if (typeof u.erp_rep_id !== 'string' || u.erp_rep_id.trim() === '') continue;
    const registro: RepresentanteAlterado = {
      codigo: u.erp_rep_id,
      nome: u.name ?? '',
      razao_social: u.legal_name ?? null,
      ativo: u.active === false ? 'N' : 'S',
      atualizado_em: temUpdatedAt ? (u.updated_at ?? null) : null,
    };
    if (comEmailDoControl) registro.email = u.erp_email ?? null;
    registros.push(registro);
  }

  const avisos: string[] = [];
  if (desde && !temUpdatedAt) {
    avisos.push('Sem a migração 048 não há como saber o que mudou nos representantes — a lista veio inteira.');
  }
  return { registros, avisos };
}
