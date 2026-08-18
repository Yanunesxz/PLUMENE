import type { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../config/supabase.js';
import { getProducts, listCompanyPriceTables, priceTableBelongsToCompany } from './catalog.service.js';
import { repPodeUsarTabela } from '../reps/reps.service.js';

/**
 * Resolve a tabela de preço da loja.
 *
 * Primeiro a do próprio cliente; se ele não tiver, a do representante dono.
 * A queda não é detalhe: 809 dos 1.353 clientes estão sem tabela — sem ela, a
 * maioria das lojas abriria o catálogo vazio.
 */
export async function tabelaDaLoja(
  customer_id: string,
  rep_id: string | null | undefined,
): Promise<string | undefined> {
  const { data: cliente } = await supabase
    .from('customers')
    .select('price_table_id')
    .eq('id', customer_id)
    .maybeSingle();

  const daLoja = (cliente as { price_table_id: string | null } | null)?.price_table_id;
  if (daLoja) return daLoja;

  if (!rep_id) return undefined;
  const { data: rep } = await supabase
    .from('users')
    .select('price_table_id')
    .eq('id', rep_id)
    .maybeSingle();

  return (rep as { price_table_id: string | null } | null)?.price_table_id ?? undefined;
}

export async function listProducts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, price_table_id: doToken, customer_id, rep_id } = request.user;
  const { price_table_id } = request.query as { price_table_id?: string };

  // Consultar o catálogo em OUTRA tabela é atribuição de gerente/admin — e do
  // representante DENTRO do conjunto dele. Ele precisa disso porque o pedido é
  // precificado pela tabela do cliente: sem poder abrir o catálogo nela, leria
  // um preço na tela e receberia outro no total. Fora do conjunto continua 403,
  // senão bastava o query param para ver o catálogo em qualquer tabela.
  // O financeiro entra na régua da fábrica: sem tabela própria no token, a
  // régua de comprador (onlyPriced) devolvia catálogo VAZIO — e sem catálogo no
  // aparelho o pedido mostrava "Produto" genérico e a planilha saía com "fora
  // do catálogo baixado" em todo item.
  const canChooseTable = role === 'manager' || role === 'admin' || role === 'financeiro';
  if (price_table_id && !canChooseTable) {
    const permitida = role === 'rep' && (await repPodeUsarTabela(company_id, sub, price_table_id));
    if (!permitida) {
      await reply.status(403).send({
        error: 'Somente gerente ou admin pode consultar outra tabela de preço',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      return;
    }
  }

  let tableId = doToken ?? undefined;
  if (role === 'store' && customer_id) {
    tableId = await tabelaDaLoja(customer_id, rep_id);
  }
  if (price_table_id && (await priceTableBelongsToCompany(price_table_id, company_id))) {
    tableId = price_table_id;
  }

  const products = await getProducts(company_id, {
    price_table_id: tableId,
    // Estoque da fábrica é informação de gerente. Representante, loja e
    // visitante recebem só "tem" ou "não tem" por tamanho.
    includeStock: canChooseTable,
    // Para quem compra, produto sem preço na tabela dele não é catálogo — é um
    // beco sem saída (entra no carrinho a R$ 0 e derruba o pedido inteiro).
    onlyPriced: !canChooseTable,
  });

  await reply.send({ data: products });
}

/** Tabelas de preço da empresa para o seletor de consulta (gerente/admin). */
export async function listCatalogPriceTables(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const tables = await listCompanyPriceTables(company_id);
  await reply.send({ data: tables });
}
