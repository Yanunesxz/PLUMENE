import type { TarefaDoRep } from '@csb/shared';
import { formatBRL } from './utils.js';

/**
 * Os ALERTAS do representante — o que está pendente, em três degraus.
 *
 * Regra combinada com o Yan (31/08/2026):
 *
 *   URGENTE  → visita HOJE (ou atrasada) e atualização do app esperando.
 *              O número no menu NÃO some ao ver — só quando a pessoa resolve.
 *   ATENÇÃO  → avisos do celular desligados; rascunho parado há 7+ dias.
 *   NORMAL   → app fora da tela inicial; visita marcada para 14+ dias;
 *              pedido que chegou nos últimos dias para a triagem.
 *              Atenção e normal saem do número assim que a pessoa VÊ a tela.
 *
 * Este arquivo é a regra PURA (entra estado, sai lista) — quem junta os
 * pedaços do app é o hook `useAlertas`, e é assim que a regra é testável.
 */

export type NivelDoAlerta = 'urgente' | 'atencao' | 'normal';

export interface AcaoDoAlerta {
  rotulo: string;
  /** O que o botão faz — a tela de Alertas resolve cada tipo. */
  tipo: 'atualizar' | 'ativar_avisos' | 'instalar' | 'ir';
  /** Rota interna, para o tipo 'ir'. */
  para?: string;
}

export interface Alerta {
  /** Estável: o "já vi" é guardado por id neste aparelho. */
  id: string;
  nivel: NivelDoAlerta;
  titulo: string;
  detalhe: string;
  acao?: AcaoDoAlerta;
}

export interface EntradasDosAlertas {
  /** Estado da atualização do app (useAtualizacao). */
  atualizacao: 'atual' | 'procurando' | 'disponivel';
  /** Estado dos avisos push neste aparelho (useAvisosNoCelular). */
  avisos: 'carregando' | 'indisponivel' | 'inativo' | 'ativo' | 'negado';
  /** Estado da instalação na tela inicial (useInstalarApp). */
  instalacao: 'instalado' | 'pronto' | 'manual-apple' | 'manual-firefox' | 'manual';
  /** Rascunhos do representante: id, número e a última mexida. */
  rascunhos: Array<{ id: string; numero: number | null; atualizadoEm: string }>;
  /** Pedidos parados na triagem dele (pending_rep): id, número e chegada. */
  chegaram: Array<{ id: string; numero: number | null; criadoEm: string }>;
  /** Pedidos faturados: a notícia boa que vale repassar à loja. */
  faturados: Array<{ id: string; numero: number | null; faturadoEm: string }>;
  /** A fila offline DESTE aparelho: pedidos feitos sem internet, ainda não enviados. */
  filaOffline: Array<{ criadoEm: string }>;
  /** Links temporários (vitrines) do representante. */
  vitrines: Array<{ id: string; clienteNome: string | null; expiraEm: string; status: string }>;
  /** Convites de conta de loja do representante. */
  convites: Array<{ id: string; clienteNome: string; expiraEm: string; status: string }>;
  /** A carteira: quem está a poucos dias de virar inativo (180 sem comprar). */
  clientes: Array<{ id: string; nome: string; ultimaCompraEm: string | null }>;
  /** A régua da meta do mês. Nulo = sem faixas cadastradas, sem alerta. */
  meta: { enviado: number; faixas: Array<{ meta: number; bonus: number }> } | null;
  /** As tarefas/visitas que o escritório marcou para ele. */
  tarefas: TarefaDoRep[];
  agora: Date;
}

const DIA = 86_400_000;

function diasDesde(iso: string, agora: Date): number {
  return Math.floor((agora.getTime() - new Date(iso).getTime()) / DIA);
}

/** Mesmo dia de calendário — visita "hoje" é isso, não "nas próximas 24h". */
function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function nomeDoPedido(numero: number | null): string {
  return numero ? `Pedido #${numero}` : 'Pedido';
}

function nomeDaVisita(t: TarefaDoRep): string {
  return t.cliente_nome?.trim() || t.titulo;
}

