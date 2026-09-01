import type { TarefaDoRep } from '@csb/shared';

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

  const chegaramRecentes = e.chegaram
    .map((c) => ({ ...c, dias: diasDesde(c.criadoEm, e.agora) }))
    .filter((c) => c.dias <= 3)
    .sort((a, b) => a.dias - b.dias);
  for (const c of chegaramRecentes) {
    alertas.push({
      id: `chegou-${c.id}`,
      nivel: 'normal',
      titulo: `${nomeDoPedido(c.numero)} chegou para sua triagem`,
      detalhe:
        c.dias === 0 ? 'Chegou hoje. Confira e mande para a fábrica.' : `Chegou há ${c.dias} dia(s).`,
      acao: { rotulo: 'Abrir o pedido', tipo: 'ir', para: `/orders/${c.id}` },
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
