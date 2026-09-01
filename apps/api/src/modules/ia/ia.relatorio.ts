/**
 * Prepara os dados da carteira para o relatório de IA — só texto, sem rede.
 *
 * Separado do serviço de propósito: tudo aqui é função pura, então o teste
 * cobre a parte que decide O QUE a IA vê (ordenação, cortes, agregados) sem
 * depender da API da Anthropic. A régua de dias espelha a do app
 * (apps/web/src/lib/carteira.ts): esfriando aos 90, parado aos 180.
 */

export interface ClienteParaRelatorio {
  name: string;
  trade_name?: string | null;
  last_purchase_at?: string | null;
  total_purchased?: number | null;
  overdue_amount?: number | null;
  rep_erp_id?: string | null;
}

const ESFRIANDO_APOS_DIAS = 90;
const PARADO_APOS_DIAS = 180;

/** Quantos clientes entram LISTADOS no prompt — acima disso vira uma linha de
 *  resumo. Segura o custo e a latência mesmo numa carteira gigante. */
export const MAXIMO_DE_LINHAS = 300;

export function diasDesde(iso: string | null | undefined, hoje = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((hoje.getTime() - d.getTime()) / 86_400_000));
}

const reais = (v: number) => `R$ ${Math.round(v)}`;
const dataBr = (iso: string) => {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
};

export interface ResumoDaCarteira {
  total: number;
  parados: number;
  esfriando: number;
  ativos: number;
  semRegistro: number;
  vencidoTotal: number;
}

export function resumirCarteira(clientes: ClienteParaRelatorio[], hoje = new Date()): ResumoDaCarteira {
  const r: ResumoDaCarteira = { total: clientes.length, parados: 0, esfriando: 0, ativos: 0, semRegistro: 0, vencidoTotal: 0 };
  for (const c of clientes) {
    const dias = diasDesde(c.last_purchase_at, hoje);
    if (dias === null) r.semRegistro++;
    else if (dias >= PARADO_APOS_DIAS) r.parados++;
    else if (dias >= ESFRIANDO_APOS_DIAS) r.esfriando++;
    else r.ativos++;
    r.vencidoTotal += c.overdue_amount ?? 0;
  }
  return r;
}

/**
 * Uma linha compacta por cliente, do mais parado para o mais recente — quem
 * está há mais tempo sem comprar é quem o relatório precisa enxergar primeiro,
 * e é quem sobrevive ao corte de MAXIMO_DE_LINHAS.
 */
export function linhasDaCarteira(clientes: ClienteParaRelatorio[], hoje = new Date()): string[] {
  const comDias = clientes.map((c) => ({ c, dias: diasDesde(c.last_purchase_at, hoje) }));
  comDias.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));

  const linhas = comDias.slice(0, MAXIMO_DE_LINHAS).map(({ c, dias }) => {
    const nome = c.trade_name?.trim() || c.name;
    const partes = [nome];
    partes.push(
      dias === null || !c.last_purchase_at
        ? 'sem registro de compra'
        : `ultima compra ${dataBr(c.last_purchase_at)} (ha ${dias} dias)`,
    );
    if (c.total_purchased) partes.push(`ja comprou ${reais(c.total_purchased)}`);
    if (c.overdue_amount) partes.push(`vencido ${reais(c.overdue_amount)}`);
    return partes.join(' | ');
  });

  const fora = clientes.length - linhas.length;
  if (fora > 0) linhas.push(`(+ ${fora} clientes mais recentes, fora da lista por espaco)`);
  return linhas;
}

/**
 * Visão do escritório: a empresa inteira não cabe (nem precisa) linha a linha.
 * Vira um agregado por representante + os piores parados com o nome do rep.
 */
