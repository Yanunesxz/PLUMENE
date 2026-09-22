/**
 * As regras da carga por código (importar-clientes.mjs) que dá para testar sem
 * banco e sem Excel. Sem efeito colateral — o script importa daqui, e os
 * testes também (como catalogo-cores/cores.mjs).
 */

/** O texto aparado; vazio (ou só espaço) é "sem valor". */
const preenchido = (v) => v != null && String(v).trim() !== '';

/**
 * Com menos dígitos que isto, o WhatsApp não é telefone. É a MESMA régua do
 * `campoSoDoAppPreenchido` do shared (DIGITOS_MINIMOS_DO_WHATSAPP, em
 * packages/shared/src/cadastro/edicao.ts) e do `ehTelefone` do
 * consertar-whatsapp-com-nome.mjs — o script não importa TypeScript, então a
 * régua é repetida aqui, e um teste confere que as duas concordam.
 */
export const DIGITOS_MINIMOS_DO_WHATSAPP = 8;

/**
 * O app já tem um WhatsApp de verdade? Um NOME no lugar do número (a carga de
 * carteira gravava o "Contato zap" do Curva ABC até 16/09/2026) conta como
 * vazio (revisão de 22/09/2026): o app nunca grava isso — a edição exige 10 ou
 * 11 dígitos —, então é resto de carga antiga, e o número do Excel o troca.
 */
export const temWhatsapp = (v) =>
  preenchido(v) && String(v).replace(/\D/g, '').length >= DIGITOS_MINIMOS_DO_WHATSAPP;

/**
 * Os clientes cujo WhatsApp o APP já editou alguma vez, a partir das linhas do
 * histórico (`customer_changes`: `customer_id` e `campos`). Revisão de
 * 22/09/2026: o WhatsApp que o representante apagou no app não é "vazio" para
 * a carga — é a decisão do app, e o telefone do Excel não volta por cima.
 */
export function clientesComWhatsappEditadoNoApp(historico) {
  const ids = new Set();
  for (const l of historico ?? []) {
    const campos = l?.campos;
    if (campos && typeof campos === 'object' && Object.prototype.hasOwnProperty.call(campos, 'whatsapp')) {
      ids.add(l.customer_id);
    }
  }
  return ids;
}

/**
 * O que a carga grava num cliente que JÁ EXISTE no app.
 *
 * O WhatsApp é do app (22/09/2026). Pedido do Yan: "que eu possa alterar o wtss
 * do cliente sem ter que subir pro control, numero uma coisa numero de wtss
 * outro". O telefone do Excel do Control só PREENCHE o WhatsApp vazio: o que o
 * app já tem (corrigido pelo representante, pelo financeiro) não é trocado pelo
 * telefone de lá. É a mesma regra do POST /partner/v1/clientes e a que o
 * importar-carteira.mjs já seguia. Revisão do mesmo dia, também como no POST:
 *   • o WhatsApp que não é telefone conta como vazio (`temWhatsapp`);
 *   • o vazio que o app deixou de propósito (o cliente está em
 *     `editadosNoApp`) continua vazio;
 *   • o WhatsApp vazio do Excel nunca apaga nada — preencher com nada não é
 *     preencher (e o nome gravado fica para o conserto, que o acha pelo valor).
 *
 * `linha` é o que a carga montou do Excel; `existente`, o cliente lido do app
 * (com `id` e `whatsapp`); `editadosNoApp`, os ids de
 * `clientesComWhatsappEditadoNoApp`. Devolve uma cópia — a linha de entrada
 * não é mexida.
 */
export function linhaParaClienteExistente(linha, existente, editadosNoApp = new Set()) {
  const patch = { ...linha };
  const oAppDecide =
    temWhatsapp(existente?.whatsapp) || (existente?.id != null && editadosNoApp.has(existente.id));
  if (oAppDecide || !preenchido(linha?.whatsapp)) delete patch.whatsapp;
  return patch;
}
