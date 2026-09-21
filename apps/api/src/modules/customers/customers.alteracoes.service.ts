import { supabase } from '../../config/supabase.js';
import { detectar, detectarComCerteza, detectarOuFalhar } from '../../lib/detectarColuna.js';
import { buscarTudoOuFalhar, emLotes } from '../../lib/paginacao.js';
import { ALTERACOES_RESOLVIDAS_NA_FICHA, camposNoContratoDoParceiro } from '@csb/shared';
import type {
  AlteracaoDoCliente,
  CampoDoHistoricoDoCadastro,
  CamposAlteradosDoCadastro,
  ClienteComAlteracaoPendente,
  MudancaDeCampoDoCadastro,
  NomeNoContratoDoParceiro,
  ViaDaAtualizacaoNoControl,
} from '@csb/shared';

/**
 * O HISTÓRICO DAS EDIÇÕES DO CADASTRO e a fila do que precisa chegar ao
 * Control (migração 051, `customer_changes`).
 *
 * Pedido do Yan (17/09/2026): "quando mudar lá tem que mudar no ERP do Fábio
 * também". O app não escreve no Control: quem leva a mudança é uma pessoa (o
 * financeiro, avisado por push, que confirma "Já atualizei no Control") ou o
 * próprio Control, pela API de Parceiro, quando devolve o mesmo valor. Esta
 * tabela é o recado que não pode se perder entre uma coisa e outra.
 *
 * Uma edição é PENDENTE enquanto `erp_pendente` (o cliente já estava no
 * Control quando foi editado — ou o Control, ao adotá-lo pelo CNPJ, mostrou não
 * ter a edição; ver `colocarNaFilaDoControl`) e `erp_atualizado_em` é nulo.
 *
 * Aqui mora tudo que lê e marca as linhas — a ficha, a fila da Minha área, o
 * "Já atualizei no Control" e as duas funções em lote que a API de Parceiro usa
 * (`lerAlteracoesPendentesEmLote` e `resolverAlteracoesPelaApi`).
 */

/** As colunas de uma alteração, na forma de `AlteracaoDoCliente`. */
export const COLUNAS_DA_ALTERACAO =
  'id, customer_id, alterado_por, alterado_por_nome, alterado_em, campos, erp_pendente, erp_atualizado_em, erp_atualizado_por, erp_atualizado_por_nome, erp_atualizado_via';

/**
 * Quantas edições já resolvidas a ficha mostra (as pendentes vão todas). O
 * número mora no shared: a tela escreve "(últimas N)" com o mesmo.
 */
export const RESOLVIDAS_NA_FICHA = ALTERACOES_RESOLVIDAS_NA_FICHA;

/** Teto de pendentes lidas para UMA ficha — muito acima do que um cliente acumula. */
const PENDENTES_NA_FICHA = 500;

/** `.in('id', …)` vai na URL: lotes pequenos, como na exclusão. */
const IDS_POR_LOTE = 100;

/**
 * A 051 rodou? "Não existe" e "não deu para perguntar" são respostas
 * diferentes: a edição do cadastro PARA nas duas (sem histórico a mudança
 * nunca chegaria ao Control), mas diz coisas diferentes a quem tentou.
 */
export async function sondarMigracao051(): Promise<'existe' | 'nao_existe' | 'nao_sei'> {
  return detectarComCerteza('customer_changes', 'id');
}

/** A edição ainda espera o Control? */
export function estaPendente(a: Pick<AlteracaoDoCliente, 'erp_pendente' | 'erp_atualizado_em'>): boolean {
  return a.erp_pendente && !a.erp_atualizado_em;
}

