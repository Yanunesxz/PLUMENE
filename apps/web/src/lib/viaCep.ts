import { apenasDigitos, cepValido } from '@csb/shared';

/**
 * A consulta de CEP (ViaCEP) fora do componente.
 *
 * Nasceu no cadastro novo (PaginaClientes, 10/09/2026) e passou a servir
 * também a edição do cadastro (17/09/2026). A lógica é a mesma nas duas telas,
 * e os três cuidados dela custaram caro para aprender:
 *   • o corte de tempo compatível com o iPhone parado no iOS 15;
 *   • a resposta de um CEP ANTIGO é jogada fora — quem corrige o CEP no meio da
 *     busca não pode receber, calado, a rua do CEP anterior;
 *   • a consulta é ajuda, não dona do formulário: nunca apaga o que a pessoa
 *     digitou.
 *
 * Só online: sem rede a pessoa digita o endereço (quem chama confere).
 */

/**
 * Corta a espera em N ms. `AbortSignal.timeout` só existe do Safari 16 em
 * diante — no iPhone parado no iOS 15 ele não existe, e a chamada inteira
 * morreria num TypeError silencioso. Aqui o pior caso vira "sem corte de
 * tempo", nunca "sem consulta".
 */
export function abortarEm(ms: number): AbortSignal | null {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController === 'undefined') return null;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Os campos que o CEP sabe preencher. Número e complemento, só a pessoa. */
export type CampoDoCep = 'logradouro' | 'bairro' | 'cidade' | 'uf';

export const CAMPOS_DO_CEP: readonly CampoDoCep[] = ['logradouro', 'bairro', 'cidade', 'uf'];

export type EnderecoDoCep = Record<CampoDoCep, string>;

export type RespostaDoCep =
  | { situacao: 'encontrado'; endereco: EnderecoDoCep }
  | { situacao: 'nao_encontrado' }
  | { situacao: 'falhou' };

/** O que `fetch` precisa ser para a consulta — os testes passam um falso. */
export type Buscador = (url: string, init: { signal: AbortSignal | null }) => Promise<{ json: () => Promise<unknown> }>;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Consulta um CEP nos Correios (ViaCEP). CEP inválido não sai do aparelho:
 * devolve `nao_encontrado` sem consultar. Rede fora, demora acima do corte ou
 * resposta estranha viram `falhou` — a tela pede para digitar na mão.
 */
export async function consultarViaCep(
  cep: string,
  buscar: Buscador = (url, init) => fetch(url, init),
  ms = 6000,
): Promise<RespostaDoCep> {
  if (!cepValido(cep)) return { situacao: 'nao_encontrado' };
  try {
    const res = await buscar(`https://viacep.com.br/ws/${apenasDigitos(cep)}/json/`, { signal: abortarEm(ms) });
    const j = (await res.json()) as Record<string, unknown> | null;
    if (!j || typeof j !== 'object') return { situacao: 'falhou' };
    // O ViaCEP responde `"erro": true` (ou "true", conforme a versão) para CEP
    // bem formado que não existe.
    if (j['erro'] === true || j['erro'] === 'true') return { situacao: 'nao_encontrado' };
    return {
      situacao: 'encontrado',
      endereco: {
        logradouro: texto(j['logradouro']),
        bairro: texto(j['bairro']),
        cidade: texto(j['localidade']),
        uf: texto(j['uf']).toUpperCase(),
      },
    };
  } catch {
    return { situacao: 'falhou' };
  }
}

/**
 * Uma fila de UM pedido de CEP: guarda o último CEP pedido e descarta a
 * resposta que chegar de um pedido anterior. Sem isto, a resposta que demorou
 * chega depois da correção e preenche a rua errada, calada.
 */
export function criarConsultaDeCep(consultar: (cep: string) => Promise<RespostaDoCep> = (cep) => consultarViaCep(cep)) {
  let ultimo = '';
  return {
    /**
     * Consulta e devolve a resposta — ou `null` quando ela já não vale: outro
     * CEP foi pedido depois, ou a pessoa mexeu no CEP (`esquecer`).
     */
    async consultar(cep: string): Promise<RespostaDoCep | null> {
      const digitos = apenasDigitos(cep);
      ultimo = digitos;
      const resposta = await consultar(digitos);
      return ultimo === digitos ? resposta : null;
    },
    /** A pessoa mudou o CEP: o que estiver em voo é de outro endereço. */
    esquecer(): void {
      ultimo = '';
    },
  };
}