export function linhasDaEmpresa(
  clientes: ClienteParaRelatorio[],
  nomeDoRep: Map<string, string>,
  hoje = new Date(),
): string[] {
  const porRep = new Map<string, ClienteParaRelatorio[]>();
  for (const c of clientes) {
    const chave = c.rep_erp_id ?? 'sem_rep';
    const lista = porRep.get(chave) ?? [];
    lista.push(c);
    porRep.set(chave, lista);
  }

  const linhas: string[] = [];
  for (const [codigo, lista] of porRep) {
    const r = resumirCarteira(lista, hoje);
    const nome = codigo === 'sem_rep' ? 'SEM REPRESENTANTE' : (nomeDoRep.get(codigo) ?? `rep ${codigo}`);
    linhas.push(
      `${nome}: ${r.total} clientes | ${r.parados} parados | ${r.esfriando} esfriando | ${r.ativos} ativos` +
        (r.vencidoTotal ? ` | vencido ${reais(r.vencidoTotal)}` : ''),
    );
  }
  linhas.sort();

  const piores = clientes
    .map((c) => ({ c, dias: diasDesde(c.last_purchase_at, hoje) }))
    .filter((x): x is { c: ClienteParaRelatorio; dias: number } => x.dias !== null && x.dias >= PARADO_APOS_DIAS)
    .sort((a, b) => b.dias - a.dias)
    .slice(0, 40);
  if (piores.length > 0) {
    linhas.push('', 'Clientes parados ha mais tempo:');
    for (const { c, dias } of piores) {
      const rep = c.rep_erp_id ? (nomeDoRep.get(c.rep_erp_id) ?? `rep ${c.rep_erp_id}`) : 'sem representante';
      linhas.push(
        `${c.trade_name?.trim() || c.name} (${rep}) | ha ${dias} dias` +
          (c.total_purchased ? ` | ja comprou ${reais(c.total_purchased)}` : '') +
          (c.overdue_amount ? ` | vencido ${reais(c.overdue_amount)}` : ''),
      );
    }
  }
  return linhas;
}

export function instrucoesDoRelatorio(marca: string): string {
  return (
    `Voce e o assistente comercial da forca de vendas da ${marca} (moda intima, venda B2B para lojas). ` +
    'Escreva um relatorio CURTO da carteira de clientes, em portugues do Brasil, texto puro (sem markdown, sem titulos com #). ' +
    'Estrutura: um paragrafo de visao geral com os numeros que importam; depois a linha "Quem procurar primeiro:" ' +
    'seguida de ate 8 clientes, um por linha comecando com "- ", cada um com o motivo em poucas palavras; ' +
    'feche com uma frase de proximo passo. ' +
    'Use SOMENTE os dados fornecidos — nunca invente valores, datas ou nomes. Se um dado nao existe, nao o cite. ' +
    'Datas no formato dd/mm/aaaa. Cliente "vencido" tem titulo em atraso: mencione com cuidado, sem tom de cobranca ao lojista.'
  );
}

/**
 * O relatório que o PRÓPRIO APP escreve — sem IA, sem chave, sem custo.
 *
 * É o motor padrão: a conta (quem parou, quanto comprava, quanto venceu) é
 * toda nossa, e texto com número certo vale mais que prosa. A IA é opcional
 * por cima, nunca requisito. Prioridade de visita: entre os parados, quem
 * mais COMPRAVA vem primeiro — cliente grande parado é a venda mais barata
 * de recuperar; o desempate é o tempo parado.
 */