const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** O `campos` do banco (jsonb) no formato do tipo — o que não for {antes, depois} fica de fora. */
function camposDaLinha(v: unknown): CamposAlteradosDoCadastro {
  const saida: Record<string, MudancaDeCampoDoCadastro> = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return saida;
  for (const [campo, mudanca] of Object.entries(v as Record<string, unknown>)) {
    if (typeof mudanca !== 'object' || mudanca === null) continue;
    const m = mudanca as Record<string, unknown>;
    const lida: MudancaDeCampoDoCadastro = { antes: texto(m['antes']), depois: texto(m['depois']) };
    // A marca da linha do endereço que já não era a das peças (17/09/2026).
    if (m['linha_fora_das_pecas'] === true) lida.linha_fora_das_pecas = true;
    saida[campo] = lida;
  }
  return saida as CamposAlteradosDoCadastro;
}

/** Uma linha de `customer_changes` como a API devolve. */
export function paraAlteracao(linha: Record<string, unknown>): AlteracaoDoCliente {
  const via = linha['erp_atualizado_via'];
  return {
    id: String(linha['id']),
    customer_id: String(linha['customer_id']),
    alterado_por: texto(linha['alterado_por']),
    alterado_por_nome: texto(linha['alterado_por_nome']),
    alterado_em: String(linha['alterado_em']),
    campos: camposDaLinha(linha['campos']),
    erp_pendente: linha['erp_pendente'] === true,
    erp_atualizado_em: texto(linha['erp_atualizado_em']),
    erp_atualizado_por: texto(linha['erp_atualizado_por']),
    erp_atualizado_por_nome: texto(linha['erp_atualizado_por_nome']),
    erp_atualizado_via: via === 'app' || via === 'api' ? (via as ViaDaAtualizacaoNoControl) : null,
  };
}

/** Das mais novas para as mais antigas (o id desempata, para a ordem não pular). */
const maisNovasPrimeiro = (a: AlteracaoDoCliente, b: AlteracaoDoCliente): number =>
  b.alterado_em.localeCompare(a.alterado_em) || b.id.localeCompare(a.id);

// ─── A ficha ─────────────────────────────────────────────────────────────────

/**
 * As edições que a ficha mostra: TODAS as pendentes e as últimas
 * `RESOLVIDAS_NA_FICHA` das demais, das mais novas para as mais antigas.
 *
 * `null` = sem a 051, ou a leitura falhou: a ficha vem sem o campo, como antes
 * da 051. Uma lista pela metade (só as resolvidas, por exemplo) esconderia a
 * pendência — pior que não mostrar nada.
 */
export async function lerAlteracoesDoCliente(
  company_id: string,
  customer_id: string,
): Promise<AlteracaoDoCliente[] | null> {
  if (!(await detectar('customer_changes', 'id'))) return null;

  const [pendentes, demais] = await Promise.all([
    supabase
      .from('customer_changes')
      .select(COLUNAS_DA_ALTERACAO)
      .eq('company_id', company_id)
      .eq('customer_id', customer_id)
      .eq('erp_pendente', true)
      .is('erp_atualizado_em', null)
      .order('alterado_em', { ascending: false })
      .limit(PENDENTES_NA_FICHA),
    supabase
      .from('customer_changes')
      .select(COLUNAS_DA_ALTERACAO)
      .eq('company_id', company_id)
      .eq('customer_id', customer_id)
      // O complemento exato de "pendente": ou nunca precisou ir ao Control, ou já foi.
      .or('erp_pendente.eq.false,erp_atualizado_em.not.is.null')
      .order('alterado_em', { ascending: false })
      .limit(RESOLVIDAS_NA_FICHA),
  ]);
  if (pendentes.error || demais.error) {
    console.error(
      `[051] falha ao ler as alterações do cliente ${customer_id}: ${(pendentes.error ?? demais.error)?.message ?? ''}`,
    );
    return null;
  }

  const linhas = [
    ...(Array.isArray(pendentes.data) ? pendentes.data : []),
    ...(Array.isArray(demais.data) ? demais.data : []),
  ] as unknown as Array<Record<string, unknown>>;
  const vistas = new Set<string>();
  const alteracoes: AlteracaoDoCliente[] = [];
  for (const l of linhas) {
    const a = paraAlteracao(l);
    if (vistas.has(a.id)) continue;
    vistas.add(a.id);
    alteracoes.push(a);
  }
  return alteracoes.sort(maisNovasPrimeiro);
}

