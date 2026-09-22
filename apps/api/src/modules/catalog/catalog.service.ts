import { supabase } from '../../config/supabase.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';
import { buscarPorIds, buscarPorIdsOuFalhar, buscarTudo } from '../../lib/paginacao.js';
import type { CatalogColor, CatalogVariant, ProductWithPrice } from '@csb/shared';

/**
 * `price_tables.active` vem da migração 049: o Control desliga a tabela e ela
 * sai de toda ESCOLHA. Até o SQL rodar a coluna não existe — filtrar por ela
 * derrubaria a lista inteira, então sem a coluna a lista é a de hoje.
 *
 * O que NÃO usa este filtro, de propósito: conferir se a tabela é da empresa
 * (`priceTableBelongsToCompany`) e abrir o catálogo numa tabela. Cliente e
 * pedido que já estão numa tabela inativa continuam precificados por ela.
 */
export async function detectarTabelaAtiva(): Promise<boolean> {
  return detectar('price_tables', 'active');
}

/**
 * Tabelas de preço da empresa (id + nome) — para o seletor de consulta no
 * catálogo. Só as ativas no Control: consultar é escolher.
 */
export async function listCompanyPriceTables(
  company_id: string,
): Promise<{ id: string; name: string }[]> {
  const soAtivas = await detectarTabelaAtiva();

  let consulta = supabase.from('price_tables').select('id, name').eq('company_id', company_id);
  if (soAtivas) consulta = consulta.eq('active', true);
  const { data, error } = await consulta.order('name');

  if (error || !data) return [];
  return data as { id: string; name: string }[];
}

/**
 * A tabela pode ser atribuída AGORA por quem escolhe qualquer tabela da empresa
 * (gerente e admin)? Precisa ser da empresa e não estar desligada no Control.
 *
 * Diferente de `priceTableBelongsToCompany`, que só confere a empresa: aquela
 * serve para ler o catálogo numa tabela que alguém já usa, esta para uma
 * escolha nova. Sem a 049, é a mesma conferência de antes.
 */
export async function tabelaEscolhivelDaEmpresa(
  price_table_id: string,
  company_id: string,
): Promise<boolean> {
  const comAtiva = await detectarTabelaAtiva();
  const { data } = await supabase
    .from('price_tables')
    .select(comAtiva ? 'id, active' : 'id')
    .eq('id', price_table_id)
    .eq('company_id', company_id)
    .maybeSingle();

  const tabela = data as { id: string; active?: boolean | null } | null;
  return !!tabela && tabela.active !== false;
}

/** Garante que a tabela de preço pertence à empresa (evita consultar tabela de outra empresa). */
export async function priceTableBelongsToCompany(
  price_table_id: string,
  company_id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('price_tables')
    .select('id')
    .eq('id', price_table_id)
    .eq('company_id', company_id)
    .maybeSingle();
  return !!data;
}

/**
 * `product_prices.price_larger` vem da migração 026. Como o código sobe para a
 * Vercel/Railway antes de alguém rodar o SQL no Supabase, pedir a coluna cedo
 * demais derrubaria o catálogo inteiro — e catálogo vazio é o representante sem
 * poder vender. Enquanto a coluna não existe, o preço da faixa maior fica null e
 * todo mundo paga o preço normal, que é exatamente o comportamento de hoje.
 */
async function temFaixaMaior(): Promise<boolean> {
  return detectar('product_prices', 'price_larger');
}

export interface CatalogOptions {
  price_table_id?: string | undefined;
  /**
   * Envia a quantidade disponível por tamanho. Só gerente/admin: a posição de
   * estoque da fábrica não é informação do representante.
   */
  includeStock?: boolean;
  /**
   * Descarta o que não tem preço na tabela consultada. Ligado para o
   * representante: produto sem preço entrava no carrinho a R$ 0 e o pedido
   * inteiro era recusado no servidor com PRICE_NOT_FOUND.
   */
  onlyPriced?: boolean;
}

// Colunas que o app realmente usa. `select('*')` arrastava company_id,
// description e updated_at em 313 produtos — peso morto no 3G do representante.
//
// `erp_id` e `group_name` saíram na mesma linha de raciocínio: nenhuma tela lê
// os dois. Iam junto em todo produto, em toda abertura do catálogo, para nada.
const PRODUCT_COLUMNS =
  'id, sku, name, collection, brand, image_url, variant_group, color_name, color_hex, active';