export function montarAlertas(e: EntradasDosAlertas): Alerta[] {
  const alertas: Alerta[] = [];

  // ── URGENTES ──────────────────────────────────────────────────────────────
  if (e.atualizacao === 'disponivel') {
    alertas.push({
      id: 'atualizar',
      nivel: 'urgente',
      titulo: 'Atualização pronta',
      detalhe: 'Tem versão nova do app esperando. Atualize para não ficar para trás.',
      acao: { rotulo: 'Atualizar agora', tipo: 'atualizar' },
    });
  }

  // Pedido feito sem internet que ainda não subiu: o rep ACHA que enviou.
  // Menos de 1h é normal (acabou de fazer, vai subir sozinho ao conectar);
  // mais que isso é urgência — um alerta só, com a contagem.
  const presos = e.filaOffline.filter((i) => e.agora.getTime() - new Date(i.criadoEm).getTime() >= 3600_000);
  if (presos.length > 0) {
    alertas.push({
      id: 'fila-offline',
      nivel: 'urgente',
      titulo:
        presos.length === 1
          ? '1 pedido preso neste aparelho'
          : `${presos.length} pedidos presos neste aparelho`,
      detalhe: 'Feito offline e ainda não enviado — conecte na internet para ele subir.',
      acao: { rotulo: 'Ver a sincronização', tipo: 'ir', para: '/minha-area' },
    });
  }

  // A loja mandou e está ESPERANDO a decisão dele há 2+ dias.
  const triagemParada = e.chegaram
    .map((c) => ({ ...c, dias: diasDesde(c.criadoEm, e.agora) }))
    .filter((c) => c.dias >= 2)
    .sort((a, b) => b.dias - a.dias);
  for (const c of triagemParada) {
    alertas.push({
      id: `triagem-${c.id}`,
      nivel: 'urgente',
      titulo: `${nomeDoPedido(c.numero)} parado na sua triagem`,
      detalhe: `A loja mandou há ${c.dias} dias e está esperando você decidir.`,
      acao: { rotulo: 'Decidir agora', tipo: 'ir', para: `/orders/${c.id}` },
    });
  }

  const visitasAbertas = e.tarefas.filter((t) => t.status !== 'feita' && t.prazo);
  for (const t of visitasAbertas) {
    const prazo = new Date(t.prazo!);
    const atrasada = prazo.getTime() < e.agora.getTime() && !mesmoDia(prazo, e.agora);
    if (mesmoDia(prazo, e.agora) || atrasada) {
      const hora = prazo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      alertas.push({
        id: `visita-ja-${t.id}`,
        nivel: 'urgente',
        titulo: atrasada
          ? `Visita atrasada: ${nomeDaVisita(t)}`
          : `Visita HOJE: ${nomeDaVisita(t)}`,
        detalhe: [
          atrasada
            ? `Era para ${prazo.toLocaleDateString('pt-BR')}`
            : `Hoje às ${hora}`,
          t.local?.trim() ? `em ${t.local.trim()}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        acao: { rotulo: 'Ver a visita', tipo: 'ir', para: '/minha-area' },
      });
    }
  }

  // ── ATENÇÃO ───────────────────────────────────────────────────────────────
  // Visita AMANHÃ: hoje é urgência, amanhã é preparação.
  const amanha = new Date(e.agora.getTime() + DIA);
  for (const t of visitasAbertas) {
    const prazo = new Date(t.prazo!);
    if (mesmoDia(prazo, amanha)) {
      const hora = prazo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      alertas.push({
        id: `visita-amanha-${t.id}`,
        nivel: 'atencao',
        titulo: `Visita amanhã: ${nomeDaVisita(t)}`,
        detalhe: [`Amanhã às ${hora}`, t.local?.trim() ? `em ${t.local.trim()}` : null]
          .filter(Boolean)
          .join(' · '),
        acao: { rotulo: 'Ver a visita', tipo: 'ir', para: '/minha-area' },
      });
    }
  }

  // Cliente a até 3 dias de virar INATIVO (180 sem comprar): a última chance
  // de uma visita segurar. Quando vira (ou compra), o alerta sai sozinho.
  for (const c of e.clientes) {
    if (!c.ultimaCompraEm) continue;
    const semComprar = diasDesde(c.ultimaCompraEm, e.agora);
    const faltam = 180 - semComprar;
    if (faltam >= 1 && faltam <= 3) {
      alertas.push({
        id: `cliente-expira-${c.id}`,
        nivel: 'atencao',
        titulo: `${c.nome} vira inativo em ${faltam} dia${faltam === 1 ? '' : 's'}`,
        detalhe: `Sem compra há ${semComprar} dias — uma visita agora segura o cliente.`,
        acao: { rotulo: 'Abrir a ficha', tipo: 'ir', para: `/customers/${c.id}` },
      });
    }
  }

  // Link temporário que morre HOJE sem virar pedido: vale um lembrete à loja.
  for (const v of e.vitrines) {
    if (v.status !== 'ativo' || !mesmoDia(new Date(v.expiraEm), e.agora)) continue;
    const hora = new Date(v.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    alertas.push({
      id: `vitrine-hoje-${v.id}`,
      nivel: 'atencao',
      titulo: `Link da vitrine expira hoje${v.clienteNome ? `: ${v.clienteNome}` : ''}`,
      detalhe: `Morre às ${hora} sem pedido — manda um lembrete pra loja?`,
      acao: { rotulo: 'Ver o link', tipo: 'ir', para: '/acessos?aba=vitrine' },
    });
  }

  if (e.avisos === 'inativo') {
    alertas.push({
      id: 'ativar-avisos',
      nivel: 'atencao',
      titulo: 'Avisos do app desligados',
      detalhe: 'Sem eles você não fica sabendo na hora de pedido novo, aceite e faturamento.',
      acao: { rotulo: 'Ativar avisos', tipo: 'ativar_avisos' },
    });
  }

  const rascunhosParados = e.rascunhos
    .map((r) => ({ ...r, dias: diasDesde(r.atualizadoEm, e.agora) }))
    .filter((r) => r.dias >= 7)
    .sort((a, b) => b.dias - a.dias);
  for (const r of rascunhosParados) {
    alertas.push({
      id: `rascunho-${r.id}`,
      nivel: 'atencao',
      titulo: `${nomeDoPedido(r.numero)} parado no rascunho`,
      detalhe: `Sem mexida há ${r.dias} dias. Manda para a fábrica ou apaga.`,
      acao: { rotulo: 'Abrir o pedido', tipo: 'ir', para: `/orders/${r.id}` },
    });
  }

  // ── NORMAIS ───────────────────────────────────────────────────────────────
  if (e.instalacao !== 'instalado') {
    alertas.push({
      id: 'instalar',
      nivel: 'normal',
      titulo: 'Deixe o app na tela inicial',
      detalhe: 'Instalado, ele abre pelo ícone e o catálogo funciona sem internet.',
      acao:
        e.instalacao === 'pronto'
          ? { rotulo: 'Instalar agora', tipo: 'instalar' }
          : { rotulo: 'Ver como instalar', tipo: 'ir', para: '/minha-area' },
    });
  }

  for (const t of visitasAbertas) {
    const prazo = new Date(t.prazo!);
    const emDias = Math.floor((prazo.getTime() - e.agora.getTime()) / DIA);
    if (emDias >= 14) {
      alertas.push({
        id: `visita-longe-${t.id}`,
        nivel: 'normal',
        titulo: `Visita marcada: ${nomeDaVisita(t)}`,
        detalhe: `Para ${prazo.toLocaleDateString('pt-BR')} — daqui a ${emDias} dias.`,
        acao: { rotulo: 'Ver a visita', tipo: 'ir', para: '/minha-area' },
      });
    }
  }

  // Só o que chegou HOJE/ONTEM — com 2+ dias parado já subiu para urgente.
  const chegaramRecentes = e.chegaram
    .map((c) => ({ ...c, dias: diasDesde(c.criadoEm, e.agora) }))
    .filter((c) => c.dias <= 1)
    .sort((a, b) => a.dias - b.dias);
  for (const c of chegaramRecentes) {
    alertas.push({
      id: `chegou-${c.id}`,
      nivel: 'normal',
      titulo: `${nomeDoPedido(c.numero)} chegou para sua triagem`,
      detalhe:
        c.dias === 0 ? 'Chegou hoje. Confira e mande para a fábrica.' : 'Chegou ontem.',
      acao: { rotulo: 'Abrir o pedido', tipo: 'ir', para: `/orders/${c.id}` },
    });
  }

  // A notícia boa de ontem/hoje: pedido faturado — repassa pra loja.
  const faturadosRecentes = e.faturados
    .map((f) => ({ ...f, dias: diasDesde(f.faturadoEm, e.agora) }))
    .filter((f) => f.dias <= 1)
    .sort((a, b) => a.dias - b.dias);
  for (const f of faturadosRecentes) {
    alertas.push({
      id: `faturado-${f.id}`,
      nivel: 'normal',
      titulo: `${nomeDoPedido(f.numero)} foi faturado`,
      detalhe: 'A nota saiu — avisa a loja? O botão do WhatsApp está no pedido.',
      acao: { rotulo: 'Abrir o pedido', tipo: 'ir', para: `/orders/${f.id}` },
    });
  }

  // Convite de conta de loja que VENCEU sem a loja abrir (janela de 7 dias
  // para não ressuscitar convite arqueológico): gerar outro e reenviar.
  for (const c of e.convites) {
    if (c.status !== 'expirado') continue;
    const venceuHa = diasDesde(c.expiraEm, e.agora);
    if (venceuHa < 0 || venceuHa > 7) continue;
    alertas.push({
      id: `convite-venceu-${c.id}`,
      nivel: 'normal',
      titulo: `Convite de ${c.clienteNome} venceu sem ser aberto`,
      detalhe: 'A loja não abriu o link a tempo. Gere outro e reenvie.',
      acao: { rotulo: 'Gerar outro', tipo: 'ir', para: '/acessos' },
    });
  }

  // A régua da meta — aparece TODO DIA até ser vista (o id carrega a data:
  // visto hoje, volta amanhã com id novo). Na última semana do mês sobe
  // para atenção sozinha.
  if (e.meta && e.meta.faixas.length > 0) {
    const fimDoMes = new Date(e.agora.getFullYear(), e.agora.getMonth() + 1, 0);
    const diasParaFechar = Math.max(0, fimDoMes.getDate() - e.agora.getDate());
    const dia = `${e.agora.getFullYear()}-${String(e.agora.getMonth() + 1).padStart(2, '0')}-${String(e.agora.getDate()).padStart(2, '0')}`;
    const proxima = [...e.meta.faixas]
      .sort((a, b) => a.meta - b.meta)
      .find((f) => f.meta > e.meta!.enviado);
    alertas.push({
      id: `meta-${dia}`,
      nivel: proxima && diasParaFechar <= 7 ? 'atencao' : 'normal',
      titulo: proxima
        ? `Régua da meta: faltam ${formatBRL(proxima.meta - e.meta.enviado)}`
        : 'Meta do mês batida! 🎉',
      detalhe: proxima
        ? `Você enviou ${formatBRL(e.meta.enviado)} no mês. Próxima faixa: ${formatBRL(proxima.meta)} (bônus de ${formatBRL(proxima.bonus)}). O mês fecha em ${diasParaFechar} dia${diasParaFechar === 1 ? '' : 's'}.`
        : `${formatBRL(e.meta.enviado)} enviados — todas as faixas do mês alcançadas.`,
      acao: { rotulo: 'Ver a régua', tipo: 'ir', para: '/minha-area' },
    });
  }

  return alertas;
}

/**
 * O número do menu: urgentes SEMPRE contam (só somem quando a pessoa resolve
 * — a condição deixa de existir); atenção e normal saem do número quando a
 * tela de Alertas é aberta ("já vi").
 */
export function contarNaoVistos(alertas: Alerta[], vistos: ReadonlySet<string>): number {
  return alertas.filter((a) => a.nivel === 'urgente' || !vistos.has(a.id)).length;
}