// ─── A fila da Minha área ────────────────────────────────────────────────────

export type FilaDeAlteracoes =
  | { ok: true; clientes: ClienteComAlteracaoPendente[]; migracao_pendente: boolean }
  | { ok: false; motivo: 'banco_indisponivel' | 'erro'; detalhe?: string };

/**
 * GET /customers/alteracoes-pendentes — os clientes com edição esperando o
 * Control, a mais antiga primeiro (é fila: quem espera há mais tempo vem antes).
 * Sem a 051: lista vazia com `migracao_pendente` (a tela esconde o cartão).
 */
export async function listarClientesComAlteracaoPendente(company_id: string): Promise<FilaDeAlteracoes> {
  const migracao = await sondarMigracao051();
  if (migracao === 'nao_existe') return { ok: true, clientes: [], migracao_pendente: true };
  if (migracao === 'nao_sei') return { ok: false, motivo: 'banco_indisponivel' };

  try {
    const linhas = await buscarTudoOuFalhar<{ customer_id: string; alterado_em: string }>((de, ate) =>
      supabase
        .from('customer_changes')
        .select('id, customer_id, alterado_em')
        .eq('company_id', company_id)
        .eq('erp_pendente', true)
        .is('erp_atualizado_em', null)
        .order('alterado_em', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate),
    );

    const porCliente = new Map<string, { pendentes: number; desde: string; ultima_em: string }>();
    for (const l of linhas) {
      const atual = porCliente.get(l.customer_id);
      if (!atual) {
        porCliente.set(l.customer_id, { pendentes: 1, desde: l.alterado_em, ultima_em: l.alterado_em });
        continue;
      }
      atual.pendentes += 1;
      if (l.alterado_em < atual.desde) atual.desde = l.alterado_em;
      if (l.alterado_em > atual.ultima_em) atual.ultima_em = l.alterado_em;
    }

    const clientes: ClienteComAlteracaoPendente[] = [];
    for (const lote of emLotes([...porCliente.keys()])) {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, erp_id, rep_erp_id')
        .eq('company_id', company_id)
        .in('id', lote);
      if (error) throw new Error(`ler os clientes da fila: ${error.message}`);
      for (const c of (Array.isArray(data) ? data : []) as Array<{
        id: string;
        name: string;
        erp_id: string | null;
        rep_erp_id: string | null;
      }>) {
        const resumo = porCliente.get(c.id);
        if (!resumo) continue;
        clientes.push({ customer_id: c.id, name: c.name, erp_id: c.erp_id, rep_erp_id: c.rep_erp_id, ...resumo });
      }
    }
    clientes.sort((a, b) => a.desde.localeCompare(b.desde) || a.customer_id.localeCompare(b.customer_id));
    return { ok: true, clientes, migracao_pendente: false };
  } catch (e) {
    return { ok: false, motivo: 'erro', detalhe: e instanceof Error ? e.message : String(e) };
  }
}

// ─── "Já atualizei no Control" ───────────────────────────────────────────────

export type ConfirmacaoNoControl =
  | {
      ok: true;
      confirmadas: string[];
      /** `null` = gravou, mas a releitura falhou: a tela recarrega a ficha. */
      alteracoes: AlteracaoDoCliente[] | null;
    }
  | {
      ok: false;
      motivo:
        | 'migracao_pendente'
        | 'banco_indisponivel'
        | 'cliente_nao_encontrado'
        /** Falhou sem marcar nada: "nada foi marcado" é verdade. */
        | 'erro'
        /**
         * O UPDATE respondeu erro e nem a releitura respondeu: não dá para dizer
         * se a baixa ficou. Nunca "nada foi marcado" (ver `confirmarAlteracoesNoControl`).
         */
        | 'confirmacao_incerta';
      detalhe?: string;
    };