/**
 * Põe o endereço do CEP no formulário sem apagar o que a pessoa digitou.
 *
 * Preenche o campo vazio. Com `podeTrocar`, também troca o campo que a tela
 * sabe não ter sido digitado pela pessoa — na edição, a rua que veio do
 * cadastro é do CEP ANTIGO, e manter a rua velha com o CEP novo mandaria ao
 * Control um endereço que não existe. Resposta vazia do ViaCEP (CEP geral de
 * cidade pequena vem sem rua nem bairro) nunca apaga nada.
 */
export function preencherComOCep<T extends Record<CampoDoCep, string>>(
  form: T,
  endereco: EnderecoDoCep,
  podeTrocar: (campo: CampoDoCep) => boolean = () => false,
): T {
  let mudou = false;
  const novo = { ...form };
  for (const campo of CAMPOS_DO_CEP) {
    const achado = endereco[campo];
    if (!achado) continue;
    const vazio = !form[campo].trim();
    if ((vazio || podeTrocar(campo)) && form[campo] !== achado) {
      novo[campo] = achado as T[CampoDoCep];
      mudou = true;
    }
  }
  return mudou ? novo : form;
}

/**
 * O CEP voltou a ser o do cadastro: a rua, o bairro, a cidade e a UF que a
 * pessoa NÃO digitou voltam aos do cadastro (revisão de 17/09/2026).
 *
 * Quem troca o CEP vê a consulta trocar o endereço (é do CEP novo). Se percebe
 * o engano e digita o CEP de antes, não há o que consultar — só que os campos
 * continuavam com a rua e a cidade do CEP descartado, e ia para o Control um
 * endereço de Belo Horizonte com CEP de Muriaé, sem aviso nenhum. Campo não
 * digitado que difere do cadastro só pode ter vindo dessa consulta; o que a
 * pessoa digitou fica. Sem nada a voltar, devolve o mesmo objeto.
 */
export function voltarAoEnderecoDoCadastro<T extends Record<CampoDoCep, string>>(
  form: T,
  doCadastro: Record<CampoDoCep, string>,
  digitado: (campo: CampoDoCep) => boolean,
): T {
  let mudou = false;
  const novo = { ...form };
  for (const campo of CAMPOS_DO_CEP) {
    if (digitado(campo) || form[campo] === doCadastro[campo]) continue;
    novo[campo] = doCadastro[campo] as T[CampoDoCep];
    mudou = true;
  }
  return mudou ? novo : form;
}

/** O que a tela sabe na hora em que a pessoa sai do campo do CEP (ou toca em Salvar). */
export interface EstadoDoCep<T extends Record<CampoDoCep | 'cep', string>> {
  form: T;
  /** O CEP gravado no cadastro (com ou sem máscara). */
  cepDoCadastro: string | null | undefined;
  /** Rua, bairro, cidade e UF do cadastro, como o formulário os mostra. */
  doCadastro: Record<CampoDoCep, string>;
  digitado: (campo: CampoDoCep) => boolean;
  /** O último CEP consultado (só dígitos): sair duas vezes não consulta duas vezes. */
  cepConsultado: string;
  /** O CEP (só dígitos) cuja consulta pôs o endereço nos campos — '' = nenhuma. */
  cepDoPreenchimento: string;
  online: boolean;
}

export interface SaidaDoCep<T> {
  /** O formulário depois da volta ao endereço do cadastro (o mesmo objeto sem volta). */
  form: T;
  /** A volta ao endereço do cadastro aconteceu. */
  voltou: boolean;
  /** O CEP de agora é outro que o do cadastro. */
  cepMudou: boolean;
  /** O CEP a consultar, só dígitos — `null` quando não há o que consultar. */
  consultar: string | null;
  /** O `cepDoPreenchimento` depois da saída ('' quando a volta desfez o preenchimento). */
  cepDoPreenchimento: string;
  /** A frase para a pessoa, quando há (sem internet com CEP novo). */
  aviso: string | null;
}

export const AVISO_DO_CEP_SEM_INTERNET =
  'Sem internet: o endereço não foi conferido com o CEP novo — confira rua, bairro, cidade e UF.';

