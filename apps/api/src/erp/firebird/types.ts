/**
 * Tipos que espelham o schema real do Firebird ERP Corpo Sensual.
 * Nomes de campos em UPPER_CASE = nomes originais do Firebird.
 */

export interface ErpProduct {
  PRODUTO: string;       // Código do produto
  TAMANHO: string;       // Tamanho (ex: "P", "M", "G", "GG")
  DESCRICAO: string;
  ATIVO: string;         // 'S' | 'N'
  COLECAO: string | null;
  CATALOGO: string | null;
  MARCA: string | null;
  GRUPO_PRODUTO: string | null;
  GRADE_TAMANHO: string | null;
}

export interface ErpProductColor {
  PRODUTO: string;
  COR: string;           // Código da cor (CHAR 5)
  ATIVO: string;         // 'S' | 'N'
}

export interface ErpColor {
  COR: string;
  DESCRICAO: string | null;
  COR_HEXADECIMAL: string | null;
  CODIGO: string | null;
}

export interface ErpStock {
  PRODUTO: string;
  TAMANHO: string;
  COR: string;
  ESTOQUE_PRATELEIRA: number;   // Estoque disponível
  ESTOQUE_PEDIDO: number;       // Reservado em pedidos
  ESTOQUE_PRE_PRODUZIDO: number;
  CODIGO_BARRAS: string | null;
}

export interface ErpCustomer {
  CLIENTE: string;              // Código CHAR(5)
  RAZAO_SOCIAL: string | null;
  NOME_FANTASIA: string | null;
  CNPJ_CPF: string | null;
  REPRESENTANTE: string | null; // Código do representante
  TABELA_PRECO: string | null;  // Código da tabela de preço
  BLOQUEADO: string | null;     // 'S' | 'N'
  TEXTO_BLOQUEIO: string | null;
  LIMITE_CREDITO: number | null;
  WHATSAPP1: string | null;
  EMAIL: string | null;
  ATIVO: string | null;         // 'S' | 'N'
  DATA_UPDATE: Date | null;
}

export interface ErpPriceTable {
  TABELA_PRECO: string;         // Código CHAR(5)
  DESCRICAO: string | null;
  DESCRICAO_COLUNA1: string | null;
  DESCRICAO_COLUNA2: string | null;
  DESCRICAO_COLUNA3: string | null;
  DESCRICAO_COLUNA4: string | null;
  DESCRICAO_COLUNA5: string | null;
  DESCRICAO_COLUNA6: string | null;
  ATIVO: string | null;
}

export interface ErpProductPrice {
  TABELA_PRECO: string;
  PRODUTO: string;
  TAMANHO: string;
  PRECO1: number | null;
  PRECO2: number | null;
  PRECO3: number | null;
  PRECO4: number | null;
  PRECO5: number | null;
  PRECO6: number | null;
  PERC_DESCONTO: number | null;
  PRECO_ORIGINAL: number | null;
}

export interface ErpRepresentative {
  REPRESENTANTE: string;        // Código CHAR(5)
  NOME_REPRESENTANTE: string | null;
  RAZAO_SOCIAL: string | null;
  EMAIL: string | null;
  ATIVO: string | null;
  AUTENTICACAO_MOVEL: string | null; // Token/senha para app mobile
  DATA_UPDATE: Date | null;
}

export interface ErpOrder {
  PEDIDO: string;               // VARCHAR(10)
  CLIENTE: string | null;
  REPRESENTANTE: string | null;
  STATUS: string | null;        // Char(1): 'A'=aberto, 'B'=baixado, etc.
  SITUACAO: string | null;
  TABELA_PRECO: string | null;
  COLUNA_TABELA_PRECO: number | null;
  VALOR_PEDIDO: number | null;
  DATA_INCLUSAO: Date | null;
  DATA_UPDATE: Date | null;
  ATIVO: string | null;
}

export interface ErpOrderItem {
  PEDIDO: string;
  INCREMENTO: number;
  PRODUTO: string;
  TAMANHO: string;
  COR: string;
  QUANTIDADE: number | null;
  PRECO_UNITARIO: number | null;
  PRETO_TOTAL: number | null;
}
