/**
 * CLIENTE INATIVO — a lista fechada de motivos (migração 052).
 *
 * Pedido do Yan (22/09/2026): "colocar que o cliente é inativo deixa ele como
 * não precisar reativar ou esfriado; são clientes que não compram mais, que não
 * trabalham com pijamas; não pode ser escrito o motivo, precisa ser
 * selecionado". E: "o que marcar inativo aqui vai inativar no CRM também e
 * vice-versa; não tem nada a ver com Control, só controle interno".
 *
 * As CHAVES são as do CRM (CSP 360), onde isso se chama "Perdido manual" — é a
 * mesma chave nos dois lados, senão a sincronia nunca casa. Só o rótulo é
 * nosso. `outro` exige uma nota curta, regra que veio do CRM.
 */
export const MOTIVOS_DE_INATIVO = [
  { chave: 'fechou-a-loja', rotulo: 'Fechou a loja' },
  { chave: 'mudou-de-segmento', rotulo: 'Não trabalha mais com pijama' },
  { chave: 'nao-quer-relacionamento', rotulo: 'Não quer mais comprar da marca' },
  { chave: 'reativacao-esgotada', rotulo: 'Já tentamos reativar e não voltou' },
  { chave: 'outro', rotulo: 'Outro motivo' },
] as const;

export type MotivoDeInativo = (typeof MOTIVOS_DE_INATIVO)[number]['chave'];

export const CHAVES_DE_MOTIVO = MOTIVOS_DE_INATIVO.map((m) => m.chave) as [
  MotivoDeInativo,
  ...MotivoDeInativo[],
];

export function rotuloDoMotivo(chave: string | null | undefined): string | null {
  return MOTIVOS_DE_INATIVO.find((m) => m.chave === chave)?.rotulo ?? null;
}

/** `outro` sem nota é motivo nenhum — a regra é a mesma do CRM. */
export function motivoExigeNota(chave: string | null | undefined): boolean {
  return chave === 'outro';
}
