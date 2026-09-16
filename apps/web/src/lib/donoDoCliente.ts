import type { DonoDoCliente } from '@csb/shared';

/** O que a ficha escreve perto do CNPJ. */
export interface LinhasDoDono {
  /** "NOME (código 00779)", "NOME" ou "Sem representante dono…". */
  representante: string;
  /** Só quando quem cadastrou no app não é o dono. */
  cadastradoPor: string | null;
}

/**
 * De quem é o cliente, em palavras.
 *
 * O dono é o representante do código do Control. Cliente nascido no app sem
 * código ainda é de quem o cadastrou (é a outra metade da regra da carteira).
 * Código que nenhum login tem não vira nome inventado: a ficha diz que não há
 * dono e mostra o código, para o escritório saber quem procurar.
 */
export function linhasDoDono(dono: DonoDoCliente): LinhasDoDono {
  const codigo = dono.rep_erp_id?.trim() || null;

  if (dono.rep_pelo_codigo_nome) {
    const outro = dono.rep_nome !== null && dono.rep_id !== dono.rep_pelo_codigo_id;
    return {
      representante: `${dono.rep_pelo_codigo_nome}${codigo ? ` (código ${codigo})` : ''}`,
      cadastradoPor: outro ? dono.rep_nome : null,
    };
  }

  if (!codigo && dono.rep_nome) {
    return { representante: dono.rep_nome, cadastradoPor: null };
  }

  return {
    representante: codigo
      ? `Sem representante dono (código ${codigo} sem login no app)`
      : 'Sem representante dono',
    cadastradoPor: dono.rep_nome,
  };
}
