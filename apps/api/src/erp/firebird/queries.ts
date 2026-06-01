/**
 * Queries SQL para o Firebird ERP Corpo Sensual.
 * Todas lêem do banco de produção (somente leitura).
 */

/**
 * Produtos ativos com suas variantes de cor e estoque.
 * Retorna uma linha por (PRODUTO × TAMANHO × COR).
 */
export const QUERY_PRODUCTS_WITH_STOCK = `
  SELECT
    p.PRODUTO,
    p.TAMANHO,
    TRIM(p.DESCRICAO)              AS DESCRICAO,
    p.ATIVO,
    TRIM(p.COLECAO)                AS COLECAO,
    TRIM(p.CATALOGO)               AS CATALOGO,
    TRIM(p.MARCA)                  AS MARCA,
    TRIM(p.GRUPO_PRODUTO)          AS GRUPO_PRODUTO,
    TRIM(p.GRADE_TAMANHO)          AS GRADE_TAMANHO,
    TRIM(pc.COR)                   AS COR,
    TRIM(c.DESCRICAO)              AS COR_DESCRICAO,
    TRIM(c.COR_HEXADECIMAL)        AS COR_HEXADECIMAL,
    COALESCE(e.ESTOQUE_PRATELEIRA, 0)    AS ESTOQUE_PRATELEIRA,
    COALESCE(e.ESTOQUE_PEDIDO, 0)        AS ESTOQUE_PEDIDO,
    COALESCE(e.ESTOQUE_PRE_PRODUZIDO, 0) AS ESTOQUE_PRE_PRODUZIDO,
    TRIM(e.CODIGO_BARRAS)          AS CODIGO_BARRAS
  FROM PRODUTO p
  JOIN PRODUTO_CORES pc
    ON pc.PRODUTO = p.PRODUTO
   AND pc.ATIVO   = 'S'
  LEFT JOIN COR c
    ON TRIM(c.COR) = TRIM(pc.COR)
  LEFT JOIN ESTOQUE_PRODUTO e
    ON e.PRODUTO  = p.PRODUTO
   AND e.TAMANHO  = p.TAMANHO
   AND TRIM(e.COR) = TRIM(pc.COR)
  WHERE p.ATIVO = 'S'
  ORDER BY p.PRODUTO, p.TAMANHO, pc.COR
`;

/**
 * Clientes ativos com tabela de preço e status de bloqueio.
 */
export const QUERY_CUSTOMERS = `
  SELECT
    TRIM(c.CLIENTE)          AS CLIENTE,
    TRIM(c.RAZAO_SOCIAL)     AS RAZAO_SOCIAL,
    TRIM(c.NOME_FANTASIA)    AS NOME_FANTASIA,
    TRIM(c.CNPJ_CPF)         AS CNPJ_CPF,
    TRIM(c.REPRESENTANTE)    AS REPRESENTANTE,
    TRIM(c.TABELA_PRECO)     AS TABELA_PRECO,
    c.BLOQUEADO,
    c.LIMITE_CREDITO,
    TRIM(c.WHATSAPP1)        AS WHATSAPP1,
    TRIM(c.EMAIL)            AS EMAIL,
    c.ATIVO,
    c.DATA_UPDATE
  FROM CLIENTE c
  WHERE c.ATIVO = 'S'
  ORDER BY c.RAZAO_SOCIAL
`;

/** Clientes atualizados após determinada data/hora (delta sync) */
export const QUERY_CUSTOMERS_SINCE = `
  SELECT
    TRIM(c.CLIENTE)          AS CLIENTE,
    TRIM(c.RAZAO_SOCIAL)     AS RAZAO_SOCIAL,
    TRIM(c.NOME_FANTASIA)    AS NOME_FANTASIA,
    TRIM(c.CNPJ_CPF)         AS CNPJ_CPF,
    TRIM(c.REPRESENTANTE)    AS REPRESENTANTE,
    TRIM(c.TABELA_PRECO)     AS TABELA_PRECO,
    c.BLOQUEADO,
    c.LIMITE_CREDITO,
    TRIM(c.WHATSAPP1)        AS WHATSAPP1,
    TRIM(c.EMAIL)            AS EMAIL,
    c.ATIVO,
    c.DATA_UPDATE
  FROM CLIENTE c
  WHERE c.DATA_UPDATE >= ?
  ORDER BY c.DATA_UPDATE
`;

/**
 * Tabelas de preço ativas.
 */
