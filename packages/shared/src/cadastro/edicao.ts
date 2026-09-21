/**
 * EDITAR O CADASTRO DO CLIENTE — a régua que a tela e a API usam juntas.
 *
 * Pedido do Yan (17/09/2026): "Não tem como alterar esses dados nem sendo admin
 * lá dentro. Quero poder mudar sim, e quando mudar lá tem que mudar no ERP do
 * Fábio também."
 *
 * Mora em `shared` pelo mesmo motivo de documento.ts: o formulário avisa antes
 * de mandar e a API recusa se alguém chamar por fora — e as duas pontas
 * precisam concordar no que é "o mesmo valor". Se a tela achasse que
 * "22.518.613/0001-58" mudou para "22518613000158" e o servidor não, cada
 * cadastro antigo com máscara viraria um falso conflito (ou uma falsa
 * alteração mandada ao Control).
 *
 * A régua de cada campo é a MESMA do cadastro novo (createCustomerSchema, na
 * API): quem edita não pode deixar o cliente num estado que o cadastro novo
 * recusaria. A exceção deliberada é o endereço de cliente legado (~2.600 na
 * CS têm só a linha `address`): ele só é exigido completo quando alguém mexe
 * numa peça — corrigir o WhatsApp não obriga a preencher endereço.
 */
import type { AuthRole } from '../constants/userRole.js';
import type {
  CampoDoHistoricoDoCadastro,
  CampoEditavelDoCliente,
  EditarCadastroDoClienteRequest,
  ErrosDaEdicaoDoCadastro,
  NomeNoContratoDoParceiro,
  PecaDoEnderecoDoCliente,
  ValoresDoCadastro,
} from '../types/customer.js';
import { apenasDigitos, documento, formatarDocumento } from './documento.js';
import { cepValido, formatarCep, linhaDeEndereco, ufValida } from './endereco.js';

// ─── Os campos ───────────────────────────────────────────────────────────────

/** Na ordem do formulário (e do histórico). */
export const CAMPOS_EDITAVEIS_DO_CLIENTE = [
  'name',
  'trade_name',
  'cnpj',
  'inscricao_estadual',
  'whatsapp',
  'email',
  'observacoes',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
] as const satisfies readonly CampoEditavelDoCliente[];

export const PECAS_DO_ENDERECO_DO_CLIENTE = [
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
] as const satisfies readonly PecaDoEnderecoDoCliente[];

/** Colunas que só existem com a migração 041. Sem ela, editar qualquer uma é recusado. */
export const CAMPOS_QUE_PRECISAM_DA_041: readonly CampoEditavelDoCliente[] = [
  ...PECAS_DO_ENDERECO_DO_CLIENTE,
  'inscricao_estadual',
  'observacoes',
];

export const ehCampoEditavelDoCliente = (v: unknown): v is CampoEditavelDoCliente =>
  typeof v === 'string' && (CAMPOS_EDITAVEIS_DO_CLIENTE as readonly string[]).includes(v);

export const ehPecaDoEndereco = (v: unknown): v is PecaDoEnderecoDoCliente =>
  typeof v === 'string' && (PECAS_DO_ENDERECO_DO_CLIENTE as readonly string[]).includes(v);

/** O rótulo em português de cada campo — o formulário, o cartão "Para atualizar no Control" e o push. */
export const ROTULO_DO_CAMPO_DO_CADASTRO: Record<CampoDoHistoricoDoCadastro, string> = {
  name: 'Razão social',
  trade_name: 'Nome fantasia',
  cnpj: 'CPF/CNPJ',
  inscricao_estadual: 'Inscrição estadual',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  observacoes: 'Observações',
  cep: 'CEP',
  logradouro: 'Endereço (rua, avenida…)',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'UF',
  address: 'Endereço completo',
};

/**
 * Coluna do app → nome do campo no contrato da API de Parceiro. As peças do
 * endereço e a linha `address` são UM campo lá (`endereco`): o Control recebe e
 * devolve o endereço como grupo.
 */
export const CAMPO_DO_CONTRATO_DO_PARCEIRO: Record<CampoDoHistoricoDoCadastro, NomeNoContratoDoParceiro> = {
  name: 'razao_social',
  trade_name: 'nome_fantasia',
  cnpj: 'cnpj_cpf',
  inscricao_estadual: 'inscricao_estadual',
  whatsapp: 'whatsapp',
  email: 'email',
  observacoes: 'observacoes',
  cep: 'endereco',
  logradouro: 'endereco',
  numero: 'endereco',
  complemento: 'endereco',
  bairro: 'endereco',
  cidade: 'endereco',
  uf: 'endereco',
  address: 'endereco',
};