/**
 * A saída do campo do CEP, sem o componente: volta ao endereço do cadastro?
 * consulta? (revisão de 17/09/2026)
 *
 * A volta ao endereço do cadastro só vale quando os campos vieram da consulta
 * de OUTRO CEP. Antes ela rodava em toda saída com o CEP do cadastro: num
 * cadastro sem rua e bairro (carga parcial, ou o Control mandando só pedaços),
 * a primeira saída consultava e preenchia os dois — e a segunda os apagava,
 * porque "diferente do cadastro e não digitado" parecia a consulta de outro CEP.
 * A consulta não voltava enquanto o CEP não mudasse, e o Salvar acusava rua e
 * bairro obrigatórios.
 *
 * O CEP APAGADO também volta, quando o do cadastro é vazio (revisão de
 * 17/09/2026). No cliente legado (só a linha `address`, ~2.600 na CS) não há
 * CEP antigo para redigitar: quem digitava um CEP, via a consulta preencher
 * rua, bairro, cidade e UF e desistia apagando o CEP ("em branco, o endereço de
 * hoje fica como está") ficava com os quatro campos da consulta — e o Salvar
 * de uma edição só do WhatsApp travava em "CEP é obrigatório". Exigir CEP
 * válido para voltar só barrava justamente esse caso: com o CEP igual ao do
 * cadastro, "válido" era "o cadastro tem CEP".
 */
export function saidaDoCep<T extends Record<CampoDoCep | 'cep', string>>(e: EstadoDoCep<T>): SaidaDoCep<T> {
  const digitos = apenasDigitos(e.form.cep);
  const cepMudou = digitos !== apenasDigitos(e.cepDoCadastro ?? '');
  const valido = cepValido(e.form.cep);
  const voltou =
    !cepMudou && (valido || digitos === '') && e.cepDoPreenchimento !== '' && e.cepDoPreenchimento !== digitos;
  const form = voltou ? voltarAoEnderecoDoCadastro(e.form, e.doCadastro, e.digitado) : e.form;
  const base = { form, voltou, cepMudou, cepDoPreenchimento: voltou ? '' : e.cepDoPreenchimento };
  if (!valido || digitos === e.cepConsultado) return { ...base, consultar: null, aviso: null };
  const faltaAlgo = CAMPOS_DO_CEP.some((c) => !form[c].trim());
  // O CEP de sempre, com o endereço já preenchido: não há o que consultar.
  if (!cepMudou && !faltaAlgo) return { ...base, consultar: null, aviso: null };
  // Sem rede a pessoa digita — mas, com CEP novo, precisa saber que a rua e a
  // cidade na tela ainda são as do CEP antigo.
  if (!e.online) return { ...base, consultar: null, aviso: cepMudou ? AVISO_DO_CEP_SEM_INTERNET : null };
  return { ...base, consultar: digitos, aviso: null };
}

/**
 * Tocar em Salvar precisa conferir o CEP antes? (revisão de 17/09/2026)
 *
 * A consulta morava só na saída do campo. O Enter dentro do CEP envia o
 * formulário sem tirar o foco dele — e o CEP trocado sem internet não é
 * consultado quando a rede volta. Nos dois casos ia ao Control o CEP novo com a
 * rua, o bairro e a cidade do CEP antigo, sem aviso nenhum. Precisa quando a
 * saída do campo ainda mudaria o formulário (a volta ao cadastro) ou consultaria
 * um CEP NOVO que nunca foi consultado. `tentadoAoSalvar`: o CEP que o Salvar já
 * mandou conferir — a consulta que falhou por rede não trava o Salvar para
 * sempre (a pessoa leu "digite na mão").
 */
export function precisaConferirOCepAntesDeSalvar(saida: SaidaDoCep<unknown>, tentadoAoSalvar: string): boolean {
  if (saida.voltou) return true;
  return saida.consultar !== null && saida.cepMudou && saida.consultar !== tentadoAoSalvar;
}

/** O que aconteceu na saída do CEP. */
export type ResultadoDaSaidaDoCep = 'nada' | 'voltou' | 'descartado' | RespostaDoCep['situacao'];

/** A frase do rodapé quando o Salvar parou para conferir o CEP. */
export function avisoDoCepAntesDeSalvar(r: ResultadoDaSaidaDoCep): string {
  if (r === 'encontrado') {
    return 'O endereço do CEP novo foi preenchido agora — confira rua, bairro, cidade e UF e toque em Salvar de novo.';
  }
  if (r === 'voltou') {
    return 'O CEP voltou a ser o do cadastro, e o endereço também — confira e toque em Salvar de novo.';
  }
  return 'O CEP mudou e a consulta não preencheu o endereço — confira rua, bairro, cidade e UF e toque em Salvar de novo.';
}

/** A frase para quando o CEP não preencheu nada. `null` quando achou. */
export function avisoDaConsultaDeCep(r: RespostaDoCep): string | null {
  if (r.situacao === 'nao_encontrado') return 'CEP não encontrado nos Correios — confira, ou digite o endereço na mão.';
  if (r.situacao === 'falhou') return 'Não deu para consultar o CEP agora — digite o endereço na mão.';
  return null;
}