/**
 * Como ficaram as linhas depois de um UPDATE de confirmação que respondeu erro
 * (revisão de 17/09/2026). Relê pelos ids — GET, que o cliente do banco repete
 * sozinho — e separa as que ESTA confirmação marcou (o carimbo dela: o momento
 * gerado aqui, quem confirmou e o canal 'app'; ninguém regrava uma linha já
 * marcada, então o carimbo fica) das que continuam pendentes. `null` = nem a
 * releitura respondeu.
 */
async function comoAConfirmacaoFicou(
  company_id: string,
  customer_id: string,
  ids: readonly string[],
  carimbo: { em: string; por: string },
): Promise<{ marcadasPorEsta: string[]; aindaPendentes: string[] } | null> {
  const { data, error } = await supabase
    .from('customer_changes')
    .select('id, erp_pendente, erp_atualizado_em, erp_atualizado_por, erp_atualizado_via')
    .eq('company_id', company_id)
    .eq('customer_id', customer_id)
    .in('id', [...ids]);
  if (error) return null;
  const linhas = (Array.isArray(data) ? data : []) as Array<{
    id: string;
    erp_pendente: boolean | null;
    erp_atualizado_em: string | null;
    erp_atualizado_por: string | null;
    erp_atualizado_via: string | null;
  }>;
  // O banco devolve o timestamptz noutro formato ("+00:00" no lugar do "Z"):
  // compara como instante.
  const instante = Date.parse(carimbo.em);
  const marcadasPorEsta = linhas
    .filter(
      (l) =>
        l.erp_atualizado_em !== null &&
        Date.parse(l.erp_atualizado_em) === instante &&
        l.erp_atualizado_por === carimbo.por &&
        l.erp_atualizado_via === 'app',
    )
    .map((l) => l.id);
  const aindaPendentes = linhas.filter((l) => l.erp_pendente === true && !l.erp_atualizado_em).map((l) => l.id);
  return { marcadasPorEsta, aindaPendentes };
}

/**
 * O financeiro (ou o admin) confirma que levou as edições ao Control.
 *
 * Marca SÓ os ids que vieram — os que a pessoa VIU na ficha —, e só se ainda
 * pendentes, deste cliente e desta empresa. Confirmar "tudo do cliente" daria
 * baixa numa edição que chegou enquanto ela digitava no Control, e essa nunca
 * chegaria lá.
 *
 * ERRO NÃO É "NÃO MARCOU" (revisão de 17/09/2026), a mesma doutrina da edição
 * do cadastro: o postgrest-js não repete PATCH, e a conexão que cai (ou o
 * 502/504 do gateway) DEPOIS do commit chega aqui como erro. Lido como "não
 * gravou", a API respondia "Nada foi marcado — tente de novo" com a baixa
 * gravada, e o cartão seguia pedindo o que já estava feito. Diante do erro, relê
 * as linhas: o que esta confirmação marcou volta como confirmado (200); tudo
 * ainda pendente é "nada foi marcado" de verdade; sem releitura, é incerto.
 */