/** A ordem dos campos no contrato (a mesma do GET /partner/v1/clientes). */
const ORDEM_NO_CONTRATO: readonly NomeNoContratoDoParceiro[] = [
  'razao_social',
  'nome_fantasia',
  'cnpj_cpf',
  'inscricao_estadual',
  'whatsapp',
  'email',
  'observacoes',
  'endereco',
];

/**
 * Os nomes do contrato de um conjunto de colunas alteradas, sem repetição e na
 * ordem do contrato. Chave desconhecida (coluna que um dia entre no histórico
 * e o contrato ainda não tenha) fica de fora em vez de virar lixo na resposta.
 */
export function camposNoContratoDoParceiro(colunas: Iterable<string>): NomeNoContratoDoParceiro[] {
  const nomes = new Set<NomeNoContratoDoParceiro>();
  for (const c of colunas) {
    if (Object.prototype.hasOwnProperty.call(CAMPO_DO_CONTRATO_DO_PARCEIRO, c)) {
      nomes.add(CAMPO_DO_CONTRATO_DO_PARCEIRO[c as CampoDoHistoricoDoCadastro]);
    }
  }
  return ORDEM_NO_CONTRATO.filter((n) => nomes.has(n));
}

/**
 * Quantas edições JÁ RESOLVIDAS a ficha traz em `CustomerDetail.alteracoes` (as
 * pendentes vão todas). Mora aqui porque a API corta a lista nesse número e a
 * tela escreve "(últimas N)" — se um mudasse sem o outro, a legenda mentiria.
 */
export const ALTERACOES_RESOLVIDAS_NA_FICHA = 10;

// ─── Quem pode ───────────────────────────────────────────────────────────────

/**
 * Quem edita o cadastro (Yan, 17/09/2026): admin, financeiro, gerente e
 * representante — venda interna incluída, que é representante. Relacionamento,
 * loja e visitante, não. Reverte, só para o cadastro, o "financeiro só
 * visualiza" de 14/08/2026.
 */
export function podeEditarCadastroDoCliente(role: AuthRole | null | undefined): boolean {
  return role === 'rep' || role === 'manager' || role === 'admin' || role === 'financeiro';
}

/**
 * Edita QUALQUER cliente da empresa. O representante (e a venda interna) só
 * os da própria carteira — a mesma regra da lista e da ficha.
 */
export function editaQualquerCliente(role: AuthRole | null | undefined): boolean {
  return role === 'manager' || role === 'admin' || role === 'financeiro';
}

/**
 * CPF/CNPJ só o escritório troca (Yan, 17/09/2026): o documento é a chave do
 * cliente entre o app e o Control, e trocado errado vira nota no nome de outra
 * empresa.
 */
export function podeTrocarDocumentoDoCliente(role: AuthRole | null | undefined): boolean {
  return role === 'admin' || role === 'financeiro';
}

/** "Já atualizei no Control": só quem mexe no Control. */
export function podeConfirmarAlteracaoNoControl(role: AuthRole | null | undefined): boolean {
  return role === 'admin' || role === 'financeiro';
}

/** Quem vê a fila "Cadastros alterados para atualizar no Control". */
export function veAlteracoesPendentesDoCadastro(role: AuthRole | null | undefined): boolean {
  return role === 'admin' || role === 'financeiro' || role === 'manager';
}

// ─── Normalização ────────────────────────────────────────────────────────────

/**
 * O valor de um campo como o banco guarda e como se compara.
 *
 * Aparado; vazio vira `null`. CPF/CNPJ e CEP só em dígitos (como o cadastro
 * novo grava) — um cadastro legado com máscara compara igual ao mesmo
 * documento sem máscara. UF em maiúscula. Os demais (WhatsApp e e-mail
 * inclusive) só aparados: o que a pessoa digitou é o que vai.
 *
 * Quebra de linha sempre como "\n" (17/09/2026). O `<textarea>` troca todo
 * "\r\n" por "\n" (regra do HTML), e o Control — programa Windows — grava a
 * observação com "\r\n". Comparadas cruas, a mesma observação era "outra": a
 * tela acusava "Alterado: Observações." com o texto igual, e a edição do app
 * que o Control devolvia com "\r\n" nunca era dada por alcançada — aviso de
 * "mantido o valor do app" em todo envio, para sempre.
 */
export function normalizarCampoDoCadastro(campo: CampoDoHistoricoDoCadastro, valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const texto = String(valor).replace(/\r\n?/g, '\n').trim();
  if (texto === '') return null;
  if (campo === 'cnpj' || campo === 'cep') return apenasDigitos(texto) || null;
  if (campo === 'uf') return texto.toUpperCase();
  return texto;
}

/** Os dois valores são o mesmo, depois de normalizados? */
export function mesmoValorDoCadastro(campo: CampoDoHistoricoDoCadastro, a: unknown, b: unknown): boolean {
  return normalizarCampoDoCadastro(campo, a) === normalizarCampoDoCadastro(campo, b);
}