export async function getProducts(
  company_id: string,
  options: CatalogOptions = {},
): Promise<ProductWithPrice[]> {
  const { price_table_id, includeStock = false, onlyPriced = false } = options;

  const products = await buscarTudo<Record<string, unknown>>((de, ate) =>
    supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('company_id', company_id)
      .eq('active', true)
      .order('name')
      .range(de, ate),
  );

  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id as string);

  // Variantes (tamanhos) de cada produto — a grade vem do ERP (adulto P/M/G…,
  // juvenil/infantil em números). Cores são sortidas, então é só (produto×tamanho).
  //
  // PAGINADO, e não é zelo à toa: são ~5 tamanhos para cada um dos 313 produtos,
  // ou seja ~1.500 linhas contra o teto de 1.000 do PostgREST. Numa consulta só,
  // um terço do catálogo voltava SEM grade — e produto sem grade não abre o
  // seletor de tamanho, então simplesmente não dava para vender. O corte é
  // silencioso: vem um array menor, sem erro nenhum.
  const variants = await buscarPorIds<{
    id: string;
    product_id: string;
    size: string;
    stock_quantity: number;
    stock_committed: number;
  }>(productIds, (lote, de, ate) =>
    supabase
      .from('product_variants')
      .select('id, product_id, size, stock_quantity, stock_committed')
      .in('product_id', lote)
      .eq('active', true)
      .range(de, ate),
  );

  const variantsByProduct = new Map<string, CatalogVariant[]>();
  for (const v of variants) {
    const pid = v.product_id;
    // O ERP às vezes devolve estoque negativo (baixa lançada antes da entrada).
    // Piso em zero: negativo não é "menos que esgotado", é esgotado.
    const available = Math.max(0, v.stock_quantity - v.stock_committed);
    const arr = variantsByProduct.get(pid) ?? [];
    arr.push({
      id: v.id,
      size: v.size,
      in_stock: available > 0,
      ...(includeStock ? { available } : {}),
    });
    variantsByProduct.set(pid, arr);
  }

  // Cores do catálogo impresso (migração 019). Paginado pelo mesmo motivo das
  // variantes: são ~3 cores para cada produto do catálogo.
  //
  // A migração pode não estar aplicada — sem a TABELA o catálogo segue sem
  // cor, em vez de abrir vazio; sem as colunas da 020, segue sem o par.
  //
  // Mas erro do banco na leitura SOBE (500) — não vira `colors: []`. Até
  // 22/09/2026 ele era engolido: o catálogo saía 200 sem as bolinhas, as telas
  // gravavam isso POR CIMA do cache bom (bulkPut) e a planilha do Control, que
  // lê as fichas desse cache, passava a mandar o NOME da cor no lugar do
  // número ("Cor 2") sem ninguém perceber. Com o 500, toda tela que baixa o
  // catálogo segue com o cache que já tem (todas têm o seu .catch).
  const coresPorProduto = new Map<string, CatalogColor[]>();
  type LinhaDeCor = {
    product_id: string;
    codigo: string;
    nome: string | null;
    hex: string | null;
    hex_par?: string | null;
    estampa?: boolean | null;
    variadas: boolean;
    ordem: number;
  };

  // A segunda bolinha e o marcador de estampa são da 020. Se ela ainda não
  // rodou, o PostgREST recusa as colunas — e aí é melhor mostrar a cor sem o
  // par do que sumir com a bolinha inteira. A pergunta é feita ANTES (a
  // sonda guarda o "sim" para sempre): com o erro engolido pela paginação, o
  // `.catch` que fazia esse papel nunca disparava.
  const COLUNAS = 'product_id, codigo, nome, hex, variadas, ordem';
  if (await detectarOuFalhar('product_colors', 'codigo')) {
    const com020 = await detectarOuFalhar('product_colors', 'hex_par');
    const cores = await buscarPorIdsOuFalhar<LinhaDeCor>(productIds, (lote, de, ate) =>
      supabase
        .from('product_colors')
        .select(com020 ? `${COLUNAS}, hex_par, estampa` : COLUNAS)
        .in('product_id', lote)
        .order('ordem')
        // (product_id, codigo) é único (019): o desempate que deixa a página
        // estável quando o lote passa das 1.000 linhas.
        .order('product_id')
        .order('codigo')
        .range(de, ate),
    );
    for (const c of cores) {
      const arr = coresPorProduto.get(c.product_id) ?? [];
      arr.push({
        codigo: c.codigo,
        nome: c.nome,
        hex: c.hex,
        hex_par: c.hex_par ?? null,
        estampa: Boolean(c.estampa),
        variadas: c.variadas,
      });
      coresPorProduto.set(c.product_id, arr);
    }
  }

  const priceMap = new Map<string, { price: number; price_larger: number | null }>();
  if (price_table_id) {
    const colunas = (await temFaixaMaior()) ? 'product_id, price, price_larger' : 'product_id, price';
    // Uma linha por produto nesta tabela, então hoje cabe folgado — mas paginado
    // pelo mesmo motivo: o dia em que o catálogo passar de 1.000 itens, o preço
    // sumiria em silêncio e metade do catálogo abriria vazia.
    const prices = await buscarPorIds<{
      product_id: string;
      price: number;
      price_larger?: number | null;
    }>(productIds, (lote, de, ate) =>
      supabase
        .from('product_prices')
        .select(colunas)
        .eq('price_table_id', price_table_id)
        .in('product_id', lote)
        .range(de, ate),
    );
    for (const pp of prices) {
      priceMap.set(pp.product_id, { price: pp.price, price_larger: pp.price_larger ?? null });
    }
  }

  const withPrice = products.map((p) => {
    const preco = priceMap.get(p.id as string);
    return {
      ...p,
      price: preco?.price ?? null,
      price_larger: preco?.price_larger ?? null,
      variants: variantsByProduct.get(p.id as string) ?? [],
      colors: coresPorProduto.get(p.id as string) ?? [],
    };
  }) as ProductWithPrice[];

  return onlyPriced ? withPrice.filter((p) => p.price != null) : withPrice;
}
