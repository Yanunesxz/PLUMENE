/**
 * Recebe o FATURAMENTO que o ERP do parceiro empurra.
 *
 * É a última mão da integração, e a mais importante para quem comprou: enquanto
 * o pedido não é faturado, ele é só uma intenção. O gerente aprovar significa
 * "pode ir para o ERP"; quem diz que virou negócio é a nota, porque é o
 * financeiro que corta item em falta e corrige preço antes de emitir.
 *
 * Por isso o `invoiced` é o que acende "Aprovado" para o lojista (ver
 * `constants/statusDoCliente.ts`) e o que conta como venda no painel.
 *
 * O ERP identifica o pedido pelo número DELE (`pedido_erp`, gravado em
 * `orders.erp_order_id` na confirmação da importação). Aceita também o nosso
 * `id`, para o caso de ele preferir devolver o que recebeu.
 *
 * Mesma política tolerante das outras mãos: recusa só o registro que não dá
 * para usar e devolve a lista do que foi ignorado e por quê.
 */
import { supabase } from '../../config/supabase.js';
import { registrarCompraDoCliente } from '../orders/orders.service.js';

export interface FaturamentoParceiro {
  /** Número do pedido no ERP — a chave preferida. */
  pedido_erp?: string | null;
  /** Nosso id, alternativa ao número do ERP. */
  id?: string | null;
  /** `false` cancela um faturamento informado antes. Ausente = true. */
  faturado?: boolean | null;
  /** ISO da emissão da nota. Ausente = agora. */
  faturado_em?: string | null;
  /**
   * O valor que a nota realmente fechou. Ausente = mantém o do pedido.
   * É normal ser MENOR que o pedido: o que faltou no estoque não é faturado.
   */
  valor_faturado?: number | null;
}

export interface ResultadoFaturamento {
  recebidos: number;
  atualizados: number;
  ignorados: Array<{ pedido: string; motivo: string }>;
}

/**
 * `orders.invoiced_total` vem da migração 027. Como o código sobe antes de
 * alguém rodar o SQL, mandar a coluna cedo demais faria o PostgREST recusar o
 * update INTEIRO — e o ERP receberia erro num faturamento que existe. Sem a
 * coluna, o valor corrigido é ignorado e o resto grava normalmente.
 */
let temColunaDoValor: boolean | null = null;

async function detectarColunaDoValor(): Promise<boolean> {
  if (temColunaDoValor !== null) return temColunaDoValor;
  const { error } = await supabase.from('orders').select('invoiced_total').limit(1);
  temColunaDoValor = !error;
  return temColunaDoValor;
}

export async function receberFaturamento(
  company_id: string,
  lista: FaturamentoParceiro[],
): Promise<ResultadoFaturamento> {
  const ignorados: ResultadoFaturamento['ignorados'] = [];
  let atualizados = 0;

  const comValor = await detectarColunaDoValor();

  for (const item of lista) {
    const pedidoErp = item.pedido_erp?.trim();
    const id = item.id?.trim();
    const referencia = pedidoErp || id || '(sem identificação)';

    if (!pedidoErp && !id) {
      ignorados.push({ pedido: referencia, motivo: 'informe "pedido_erp" ou "id"' });
      continue;
    }

    // Sempre dentro da empresa da chave: um parceiro nunca fatura pedido de
    // outra fábrica, mesmo acertando o número por acaso.
    let busca = supabase
      .from('orders')
      .select('id, invoiced, total, customer_id')
      .eq('company_id', company_id);
    busca = pedidoErp ? busca.eq('erp_order_id', pedidoErp) : busca.eq('id', id as string);

    const { data: pedido, error: erroBusca } = await busca.maybeSingle();
    if (erroBusca) {
      ignorados.push({ pedido: referencia, motivo: `falha ao buscar: ${erroBusca.message}` });
      continue;
    }
    if (!pedido) {
      ignorados.push({ pedido: referencia, motivo: 'pedido não encontrado nesta empresa' });
      continue;
    }

    const faturado = item.faturado !== false;

    if (item.faturado_em && Number.isNaN(Date.parse(item.faturado_em))) {
      ignorados.push({ pedido: referencia, motivo: '"faturado_em" não é uma data ISO' });
      continue;
    }

    if (item.valor_faturado != null && !(item.valor_faturado > 0)) {
      // Zero não é nota: cancelamento se diz com faturado: false.
      ignorados.push({ pedido: referencia, motivo: '"valor_faturado" precisa ser maior que zero' });
      continue;
    }

    const patch: Record<string, unknown> = {
      invoiced: faturado,
      invoiced_at: faturado ? (item.faturado_em ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    };
    if (comValor) {
      // Cancelou? O valor faturado some junto — deixá-lo para trás faria o
      // painel somar uma nota que não existe mais.
      patch['invoiced_total'] = faturado ? (item.valor_faturado ?? null) : null;
    }

    const { error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', pedido.id as string)
      .eq('company_id', company_id);

    if (error) {
      ignorados.push({ pedido: referencia, motivo: `falha ao gravar: ${error.message}` });
      continue;
    }
    atualizados += 1;

    // O faturamento do ERP também empurra a última compra do cliente — a
    // carteira do representante fica viva pelos dois caminhos.
    if (faturado) {
      await registrarCompraDoCliente(
        (pedido as { customer_id?: string | null }).customer_id,
        (patch['invoiced_at'] as string | null) ?? undefined,
      );
    }
  }

  return { recebidos: lista.length, atualizados, ignorados };
}