/**
 * Os campos editáveis de um cliente (a ficha, uma linha do banco), crus.
 *
 * Recebe `object` e não `Record<string, unknown>`: a ficha da tela é a
 * interface `CustomerDetail`, e interface não passa como registro solto no
 * TypeScript — a tela precisaria de um embrulho só para chamar o mesmo helper
 * que a API usa com a linha do banco.
 */
export function valoresEditaveisDoCliente(cliente: object): ValoresDoCadastro {
  const valores: ValoresDoCadastro = {};
  const linha = cliente as Readonly<Record<string, unknown>>;
  for (const campo of CAMPOS_EDITAVEIS_DO_CLIENTE) {
    const v = linha[campo];
    valores[campo] = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
  }
  return valores;
}

/** O campo veio no pedido? (`undefined` = não mexe; `null` = limpar.) */
const veio = (valores: ValoresDoCadastro, campo: CampoEditavelDoCliente): boolean =>
  Object.prototype.hasOwnProperty.call(valores, campo) && valores[campo] !== undefined;

/** As chaves de `valores` que vieram, na ordem do formulário. */
export function camposQueVieram(valores: ValoresDoCadastro): CampoEditavelDoCliente[] {
  return CAMPOS_EDITAVEIS_DO_CLIENTE.filter((c) => veio(valores, c));
}

/**
 * O pedido de edição que a tela manda: só os campos cujo valor normalizado
 * mudou, e o valor que a pessoa VIU de cada um (cru, como veio do servidor).
 * Campo ausente do formulário não entra.
 */
export function montarEdicaoDoCadastro(
  atual: ValoresDoCadastro,
  formulario: ValoresDoCadastro,
): EditarCadastroDoClienteRequest {
  const novo: ValoresDoCadastro = {};
  const vistos: ValoresDoCadastro = {};
  for (const campo of camposQueVieram(formulario)) {
    if (mesmoValorDoCadastro(campo, atual[campo], formulario[campo])) continue;
    novo[campo] = normalizarCampoDoCadastro(campo, formulario[campo]);
    vistos[campo] = atual[campo] ?? null;
  }
  return { novo, vistos };
}

/** O endereço como fica depois da edição: o que veio em `novo` por cima do atual, normalizado. */
export function enderecoResultante(
  atual: ValoresDoCadastro,
  novo: ValoresDoCadastro,
): Record<PecaDoEnderecoDoCliente, string | null> {
  const final = {} as Record<PecaDoEnderecoDoCliente, string | null>;
  for (const p of PECAS_DO_ENDERECO_DO_CLIENTE) {
    final[p] = normalizarCampoDoCadastro(p, veio(novo, p) ? novo[p] : atual[p]);
  }
  return final;
}

/** A linha única do endereço resultante (`address`), no formato de sempre. Vazio vira `null`. */
export function linhaDoEnderecoEditado(atual: ValoresDoCadastro, novo: ValoresDoCadastro): string | null {
  return linhaDeEndereco(enderecoResultante(atual, novo)) || null;
}

/**
 * A linha `address` do cadastro diz OUTRA COISA que as peças? (revisão de
 * 17/09/2026)
 *
 * Acontece quando só a linha foi gravada por fora — o `POST /clientes` do
 * Control com o endereço em texto, a carga de clientes. Como a linha é
 * remontada das peças a cada edição do endereço, mexer só no complemento
 * trocaria rua, número e bairro da linha sem que ninguém visse: a tela avisa
 * quem edita, e o histórico marca a troca para o cartão do financeiro.
 *
 * Cliente legado (sem logradouro) não conta — nele a linha é o único endereço
 * e a tela já a mostra. Sem linha, também não.
 */
export function linhaForaDasPecas(address: unknown, atual: ValoresDoCadastro): boolean {
  if (!normalizarCampoDoCadastro('logradouro', atual.logradouro)) return false;
  const linha = normalizarCampoDoCadastro('address', address);
  if (!linha) return false;
  return !mesmoValorDoCadastro('address', linha, linhaDoEnderecoEditado(atual, {}));
}

// ─── Validação ───────────────────────────────────────────────────────────────

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const maximo = (rotulo: string, n: number) => `${rotulo}: no máximo ${n} caracteres`;

/**
 * Confere a edição e devolve os erros por campo (objeto vazio = pode mandar).
 *
 * Só olha o que veio em `novo` — edição é parcial. Mas se QUALQUER peça do
 * endereço veio, o endereço RESULTANTE (o atual com a edição por cima) tem de
 * ficar completo e válido, como no cadastro novo: meio endereço vai para o
 * Control pior do que endereço nenhum. Cliente legado que só tem a linha
 * `address` e não mexe no endereço não é cobrado por isso.
 */