export async function confirmarAlteracoesNoControl(
  company_id: string,
  customer_id: string,
  ids: readonly string[],
  quem: { id: string; nome: string },
): Promise<ConfirmacaoNoControl> {
  const migracao = await sondarMigracao051();
  if (migracao === 'nao_existe') return { ok: false, motivo: 'migracao_pendente' };
  if (migracao === 'nao_sei') return { ok: false, motivo: 'banco_indisponivel' };

  const { data: cliente, error: erroDoCliente } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (erroDoCliente) return { ok: false, motivo: 'erro', detalhe: erroDoCliente.message };
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  const unicos = [...new Set(ids)];
  // O momento nasce aqui (e não no banco): se a resposta se perder, é por ele
  // que se reconhece a baixa desta confirmação na releitura.
  const em = new Date().toISOString();
  const { data, error } = await supabase
    .from('customer_changes')
    .update({
      erp_atualizado_em: em,
      erp_atualizado_por: quem.id,
      erp_atualizado_por_nome: quem.nome,
      erp_atualizado_via: 'app',
    })
    .eq('company_id', company_id)
    .eq('customer_id', customer_id)
    .eq('erp_pendente', true)
    .is('erp_atualizado_em', null)
    .in('id', unicos)
    .select('id');

  let confirmadas: string[];
  if (error) {
    const ficou = await comoAConfirmacaoFicou(company_id, customer_id, unicos, { em, por: quem.id });
    if (!ficou) {
      console.error(
        `[confirmar-control] cliente ${customer_id}: o UPDATE respondeu erro (${error.message}) e a releitura também falhou — não dá para dizer se a baixa ficou`,
      );
      return { ok: false, motivo: 'confirmacao_incerta', detalhe: error.message };
    }
    // O UPDATE é uma instrução só: marcou todas as pendentes dos ids, ou nenhuma.
    // Sem nenhuma com o carimbo desta e com pendente sobrando, não gravou.
    if (ficou.marcadasPorEsta.length === 0 && ficou.aindaPendentes.length > 0) {
      return { ok: false, motivo: 'erro', detalhe: error.message };
    }
    console.error(
      `[confirmar-control] cliente ${customer_id}: o UPDATE respondeu erro (${error.message}), mas a releitura mostra a baixa — ${ficou.marcadasPorEsta.length} marcada(s)`,
    );
    confirmadas = ficou.marcadasPorEsta;
  } else {
    confirmadas = (Array.isArray(data) ? (data as Array<{ id: string }>) : []).map((l) => l.id);
  }

  const alteracoes = await lerAlteracoesDoCliente(company_id, customer_id);
  return { ok: true, confirmadas, alteracoes };
}

// ─── Para a API de Parceiro (lote) ───────────────────────────────────────────

/**
 * As edições PENDENTES por cliente, em lote — para a API de Parceiro, que
 * nunca lê cliente a cliente.
 *
 * - `customer_ids` ausente: todas as pendentes da empresa (a fila é pequena;
 *   é o caminho para o GET de milhares de clientes). Presente: só as desses
 *   clientes, em lotes de ids, cada lote paginado.
 * - Cada lista vem da edição mais ANTIGA para a mais nova.
 * - `null` = a 051 não existe neste banco: quem chama segue como antes dela.
 * - LANÇA quando o banco não responde (sobre o schema ou numa página): a rota
 *   do parceiro vira 500 e o Control tenta de novo. Uma lista pela metade seria
 *   lida como "não há edição pendente" — e a edição do app seria sobrescrita.
 */
export async function lerAlteracoesPendentesEmLote(
  company_id: string,
  customer_ids?: readonly string[],
): Promise<Map<string, AlteracaoDoCliente[]> | null> {
  if (!(await detectarOuFalhar('customer_changes', 'id'))) return null;

  const consulta = (lote: string[] | null) => (de: number, ate: number) => {
    let q = supabase
      .from('customer_changes')
      .select(COLUNAS_DA_ALTERACAO)
      .eq('company_id', company_id)
      .eq('erp_pendente', true)
      .is('erp_atualizado_em', null);
    if (lote) q = q.in('customer_id', lote);
    return q.order('alterado_em', { ascending: true }).order('id', { ascending: true }).range(de, ate);
  };

  const linhas: Array<Record<string, unknown>> = [];
  if (customer_ids === undefined) {
    linhas.push(...(await buscarTudoOuFalhar<Record<string, unknown>>(consulta(null))));
  } else {
    for (const lote of emLotes([...new Set(customer_ids)])) {
      linhas.push(...(await buscarTudoOuFalhar<Record<string, unknown>>(consulta(lote))));
    }
  }

  const porCliente = new Map<string, AlteracaoDoCliente[]>();
  for (const l of linhas) {
    const a = paraAlteracao(l);
    porCliente.set(a.customer_id, [...(porCliente.get(a.customer_id) ?? []), a]);
  }
  for (const lista of porCliente.values()) {
    lista.sort((a, b) => a.alterado_em.localeCompare(b.alterado_em) || a.id.localeCompare(b.id));
  }
  return porCliente;
}

