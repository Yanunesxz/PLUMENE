/**
 * Recebe dados que o ERP do parceiro empurra e grava no Supabase.
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
 * Chave de tudo é o CÓDIGO do ERP, casado pelo miolo (`codigoMiolo`, de
 * @csb/shared): "#2225", "2225" e "02225" são o mesmo cadastro. O índice único
 * de `customers(company_id, erp_id)` é exato, então o upsert é feito por mapa
 * (busca os existentes, decide update ou insert) — não por `onConflict`.
 */
import { apenasDigitos, codigoCanonico, codigoMiolo, linhaDeEndereco } from '@csb/shared';
import { supabase } from '../../config/supabase.js';
import { buscarTudoOuFalhar, emLotes } from '../../lib/paginacao.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';

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
}

export interface RepresentanteParceiro {
  codigo?: string | null;
  nome?: string | null;
  razao_social?: string | null;
  /** Aceito e IGNORADO: o e-mail do login só muda pelas telas do app. */
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

// ─── Leitura do que veio ─────────────────────────────────────────────────────

/** O campo não veio (ou veio vazio), ou veio com um valor — `null` = limpar. */
type Recebido<T> = { veio: false } | { veio: true; valor: T | null };

const NAO_VEIO = { veio: false } as const;

/** Até quantos códigos um aviso lista (o resto vira "e mais N"). */
const CODIGOS_POR_AVISO = 20;

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
 * `limite_credito`: número ou texto numérico ("1500.50", "1.500,50"). `null`
 * limpa. Negativo ou ilegível não mexe e volta como aviso (a 013 recusa
 * negativo no banco — antes isso derrubava o lote inteiro).
 */
function lerLimite(obj: Record<string, unknown>): Recebido<number> | { veio: 'invalido' } {
  if (!tem(obj, 'limite_credito')) return NAO_VEIO;
  const v = obj['limite_credito'];
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

// ─── Clientes ────────────────────────────────────────────────────────────────

/** Os pedaços do endereço: mesmos nomes no corpo e nas colunas da 041. */
const PECAS_DO_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'] as const;
type PecaDoEndereco = (typeof PECAS_DO_ENDERECO)[number];

/** Colunas de `customers` que esta rota compara e grava. */
const COLUNAS_DO_CLIENTE =
  'id, erp_id, name, trade_name, cnpj, rep_erp_id, price_table_id, blocked, credit_limit, whatsapp, email, address';
/** As da migração 041, só onde ela rodou. */
const COLUNAS_DA_041 = `${PECAS_DO_ENDERECO.join(', ')}, inscricao_estadual, observacoes`;

type LinhaCliente = { id: string; erp_id: string | null; cnpj: string | null } & Record<string, unknown>;

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
  const cadastroReal = await detectarOuFalhar('customers', 'cep');

  const { data: tabelas, error: erroTabelas } = await supabase
    .from('price_tables')
    .select('id, erp_code')
    .eq('company_id', company_id);
  if (erroTabelas) throw new Error(`Ler as tabelas de preço falhou: ${erroTabelas.message}`);
  const tabelaPorMiolo = new Map<string, string>();
  const tabelasComCodigoRepetido = new Set<string>();
  for (const t of (Array.isArray(tabelas) ? tabelas : []) as Array<{ id: string; erp_code: string | null }>) {
    const m = codigoMiolo(t.erp_code);
    if (!m) continue;
    if (tabelaPorMiolo.has(m) && tabelaPorMiolo.get(m) !== t.id) tabelasComCodigoRepetido.add(m);
    else tabelaPorMiolo.set(m, t.id);
  }

  // Existentes por código (miolo) — e por CNPJ os que estão SEM código. Estes
  // últimos vieram das cargas de carteira (relatório Curva ABC, que não traz
  // código): quando o ERP mandar o mesmo cliente COM código, é adoção, não
  // criação — senão a mesma loja vira duas.
  //
  // PAGINADO e ordenado por id: o PostgREST corta em 1.000 linhas sem avisar,
  // e a CS já tem mais de 2.600 clientes. Sem paginar, todo cliente da página
  // 2 em diante ficava fora deste mapa — e a carga o CRIARIA de novo.
  const colunas = cadastroReal ? `${COLUNAS_DO_CLIENTE}, ${COLUNAS_DA_041}` : COLUNAS_DO_CLIENTE;
  const existentes = await buscarTudoOuFalhar<LinhaCliente>((de, ate) =>
    supabase.from('customers').select(colunas).eq('company_id', company_id).order('id').range(de, ate),
  );
  const porMiolo = new Map<string, LinhaCliente>();
  const mioloComDoisCadastros = new Set<string>();
  const semCodigoPorCnpj = new Map<string, LinhaCliente>();
  const cnpjComDoisCadastros = new Set<string>();
  for (const c of existentes) {
    const m = codigoMiolo(c.erp_id);
    if (m) {
      if (porMiolo.has(m)) mioloComDoisCadastros.add(m);
      else porMiolo.set(m, c);
      continue;
    }
    const d = digitosDoDocumento(c.cnpj);
    if (!d) continue;
    if (semCodigoPorCnpj.has(d)) cnpjComDoisCadastros.add(d);
    else semCodigoPorCnpj.set(d, c);
  }

  // ── 2. Decide, registro a registro, o que gravar.
  const paraInserir: Array<{ codigo: string; linha: Record<string, unknown> }> = [];
  const paraAtualizar: Array<{ codigo: string; id: string; patch: Record<string, unknown>; adotado: boolean }> = [];
  const vistosNoLote = new Set<string>();
  const tabelasNaoAchadas = new Set<string>();
  const tabelasAmbiguas = new Set<string>();
  const limitesInvalidos = new Set<string>();
  const bloqueiosInvalidos = new Set<string>();
  const codigosDeRepresentante = new Set<string>();
  const adocaoAmbigua = new Set<string>();
  let camposQuePrecisamDa041 = false;
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
    if (mioloComDoisCadastros.has(miolo)) {
      ignorados.push({ codigo, motivo: 'código com mais de um cadastro no app' });
      continue;
    }

    let existente = porMiolo.get(miolo);
    let adotado = false;
    if (!existente) {
      // Adoção por CNPJ: o cliente já existe sem código (veio da carga de
      // carteira) e agora aprende o código do Control — daqui em diante ele
      // casa pelo caminho normal.
      const d = digitosDoDocumento(raw['cnpj_cpf']);
      const alvo = d ? semCodigoPorCnpj.get(d) : undefined;
      if (d && alvo) {
        existente = alvo;
        adotado = true;
        semCodigoPorCnpj.delete(d); // duas linhas não adotam o mesmo cadastro
        if (cnpjComDoisCadastros.has(d)) adocaoAmbigua.add(codigo);
      }
    }

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

    const limite = lerLimite(raw);
    if (limite.veio === true) pedido['credit_limit'] = limite.valor;
    else if (limite.veio === 'invalido') limitesInvalidos.add(codigo);

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
      const patch: Record<string, unknown> = {};
      for (const [coluna, valor] of Object.entries(pedido)) {
        if (!mesmoValor(existente[coluna], valor)) patch[coluna] = valor;
      }
      // O `erp_id` de quem já tem código nunca é reescrito — só casa. Quem é
      // adotado pelo CNPJ não tinha código: aprende o do Control.
      if (adotado) patch['erp_id'] = codigoCanonico(codigo);
      if (Object.keys(patch).length === 0) {
        semMudanca++;
        continue;
      }
      patch['updated_at'] = agora;
      paraAtualizar.push({ codigo, id: existente.id, patch, adotado });
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
      paraInserir.push({ codigo, linha: { ...base, ...pedido, updated_at: agora } });
    }
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
  for (const u of paraAtualizar) {
    const { error } = await supabase
      .from('customers')
      .update(u.patch)
      .eq('id', u.id)
      .eq('company_id', company_id);
    if (error) {
      ignorados.push({ codigo: u.codigo, motivo: `falha ao gravar: ${error.message}` });
      continue;
    }
    atualizados++;
    if (u.adotado) adotadosPorCnpj++;
  }

