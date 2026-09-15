/**
 * Os avisos AUTOMÁTICOS do fluxo de pedidos — quem recebe o quê, em uma página.
 *
 * Cada função é chamada com `void` pelo controller depois que a operação deu
 * certo: o push é carona, nunca condição. Qualquer falha aqui morre no log —
 * um aviso que não saiu não pode custar um pedido que já foi salvo.
 *
 *   pedido chega da loja/vitrine  → o REPRESENTANTE dono (triagem)
 *   pedido vai para a fábrica     → a MESA (gerente, admin, financeiro)
 *   fábrica aceita ou recusa      → o REPRESENTANTE dono
 *   pedido faturado               → o REPRESENTANTE dono
 */
import { enviarParaUsuarios, enviarParaPapeis } from './push.service.js';

/** O que os avisos precisam saber de um pedido. */
interface PedidoParaAviso {
  id: string;
  order_number?: number | null;
  rep_id: string;
  guest_name?: string | null;
}

function nomeDoPedido(p: PedidoParaAviso): string {
  return p.order_number ? `Pedido #${p.order_number}` : 'Pedido novo';
}

function rota(p: PedidoParaAviso): string {
  return `/orders/${p.id}`;
}

function engolir(promessa: Promise<unknown>): void {
  promessa.catch((err) => console.error('[push] aviso não saiu:', err));
}

/** Chegou de fora (loja logada ou link da vitrine) — cai na triagem do rep. */
export function avisarTriagemDoRep(company_id: string, pedido: PedidoParaAviso): void {
  const quem = pedido.guest_name?.trim() ? `de ${pedido.guest_name.trim()}` : 'da sua loja';
  engolir(
    enviarParaUsuarios(company_id, [pedido.rep_id], {
      title: `${nomeDoPedido(pedido)} para sua triagem`,
      body: `Chegou um pedido ${quem}. Confira e mande para a fábrica.`,
      url: rota(pedido),
      tag: `pedido-${pedido.id}`,
    }),
  );
}

/**
 * Cliente novo cadastrado pelo app — chega pra quem INCLUI no Control (a
 * Larissa, financeiro; admin como válvula). É ela quem cadastra o cliente no
 * ERP e volta ao app pra atrelar o código (Yan, 10/09/2026: "tem que ter o
 * botão pra chegar pra Larissa"). Quem cadastrou não recebe o próprio aviso.
 */
export function avisarClienteNovoParaIncluir(
  company_id: string,
  cliente: { id: string; name: string },
  quemCadastrou: string,
): void {
  engolir(
    enviarParaPapeis(
      company_id,
      ['financeiro', 'admin'],
      {
        title: 'Cliente novo para incluir no Control',
        body: `${cliente.name} foi cadastrado pelo app. Inclua no Control e atrele o código.`,
        url: `/customers/${cliente.id}`,
        tag: `cliente-${cliente.id}`,
      },
      quemCadastrou,
    ),
  );
}

/**
 * Foi para a fábrica — quem DECIDE fica sabendo (menos quem enviou). O gerente
 * não recebe: o pedido não passa mais por ele (Yan, 02/09/2026); ele acompanha
 * pelo Painel quando quiser.
 */
export function avisarMesaParaAceite(
  company_id: string,
  pedido: PedidoParaAviso,
  quemEnviou: string,
): void {
  engolir(
    enviarParaPapeis(
      company_id,
      ['financeiro', 'admin'],
      {
        title: `${nomeDoPedido(pedido)} aguardando aceite`,
        body: 'Um pedido chegou para a fábrica. Toque para aprovar ou recusar.',
        url: rota(pedido),
        tag: `pedido-${pedido.id}`,
      },
      quemEnviou,
    ),
  );
}

/** A fábrica decidiu — o dono do pedido fica sabendo na hora. */
export function avisarDecisaoAoRep(
  company_id: string,
  pedido: PedidoParaAviso,
  aceito: boolean,
  quemDecidiu: string,
): void {
  // Venda interna aprova o próprio pedido: avisar a si mesma é ruído.
  if (pedido.rep_id === quemDecidiu) return;
  engolir(
    enviarParaUsuarios(company_id, [pedido.rep_id], {
      title: aceito
        ? `${nomeDoPedido(pedido)} aceito pela fábrica`
        : `${nomeDoPedido(pedido)} foi recusado`,
      body: aceito
        ? 'Agora é aguardar o faturamento.'
        : 'Abra o pedido para ver o que aconteceu.',
      url: rota(pedido),
      tag: `pedido-${pedido.id}`,
    }),
  );
}

/**
 * Pedido recusado também apita na MESA (Fabian): recusa não é fim de linha,
 * é conversa — alguém do escritório liga para o representante e resolve.
 * Pedido do Yan (31/08/2026).
 */
export function avisarMesaDaRecusa(
  company_id: string,
  pedido: PedidoParaAviso,
  quemRecusou: string,
): void {
  engolir(
    enviarParaPapeis(
      company_id,
      ['manager', 'admin'],
      {
        title: `${nomeDoPedido(pedido)} foi recusado`,
        body: 'Fale com o representante — pedido recusado precisa de um retorno.',
        url: rota(pedido),
        tag: `pedido-${pedido.id}`,
      },
      quemRecusou,
    ),
  );
}

/** A nota saiu — a notícia que o representante mais espera. */
export function avisarFaturadoAoRep(
  company_id: string,
  pedido: PedidoParaAviso,
  quemFaturou: string,
): void {
  if (pedido.rep_id === quemFaturou) return;
  engolir(
    enviarParaUsuarios(company_id, [pedido.rep_id], {
      title: `${nomeDoPedido(pedido)} faturado`,
      body: 'A nota saiu. Toque para ver o pedido.',
      url: rota(pedido),
      tag: `pedido-${pedido.id}`,
    }),
  );
}

/**
 * O pedido MUDOU depois de ir para o Control (046).
 *
 * A venda interna edita o próprio pedido até o carimbo de faturado, inclusive
 * depois de lançado. Quando ela mexe, o Control fica com a versão velha e a
 * nota sairia errada — então quem mexe no Control é avisado na hora, com o
 * número de lá no título para ela achar o pedido sem procurar.
 */
export async function avisarPedidoMudouNoErp(
  company_id: string,
  pedido: { id: string; order_number: number | null; erp_order_id: string | null },
  quemPediu: string,
  observacao?: string | null,
): Promise<number> {
  const noControl = pedido.erp_order_id ? ` (${pedido.erp_order_id} no Control)` : '';
  // ESPERA a entrega e devolve quantos aparelhos receberam: a tela não pode
  // dizer "a fábrica foi avisada" sem saber se o aviso chegou em alguém. Falha
  // de push vira zero — nunca derruba o registro do pedido de atualização.
  try {
    return await enviarParaPapeis(
      company_id,
      ['financeiro', 'admin'],
      {
        title: `Pedido #${pedido.order_number ?? ''} mudou depois de ir para o Control`,
        body: observacao?.trim()
          ? `${observacao.trim()} — atualize no Control${noControl}.`
          : `O pedido mudou${noControl}. Veja o que mudou e atualize no Control.`,
        url: `/orders/${pedido.id}`,
        tag: `erp-sync-${pedido.id}`,
      },
      quemPediu,
    );
  } catch (err) {
    console.error('[push] aviso de pedido mudou no ERP:', err);
    return 0;
  }
}