/**
 * As edições que NÃO estão na fila do Control — já resolvidas, ou que nunca
 * precisaram ir (cliente sem código na hora) —, por cliente, em lote, da mais
 * antiga para a mais nova (revisão de 17/09/2026).
 *
 * A API de Parceiro precisa delas em dois casos, e só para os clientes deles
 * (poucos por lote; nunca a empresa inteira):
 *   • cliente com edição pendente: uma edição MAIS NOVA da mesma coluna, já
 *     resolvida, é o valor atual do app — o `depois` da pendente mais velha
 *     está vencido (ver `conferirEdicoesDoApp`);
 *   • cliente sem código adotado pelo CNPJ: a edição feita enquanto ele não
 *     tinha código pode não estar no Control (ver o 2b de `receberClientes`).
 *
 * Sem a 051 ou sem clientes: mapa vazio. LANÇA quando o banco não responde,
 * como a leitura das pendentes — é lida antes de qualquer gravação.
 */
export async function lerAlteracoesForaDaFilaEmLote(
  company_id: string,
  customer_ids: readonly string[],
): Promise<Map<string, AlteracaoDoCliente[]>> {
  const porCliente = new Map<string, AlteracaoDoCliente[]>();
  const unicos = [...new Set(customer_ids)];
  if (unicos.length === 0 || !(await detectarOuFalhar('customer_changes', 'id'))) return porCliente;

  for (const lote of emLotes(unicos)) {
    const linhas = await buscarTudoOuFalhar<Record<string, unknown>>((de, ate) =>
      supabase
        .from('customer_changes')
        .select(COLUNAS_DA_ALTERACAO)
        .eq('company_id', company_id)
        .in('customer_id', lote)
        // O complemento exato de "pendente", como na ficha.
        .or('erp_pendente.eq.false,erp_atualizado_em.not.is.null')
        .order('alterado_em', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate),
    );
    for (const l of linhas) {
      const a = paraAlteracao(l);
      porCliente.set(a.customer_id, [...(porCliente.get(a.customer_id) ?? []), a]);
    }
  }
  for (const lista of porCliente.values()) {
    lista.sort((a, b) => a.alterado_em.localeCompare(b.alterado_em) || a.id.localeCompare(b.id));
  }
  return porCliente;
}

/**
 * A edição feita quando o cliente ainda não tinha código, e que o Control — ao
 * adotar o cliente pelo CNPJ — mostrou não ter (revisão de 17/09/2026): passa
 * a esperar o Control como qualquer outra (`erp_pendente = true`).
 *
 * Só marca linhas desta empresa ainda fora da fila (sem pendência e sem baixa).
 * Devolve os ids marcados. LANÇA em erro do banco.
 */
export async function colocarNaFilaDoControl(company_id: string, ids: readonly string[]): Promise<string[]> {
  const unicos = [...new Set(ids)];
  const marcadas: string[] = [];
  for (const lote of emLotes(unicos, IDS_POR_LOTE)) {
    const { data, error } = await supabase
      .from('customer_changes')
      .update({ erp_pendente: true })
      .eq('company_id', company_id)
      .eq('erp_pendente', false)
      .is('erp_atualizado_em', null)
      .in('id', lote)
      .select('id');
    if (error) throw new Error(`Falha ao pôr na fila do Control as edições do cliente adotado: ${error.message}`);
    marcadas.push(...(Array.isArray(data) ? (data as Array<{ id: string }>) : []).map((l) => l.id));
  }
  return marcadas;
}

