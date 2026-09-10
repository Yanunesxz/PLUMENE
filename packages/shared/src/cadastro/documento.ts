/**
 * CPF e CNPJ de VERDADE — com os dígitos verificadores conferidos.
 *
 * Até 10/09/2026 o app só contava dígitos (11 ou 14): "12345678000199"
 * passava. O Yan pediu "CNPJ verdadeiro ou CPF que os números condizem" —
 * o cadastro vai para o Control (ERP da fábrica), que recusa documento
 * inválido, e o cliente errado vira nota fiscal errada.
 *
 * Mora em `shared` porque as DUAS pontas validam a mesma coisa: o formulário
 * avisa antes de mandar, a API recusa se alguém chamar por fora. Sem
 * dependência: é módulo 11, aritmética pura.
 */

export type TipoDeDocumento = 'cpf' | 'cnpj';

export interface DocumentoValido {
  tipo: TipoDeDocumento;
  /** Só números — é assim que o banco guarda desde a migração 041. */
  digitos: string;
}

export const apenasDigitos = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/** "111.111.111-11" passa no módulo 11 e é lixo — a Receita não emite. */
const todosIguais = (d: string): boolean => /^(\d)\1+$/.test(d);

export function cpfValido(v: string | null | undefined): boolean {
  const d = apenasDigitos(v);
  if (d.length !== 11 || todosIguais(d)) return false;
  const dv = (tamanho: number): number => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(v: string | null | undefined): boolean {
  const d = apenasDigitos(v);
  if (d.length !== 14 || todosIguais(d)) return false;
  const dv = (tamanho: number): number => {
    const pesos =
      tamanho === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * pesos[i]!;
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/**
 * O documento reconhecido e normalizado — ou `null` se não é CPF nem CNPJ
 * válido. Quem chama grava `digitos`, nunca o texto digitado: com máscara ou
 * sem, "22.518.613/0001-58" e "22518613000158" têm de ser o MESMO cliente.
 */
export function documento(v: string | null | undefined): DocumentoValido | null {
  const d = apenasDigitos(v);
  if (d.length === 11 && cpfValido(d)) return { tipo: 'cpf', digitos: d };
  if (d.length === 14 && cnpjValido(d)) return { tipo: 'cnpj', digitos: d };
  return null;
}

/** Para a tela: 000.000.000-00 ou 00.000.000/0000-00. Fora disso, devolve como veio. */
export function formatarDocumento(v: string | null | undefined): string {
  const d = apenasDigitos(v);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return (v ?? '').trim();
}