export const QUERY_PRICE_TABLES = `
  SELECT
    TRIM(tp.TABELA_PRECO)          AS TABELA_PRECO,
    TRIM(tp.DESCRICAO)             AS DESCRICAO,
    TRIM(tp.DESCRICAO_COLUNA1)     AS DESCRICAO_COLUNA1,
    TRIM(tp.DESCRICAO_COLUNA2)     AS DESCRICAO_COLUNA2,
    TRIM(tp.DESCRICAO_COLUNA3)     AS DESCRICAO_COLUNA3,
    TRIM(tp.DESCRICAO_COLUNA4)     AS DESCRICAO_COLUNA4,
    TRIM(tp.DESCRICAO_COLUNA5)     AS DESCRICAO_COLUNA5,
    TRIM(tp.DESCRICAO_COLUNA6)     AS DESCRICAO_COLUNA6,
    tp.ATIVO
  FROM TABELA_PRECO tp
  WHERE tp.ATIVO = 'S'
  ORDER BY tp.TABELA_PRECO
`;

/**
 * Preços por tabela.
 * Retorna PRECO1…PRECO6 — o consumidor escolhe a coluna correta.
 */
export const QUERY_PRODUCT_PRICES = `
  SELECT
    TRIM(itp.TABELA_PRECO)  AS TABELA_PRECO,
    TRIM(itp.PRODUTO)       AS PRODUTO,
    TRIM(itp.TAMANHO)       AS TAMANHO,
    itp.PRECO1,
    itp.PRECO2,
    itp.PRECO3,
    itp.PRECO4,
    itp.PRECO5,
    itp.PRECO6,
    itp.PERC_DESCONTO,
    itp.PRECO_ORIGINAL
  FROM ITENS_TABELA_PRECO itp
  JOIN TABELA_PRECO tp
    ON TRIM(tp.TABELA_PRECO) = TRIM(itp.TABELA_PRECO)
   AND tp.ATIVO = 'S'
  ORDER BY itp.TABELA_PRECO, itp.PRODUTO, itp.TAMANHO
`;

/**
 * Representantes ativos com credencial mobile.
 */
export const QUERY_REPRESENTATIVES = `
  SELECT
    TRIM(r.REPRESENTANTE)          AS REPRESENTANTE,
    TRIM(r.NOME_REPRESENTANTE)     AS NOME_REPRESENTANTE,
    TRIM(r.RAZAO_SOCIAL)           AS RAZAO_SOCIAL,
    TRIM(r.EMAIL)                  AS EMAIL,
    r.ATIVO,
    TRIM(r.AUTENTICACAO_MOVEL)     AS AUTENTICACAO_MOVEL,
    r.DATA_UPDATE
  FROM REPRESENTANTE r
  WHERE r.ATIVO = 'S'
  ORDER BY r.NOME_REPRESENTANTE
`;

/**
 * Estoque disponível = prateleira − reservado.
 * Usado para atualização incremental de estoque.
 */
export const QUERY_STOCK_SNAPSHOT = `
  SELECT
    TRIM(e.PRODUTO)        AS PRODUTO,
    TRIM(e.TAMANHO)        AS TAMANHO,
    TRIM(e.COR)            AS COR,
    COALESCE(e.ESTOQUE_PRATELEIRA, 0)    AS ESTOQUE_PRATELEIRA,
    COALESCE(e.ESTOQUE_PEDIDO, 0)        AS ESTOQUE_PEDIDO,
    COALESCE(e.ESTOQUE_PRE_PRODUZIDO, 0) AS ESTOQUE_PRE_PRODUZIDO,
    TRIM(e.CODIGO_BARRAS)  AS CODIGO_BARRAS
  FROM ESTOQUE_PRODUTO e
  JOIN PRODUTO p
    ON p.PRODUTO = e.PRODUTO
   AND p.TAMANHO = e.TAMANHO
   AND p.ATIVO   = 'S'
  ORDER BY e.PRODUTO, e.TAMANHO, e.COR
`;

/**
 * Seleciona o preço correto dado tabela + coluna.
 * Coluna 1 = PRECO1, 2 = PRECO2 … 6 = PRECO6.
 */
export function getPriceFromColumn(
  row: {
    PRECO1: number | null;
    PRECO2: number | null;
    PRECO3: number | null;
    PRECO4: number | null;
    PRECO5: number | null;
    PRECO6: number | null;
  },
  column: number = 1,
): number | null {
  const map: Record<number, number | null> = {
    1: row.PRECO1,
    2: row.PRECO2,
    3: row.PRECO3,
    4: row.PRECO4,
    5: row.PRECO5,
    6: row.PRECO6,
  };
  return map[column] ?? row.PRECO1;
}