export function validarEdicaoDoCadastro(
  atual: ValoresDoCadastro,
  novo: ValoresDoCadastro,
): ErrosDaEdicaoDoCadastro {
  const erros: ErrosDaEdicaoDoCadastro = {};
  const valor = (c: CampoEditavelDoCliente) => normalizarCampoDoCadastro(c, novo[c]);

  if (veio(novo, 'name')) {
    const v = valor('name');
    if (!v || v.length < 2) erros.name = 'Nome / razão social é obrigatório';
    else if (v.length > 200) erros.name = maximo('Nome / razão social', 200);
  }
  if (veio(novo, 'trade_name')) {
    const v = valor('trade_name');
    if (v && v.length > 200) erros.trade_name = maximo('Nome fantasia', 200);
  }
  if (veio(novo, 'cnpj')) {
    const v = valor('cnpj');
    if (!v) erros.cnpj = 'CPF / CNPJ é obrigatório';
    else if (!documento(v)) erros.cnpj = 'CPF / CNPJ inválido — confira os números';
  }
  if (veio(novo, 'inscricao_estadual')) {
    const v = valor('inscricao_estadual');
    if (v && v.length > 30) erros.inscricao_estadual = maximo('Inscrição estadual', 30);
  }
  if (veio(novo, 'whatsapp')) {
    const v = valor('whatsapp');
    const n = apenasDigitos(v).length;
    if (v && (v.length > 30 || n < 10 || n > 11)) {
      erros.whatsapp = 'Informe o WhatsApp com DDD (10 ou 11 dígitos), ou deixe em branco';
    }
  }
  if (veio(novo, 'email')) {
    const v = valor('email');
    if (v && (v.length > 200 || !EMAIL.test(v))) erros.email = 'E-mail inválido — ou deixe em branco';
  }
  if (veio(novo, 'observacoes')) {
    const v = valor('observacoes');
    if (v && v.length > 2000) erros.observacoes = maximo('Observações', 2000);
  }

  if (PECAS_DO_ENDERECO_DO_CLIENTE.some((p) => veio(novo, p))) {
    const e = enderecoResultante(atual, novo);
    if (!e.cep) erros.cep = 'CEP é obrigatório';
    else if (!cepValido(e.cep)) erros.cep = 'CEP inválido — são 8 números';
    if (!e.logradouro) erros.logradouro = 'Endereço (rua, avenida…) é obrigatório';
    else if (e.logradouro.length > 200) erros.logradouro = maximo('Endereço', 200);
    if (!e.numero) erros.numero = 'Número é obrigatório';
    else if (e.numero.length > 20) erros.numero = maximo('Número', 20);
    if (e.complemento && e.complemento.length > 100) erros.complemento = maximo('Complemento', 100);
    if (!e.bairro) erros.bairro = 'Bairro é obrigatório';
    else if (e.bairro.length > 100) erros.bairro = maximo('Bairro', 100);
    if (!e.cidade) erros.cidade = 'Cidade é obrigatória';
    else if (e.cidade.length > 100) erros.cidade = maximo('Cidade', 100);
    if (!ufValida(e.uf)) erros.uf = 'UF inválida';
  }

  return erros;
}

/** A primeira mensagem, na ordem do formulário — para quem só mostra uma. */
export function primeiroErroDaEdicao(erros: ErrosDaEdicaoDoCadastro): string | null {
  for (const c of CAMPOS_EDITAVEIS_DO_CLIENTE) {
    const m = erros[c];
    if (m) return m;
  }
  return null;
}

// ─── Exibição ────────────────────────────────────────────────────────────────

/**
 * Os rótulos do que mudou, para uma frase ("WhatsApp, Endereço"): as peças do
 * endereço e a linha `address` viram um "Endereço" só, sem repetição, na ordem
 * do formulário. Chave desconhecida fica de fora.
 */
export function rotulosDosCamposAlterados(colunas: Iterable<string>): string[] {
  const presentes = new Set(colunas);
  const rotulos: string[] = [];
  let endereco = presentes.has('address');
  for (const c of CAMPOS_EDITAVEIS_DO_CLIENTE) {
    if (!presentes.has(c)) continue;
    if (ehPecaDoEndereco(c)) endereco = true;
    else rotulos.push(ROTULO_DO_CAMPO_DO_CADASTRO[c]);
  }
  if (endereco) rotulos.push('Endereço');
  return rotulos;
}

/** Um valor do histórico para ler: documento e CEP com máscara, vazio como "(vazio)". */
export function formatarValorDoCadastro(campo: CampoDoHistoricoDoCadastro, valor: string | null | undefined): string {
  const v = (valor ?? '').trim();
  if (v === '') return '(vazio)';
  if (campo === 'cnpj') return formatarDocumento(v);
  if (campo === 'cep') return formatarCep(v);
  return v;
}
