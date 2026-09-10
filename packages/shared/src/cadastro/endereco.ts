/**
 * Endereço do jeito que o Control (ERP da fábrica) pede: estruturado.
 *
 * A tela "Clientes" do Control tem End. p/ Faturamento, Número, Complemento,
 * Bairro, Cidade, U.F. e CEP em campos separados. O app guardava tudo numa
 * linha de texto livre (migração 033); desde a 041 guarda os campos — e a
 * linha continua sendo montada daqui, porque a planilha oficial do Control
 * (célula C4) e a API do parceiro trabalham com o endereço em uma linha.
 */
import { apenasDigitos } from './documento.js';

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export type UF = (typeof UFS)[number];

export const ufValida = (v: string | null | undefined): v is UF =>
  (UFS as readonly string[]).includes((v ?? '').trim().toUpperCase());

/** 8 dígitos e não é "00000000" — o CEP dos Correios nunca é tudo igual. */
export const cepValido = (v: string | null | undefined): boolean => {
  const d = apenasDigitos(v);
  return d.length === 8 && !/^(\d)\1{7}$/.test(d);
};

/** "36000000" → "36000-000". Fora disso, devolve como veio. */
export function formatarCep(v: string | null | undefined): string {
  const d = apenasDigitos(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (v ?? '').trim();
}

export interface EnderecoEstruturado {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string | null | undefined;
  bairro: string;
  cidade: string;
  uf: string;
}

/**
 * A linha única do endereço — o MESMO formato que a API do parceiro monta
 * quando o ERP manda o cadastro ("Rua das Flores, 123 Sala 2 - Centro - Juiz
 * de Fora/MG - CEP 36000-000"). Um formato só, venha de onde vier.
 */
/** Os campos podem vir nulos (linha do banco) — a função só ignora o que falta. */
export type EnderecoParcial = { [K in keyof EnderecoEstruturado]?: string | null | undefined };

export function linhaDeEndereco(e: EnderecoParcial): string {
  const limpo = (v: string | null | undefined) => (v ?? '').trim();
  const rua = [limpo(e.logradouro), [limpo(e.numero), limpo(e.complemento)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const cidadeUf = [limpo(e.cidade), limpo(e.uf).toUpperCase()].filter(Boolean).join('/');
  const cep = cepValido(e.cep) ? `CEP ${formatarCep(e.cep)}` : '';
  return [rua, limpo(e.bairro), cidadeUf, cep].filter(Boolean).join(' - ');
}