/**
 * As colunas do app com edição pendente (as chaves de `campos`: `name`,
 * `whatsapp`, as peças do endereço, `address`…). Só as alterações pendentes
 * contam.
 */
export function colunasPendentes(alteracoes: readonly AlteracaoDoCliente[]): Set<CampoDoHistoricoDoCadastro> {
  const colunas = new Set<CampoDoHistoricoDoCadastro>();
  for (const a of alteracoes) {
    if (!estaPendente(a)) continue;
    for (const c of Object.keys(a.campos)) colunas.add(c as CampoDoHistoricoDoCadastro);
  }
  return colunas;
}

/**
 * O `alterado_no_app` de um cliente no GET /partner/v1/clientes: a edição
 * pendente mais recente e os campos pendentes com os NOMES DO CONTRATO
 * (razao_social, cnpj_cpf, endereco…). `null` = nada pendente.
 */
export function alteradoNoApp(
  alteracoes: readonly AlteracaoDoCliente[] | undefined,
): { em: string; campos: NomeNoContratoDoParceiro[] } | null {
  const pendentes = (alteracoes ?? []).filter(estaPendente);
  if (pendentes.length === 0) return null;
  const em = pendentes.reduce((maior, a) => (a.alterado_em > maior ? a.alterado_em : maior), pendentes[0]!.alterado_em);
  return { em, campos: camposNoContratoDoParceiro(colunasPendentes(pendentes)) };
}

/**
 * Os ids das edições pendentes cujas colunas TODAS já chegaram ao Control.
 *
 * `colunasQueAlcancaram` usa os nomes das colunas do app (as chaves de
 * `campos`). O endereço é um grupo: quem confere o `endereco` do Control e vê
 * que bate deve pôr aqui as sete peças e `address`.
 */
export function alteracoesQueAlcancaram(
  alteracoes: readonly AlteracaoDoCliente[],
  colunasQueAlcancaram: ReadonlySet<string>,
): string[] {
  return alteracoes
    .filter((a) => estaPendente(a))
    .filter((a) => {
      const colunas = Object.keys(a.campos);
      return colunas.length > 0 && colunas.every((c) => colunasQueAlcancaram.has(c));
    })
    .map((a) => a.id);
}

/**
 * O Control devolveu pela API o mesmo valor que o app tem: as edições estão
 * resolvidas (`erp_atualizado_via = 'api'`, sem pessoa).
 *
 * Só marca linhas desta empresa que ainda estão pendentes — uma confirmação da
 * tela no meio do caminho não é sobrescrita. Devolve os ids marcados. LANÇA em
 * erro do banco (quem chama decide se isso derruba a resposta).
 */
export async function resolverAlteracoesPelaApi(company_id: string, ids: readonly string[]): Promise<string[]> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return [];
  const agora = new Date().toISOString();
  const marcadas: string[] = [];
  for (const lote of emLotes(unicos, IDS_POR_LOTE)) {
    const { data, error } = await supabase
      .from('customer_changes')
      .update({
        erp_atualizado_em: agora,
        erp_atualizado_por: null,
        erp_atualizado_por_nome: null,
        erp_atualizado_via: 'api',
      })
      .eq('company_id', company_id)
      .eq('erp_pendente', true)
      .is('erp_atualizado_em', null)
      .in('id', lote)
      .select('id');
    if (error) throw new Error(`Falha ao marcar as alterações do cadastro como atualizadas pelo Control: ${error.message}`);
    marcadas.push(...(Array.isArray(data) ? (data as Array<{ id: string }>) : []).map((l) => l.id));
  }
  return marcadas;
}