  // ── 4. Avisos do lote.
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
  if (camposQuePrecisamDa041) {
    avisos.push(
      'Endereço em campos separados, inscrição estadual e observações ficam guardados depois da migração 041 — por ora só a linha do endereço foi gravada.',
    );
  }
  if (adotadosPorCnpj > 0) {
    avisos.push(
      `${adotadosPorCnpj} cliente(s) já existiam sem código e foram casados pelo CNPJ — agora têm o código do Control.`,
    );
  }
  if (adocaoAmbigua.size > 0) {
    avisos.push(
      `CNPJ com mais de um cadastro sem código no app — o código foi para o primeiro deles; confira os outros: ${listar(adocaoAmbigua)}.`,
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
  active?: boolean | null;
};

/** Aviso fixo quando o Control manda um e-mail diferente do login. */
export const AVISO_EMAIL_DO_REPRESENTANTE = 'e-mail do Control não troca o login do representante';

/**
 * Atualiza os representantes que JÁ EXISTEM (nome, razão social, ativo),
 * casando pelo miolo do código do ERP dentro da empresa e do papel `rep`.
 *
 * Não cria login novo: conta de acesso nasce com senha, e uma senha vinda de um
 * POST externo é risco que ninguém pediu. Rep que o Control tem mas o app ainda
 * não vem na lista `novos`, para o admin criar à mão.
 *
 * NÃO grava `users.email`: é o login (e único no banco inteiro). O e-mail que
 * chega é ignorado, com aviso quando difere do login.
 */
export async function receberRepresentantes(
  company_id: string,
  reps: readonly unknown[],
): Promise<ResultadoSync & { novos: Array<{ codigo: string; nome: string | null }> }> {
  const ignorados: ResultadoSync['ignorados'] = [];
  const novos: Array<{ codigo: string; nome: string | null }> = [];

  // Leitura antes de gravar; falhou, lança (500) — sem ela todo rep viraria
  // "novo" e o Control concluiria que ninguém tem login.
  const { data: existentes, error: erroLeitura } = await supabase
    .from('users')
    .select('id, erp_rep_id, name, legal_name, email, active')
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .not('erp_rep_id', 'is', null);
  if (erroLeitura) throw new Error(`Ler os representantes falhou: ${erroLeitura.message}`);

  const porMiolo = new Map<string, LinhaLogin>();
  const mioloComDoisLogins = new Set<string>();
  for (const u of (Array.isArray(existentes) ? existentes : []) as LinhaLogin[]) {
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

    const email = lerTexto(raw, 'email');
    if (email.veio && email.valor !== null) {
      const doLogin = (login.email ?? '').trim().toLowerCase();
      if (email.valor.toLowerCase() !== doLogin) emailsDiferentes.add(codigo);
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
      `${AVISO_EMAIL_DO_REPRESENTANTE} — e-mail diferente do login, não gravado: ${listar(emailsDiferentes)}.`,
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