const brl = (v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;

function tempoParado(dias: number): string {
  if (dias < 60) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return `há ${meses} meses`;
}

function quemProcurarPrimeiro(clientes: ClienteParaRelatorio[], hoje: Date): string[] {
  const candidatos = clientes
    .map((c) => ({ c, dias: diasDesde(c.last_purchase_at, hoje) }))
    .filter((x): x is { c: ClienteParaRelatorio; dias: number } => x.dias !== null && x.dias >= ESFRIANDO_APOS_DIAS)
    .sort((a, b) => {
      const grupoA = a.dias >= PARADO_APOS_DIAS ? 0 : 1;
      const grupoB = b.dias >= PARADO_APOS_DIAS ? 0 : 1;
      if (grupoA !== grupoB) return grupoA - grupoB;
      const compraA = a.c.total_purchased ?? 0;
      const compraB = b.c.total_purchased ?? 0;
      if (compraA !== compraB) return compraB - compraA;
      return b.dias - a.dias;
    })
    .slice(0, 8);

  return candidatos.map(({ c, dias }) => {
    const partes = [
      `- ${c.trade_name?.trim() || c.name} — ${dias >= PARADO_APOS_DIAS ? 'parado' : 'esfriando'} ${tempoParado(dias)}`,
    ];
    if (c.total_purchased) partes.push(`já comprou ${brl(c.total_purchased)}`);
    if (c.overdue_amount) partes.push(`vencido ${brl(c.overdue_amount)}`);
    return partes.join(', ');
  });
}

export function relatorioLocal(
  clientes: ClienteParaRelatorio[],
  opcoes: { alcance: 'minha carteira' | 'empresa inteira'; nomeDoRep?: Map<string, string> },
  hoje = new Date(),
): string {
  const r = resumirCarteira(clientes, hoje);
  const blocos: string[] = [];

  const dona = opcoes.alcance === 'empresa inteira' ? 'A empresa tem' : 'Sua carteira tem';
  blocos.push(
    `${dona} ${r.total} clientes: ${r.parados} parados (6+ meses sem comprar), ` +
      `${r.esfriando} esfriando (3–6 meses), ${r.ativos} ativos e ${r.semRegistro} sem registro de compra.` +
      (r.vencidoTotal > 0 ? ` Há ${brl(r.vencidoTotal)} vencidos.` : ''),
  );

  if (opcoes.alcance === 'empresa inteira') {
    const porRep = new Map<string, ClienteParaRelatorio[]>();
    for (const c of clientes) {
      const chave = c.rep_erp_id ?? 'sem_rep';
      porRep.set(chave, [...(porRep.get(chave) ?? []), c]);
    }
    const linhas = [...porRep.entries()]
      .map(([codigo, lista]) => {
        const rr = resumirCarteira(lista, hoje);
        const nome =
          codigo === 'sem_rep' ? 'Sem representante' : (opcoes.nomeDoRep?.get(codigo) ?? `Rep ${codigo}`);
        return { nome, rr };
      })
      .filter((x) => x.rr.parados > 0)
      .sort((a, b) => b.rr.parados - a.rr.parados)
      .slice(0, 8)
      .map(
        ({ nome, rr }) =>
          `- ${nome}: ${rr.parados} parados de ${rr.total}` +
          (rr.vencidoTotal > 0 ? `, ${brl(rr.vencidoTotal)} vencidos` : ''),
      );
    if (linhas.length > 0) blocos.push(`Carteiras com mais clientes parados:\n${linhas.join('\n')}`);
  }

  const prioridade = quemProcurarPrimeiro(clientes, hoje);
  if (prioridade.length > 0) {
    blocos.push(`Quem procurar primeiro:\n${prioridade.join('\n')}`);
    blocos.push(
      'Próximo passo: comece pelos parados que mais compravam — recuperar cliente antigo é a venda mais barata que existe.',
    );
  } else {
    blocos.push(
      r.semRegistro === r.total
        ? 'Ainda não há registro de compra nesta carteira — os selos acendem quando o histórico for carregado.'
        : 'Nenhum cliente parado ou esfriando — carteira em dia.',
    );
  }

  return blocos.join('\n\n');
}

/**
 * Qual motor pensa o relatório: a chave presente decide. Com as duas, a
 * preferência (IA_PROVEDOR) desempata; sem preferência, Claude primeiro.
 * Sem chave NENHUMA não é erro — o app escreve o relatório sozinho (motor
 * 'app', custo zero). A assinatura do ChatGPT (chatgpt.com) NÃO serve aqui.
 */
export function escolherProvedor(chaves: {
  anthropic: string;
  openai: string;
  preferencia?: string;
}): 'anthropic' | 'openai' | null {
  if (chaves.preferencia === 'openai' && chaves.openai) return 'openai';
  if (chaves.anthropic) return 'anthropic';
  if (chaves.openai) return 'openai';
  return null;
}

export function montarPedido(escopo: 'minha carteira' | 'empresa inteira', resumo: ResumoDaCarteira, linhas: string[]): string {
  return (
    `Faca o relatorio simples da ${escopo}.\n\n` +
    `Resumo: ${resumo.total} clientes | ${resumo.parados} parados (180+ dias sem comprar) | ` +
    `${resumo.esfriando} esfriando (90-180 dias) | ${resumo.ativos} ativos | ` +
    `${resumo.semRegistro} sem registro de compra | vencido total ${reais(resumo.vencidoTotal)}\n\n` +
    `Dados:\n${linhas.join('\n')}`
  );
}
