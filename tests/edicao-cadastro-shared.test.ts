import { describe, it, expect } from 'vitest';
import {
  CAMPOS_EDITAVEIS_DO_CLIENTE,
  CAMPO_DO_CONTRATO_DO_PARCEIRO,
  ROTULO_DO_CAMPO_DO_CADASTRO,
  camposNoContratoDoParceiro,
  camposQueVieram,
  editaQualquerCliente,
  enderecoResultante,
  formatarValorDoCadastro,
  linhaDoEnderecoEditado,
  mesmoValorDoCadastro,
  montarEdicaoDoCadastro,
  normalizarCampoDoCadastro,
  podeConfirmarAlteracaoNoControl,
  podeEditarCadastroDoCliente,
  podeTrocarDocumentoDoCliente,
  primeiroErroDaEdicao,
  rotulosDosCamposAlterados,
  validarEdicaoDoCadastro,
  valoresEditaveisDoCliente,
  veAlteracoesPendentesDoCadastro,
} from '@csb/shared';

/**
 * Editar o cadastro do cliente — a régua que a tela e a API usam juntas (Yan,
 * 17/09/2026: "Quero poder mudar sim, e quando mudar lá tem que mudar no ERP
 * do Fábio também").
 *
 * O que estes testes trancam:
 *   • "o mesmo valor" é decidido normalizado: documento e CEP por dígitos, UF
 *     maiúscula, vazio = nulo — cadastro legado com máscara não vira falso
 *     conflito nem falsa alteração;
 *   • a validação é a do cadastro novo, campo a campo, mas o endereço só é
 *     cobrado quando alguém mexe numa peça — e aí o RESULTADO tem de ficar
 *     completo;
 *   • quem pode o quê, numa função só para a tela e a API;
 *   • os nomes que a API de Parceiro devolve e os rótulos da tela.
 *
 * Todos os documentos daqui são fictícios (DV válido, empresa inexistente).
 */

const CNPJ = '11222333000181';
const CNPJ_COM_MASCARA = '11.222.333/0001-81';

describe('normalizarCampoDoCadastro', () => {
  it('apara, e vazio vira nulo', () => {
    expect(normalizarCampoDoCadastro('name', '  LOJA FICTICIA  ')).toBe('LOJA FICTICIA');
    expect(normalizarCampoDoCadastro('email', '   ')).toBeNull();
    expect(normalizarCampoDoCadastro('whatsapp', '')).toBeNull();
    expect(normalizarCampoDoCadastro('observacoes', null)).toBeNull();
    expect(normalizarCampoDoCadastro('observacoes', undefined)).toBeNull();
  });

  it('documento e CEP só em dígitos; UF maiúscula; WhatsApp e e-mail só aparados', () => {
    expect(normalizarCampoDoCadastro('cnpj', CNPJ_COM_MASCARA)).toBe(CNPJ);
    expect(normalizarCampoDoCadastro('cep', '36000-000')).toBe('36000000');
    expect(normalizarCampoDoCadastro('uf', ' mg ')).toBe('MG');
    expect(normalizarCampoDoCadastro('whatsapp', ' (32) 99999-0000 ')).toBe('(32) 99999-0000');
    expect(normalizarCampoDoCadastro('email', ' Loja@Exemplo.com ')).toBe('Loja@Exemplo.com');
  });

  it('documento sem dígito nenhum é vazio', () => {
    expect(normalizarCampoDoCadastro('cnpj', 'ISENTO')).toBeNull();
  });
});

describe('mesmoValorDoCadastro — cadastro legado com máscara', () => {
  it('documento com máscara e só em dígitos são o mesmo', () => {
    expect(mesmoValorDoCadastro('cnpj', CNPJ_COM_MASCARA, CNPJ)).toBe(true);
    expect(mesmoValorDoCadastro('cep', '36000-000', '36000000')).toBe(true);
    expect(mesmoValorDoCadastro('uf', 'mg', 'MG')).toBe(true);
    expect(mesmoValorDoCadastro('email', '', null)).toBe(true);
  });

  it('em outros campos, máscara é diferença de verdade', () => {
    expect(mesmoValorDoCadastro('whatsapp', '(32) 99999-0000', '32999990000')).toBe(false);
    expect(mesmoValorDoCadastro('name', 'LOJA A', 'LOJA B')).toBe(false);
  });
});

describe('quebra de linha — a observação do Control (\\r\\n) diante do textarea (\\n) (revisão de 17/09/2026)', () => {
  const DO_CONTROL = 'Entregar após 14h\r\nFalar com Ana';
  const DO_TEXTAREA = 'Entregar após 14h\nFalar com Ana';

  it('"\\r\\n", "\\r" e "\\n" são a mesma quebra; o valor normalizado leva "\\n"', () => {
    expect(mesmoValorDoCadastro('observacoes', DO_CONTROL, DO_TEXTAREA)).toBe(true);
    expect(mesmoValorDoCadastro('observacoes', 'Entregar após 14h\rFalar com Ana', DO_TEXTAREA)).toBe(true);
    expect(normalizarCampoDoCadastro('observacoes', `${DO_CONTROL}\r\n`)).toBe(DO_TEXTAREA);
    // Quebra a mais continua sendo diferença.
    expect(mesmoValorDoCadastro('observacoes', 'Entregar após 14h\r\n\r\nFalar com Ana', DO_TEXTAREA)).toBe(false);
  });

  it('abrir e salvar sem mexer (o textarea já trocou a quebra) não manda nada', () => {
    const atual = { observacoes: DO_CONTROL };
    expect(montarEdicaoDoCadastro(atual, { observacoes: DO_TEXTAREA })).toEqual({ novo: {}, vistos: {} });
  });
});

describe('validarEdicaoDoCadastro', () => {
  const ENDERECO_COMPLETO = {
    cep: '36000000',
    logradouro: 'Rua Ficticia',
    numero: '10',
    complemento: null,
    bairro: 'Centro',
    cidade: 'Juiz de Fora',
    uf: 'MG',
  };

  it('cliente legado (só a linha address) edita o WhatsApp sem ser cobrado pelo endereço', () => {
    const legado = { name: 'LOJA FICTICIA', cnpj: CNPJ_COM_MASCARA, whatsapp: null };
    expect(validarEdicaoDoCadastro(legado, { whatsapp: '32999990000' })).toEqual({});
  });

  it('mexeu numa peça do endereço: o endereço RESULTANTE tem de ficar completo', () => {
    const erros = validarEdicaoDoCadastro({ name: 'LOJA FICTICIA' }, { cep: '36000-000' });
    expect(erros).toEqual({
      logradouro: 'Endereço (rua, avenida…) é obrigatório',
      numero: 'Número é obrigatório',
      bairro: 'Bairro é obrigatório',
      cidade: 'Cidade é obrigatória',
      uf: 'UF inválida',
    });
    expect(primeiroErroDaEdicao(erros)).toBe('Endereço (rua, avenida…) é obrigatório');
  });

  it('com o endereço já completo, trocar só o número basta', () => {
    expect(validarEdicaoDoCadastro(ENDERECO_COMPLETO, { numero: '12' })).toEqual({});
  });

  it('limpar uma peça obrigatória de um endereço completo é recusado; limpar o complemento, não', () => {
    expect(validarEdicaoDoCadastro(ENDERECO_COMPLETO, { bairro: '  ' })).toEqual({ bairro: 'Bairro é obrigatório' });
    expect(validarEdicaoDoCadastro({ ...ENDERECO_COMPLETO, complemento: 'Sala 2' }, { complemento: '' })).toEqual({});
  });

  it('CEP e UF inválidos no endereço resultante', () => {
    expect(validarEdicaoDoCadastro(ENDERECO_COMPLETO, { cep: '3600-000', uf: 'XX' })).toEqual({
      cep: 'CEP inválido — são 8 números',
      uf: 'UF inválida',
    });
  });

  it('documento: não fica vazio, e tem de passar no dígito verificador (com ou sem máscara)', () => {
    expect(validarEdicaoDoCadastro({}, { cnpj: '' })).toEqual({ cnpj: 'CPF / CNPJ é obrigatório' });
    expect(validarEdicaoDoCadastro({}, { cnpj: '11.222.333/0001-82' })).toEqual({
      cnpj: 'CPF / CNPJ inválido — confira os números',
    });
    expect(validarEdicaoDoCadastro({}, { cnpj: CNPJ_COM_MASCARA })).toEqual({});
    expect(validarEdicaoDoCadastro({}, { cnpj: CNPJ })).toEqual({});
  });

  it('a régua do cadastro novo, campo a campo', () => {
    expect(validarEdicaoDoCadastro({}, { name: 'A' }).name).toBe('Nome / razão social é obrigatório');
    expect(validarEdicaoDoCadastro({}, { name: null }).name).toBe('Nome / razão social é obrigatório');
    expect(validarEdicaoDoCadastro({}, { name: 'x'.repeat(201) }).name).toMatch(/200/);
    expect(validarEdicaoDoCadastro({}, { trade_name: 'x'.repeat(201) }).trade_name).toMatch(/200/);
    expect(validarEdicaoDoCadastro({}, { inscricao_estadual: 'x'.repeat(31) }).inscricao_estadual).toMatch(/30/);
    expect(validarEdicaoDoCadastro({}, { whatsapp: '123' }).whatsapp).toMatch(/DDD/);
    expect(validarEdicaoDoCadastro({}, { whatsapp: '(32) 99999-0000' })).toEqual({});
    expect(validarEdicaoDoCadastro({}, { whatsapp: null })).toEqual({});
    expect(validarEdicaoDoCadastro({}, { email: 'sem-arroba' }).email).toMatch(/E-mail inválido/);
    expect(validarEdicaoDoCadastro({}, { email: '' })).toEqual({});
    expect(validarEdicaoDoCadastro({}, { observacoes: 'x'.repeat(2001) }).observacoes).toMatch(/2000/);
    expect(validarEdicaoDoCadastro({}, { observacoes: 'x'.repeat(2000) })).toEqual({});
  });

  it('só olha o que veio: campo inválido que ninguém mexeu não trava a edição', () => {
    // Documento velho inválido no banco, edição só do e-mail.
    expect(validarEdicaoDoCadastro({ cnpj: '12345678000199' }, { email: 'loja@exemplo.com' })).toEqual({});
  });
});

describe('montarEdicaoDoCadastro — o que a tela manda', () => {
  it('só os campos que mudaram (normalizado), com o valor visto cru', () => {
    const atual = valoresEditaveisDoCliente({
      name: 'LOJA FICTICIA',
      cnpj: CNPJ_COM_MASCARA,
      whatsapp: '32999990000',
      email: null,
      cep: null,
      address: 'Rua Velha, 1',
      erp_id: '09999',
    });
    const r = montarEdicaoDoCadastro(atual, {
      ...atual,
      cnpj: CNPJ, // só tirou a máscara: não é mudança
      whatsapp: ' 32988880000 ',
      email: '',
      cep: '',
    });
    expect(r).toEqual({ novo: { whatsapp: '32988880000' }, vistos: { whatsapp: '32999990000' } });
  });

  it('valoresEditaveisDoCliente não leva o que não se edita', () => {
    const v = valoresEditaveisDoCliente({ name: 'X', erp_id: '1', address: 'linha', blocked: true });
    expect(Object.keys(v)).toEqual([...CAMPOS_EDITAVEIS_DO_CLIENTE]);
    expect(v).not.toHaveProperty('erp_id');
    expect(v).not.toHaveProperty('address');
  });

  it('camposQueVieram ignora undefined e mantém null (limpar)', () => {
    expect(camposQueVieram({ email: null, whatsapp: undefined, name: 'X' })).toEqual(['name', 'email']);
  });
});

describe('o endereço resultante', () => {
  it('o que veio por cima do atual, e a linha no formato de sempre', () => {
    const atual = { cep: '36000000', logradouro: 'Rua Ficticia', numero: '10', bairro: 'Centro', cidade: 'Juiz de Fora', uf: 'MG' };
    expect(enderecoResultante(atual, { numero: ' 12 ', uf: 'mg' })).toEqual({
      cep: '36000000',
      logradouro: 'Rua Ficticia',
      numero: '12',
      complemento: null,
      bairro: 'Centro',
      cidade: 'Juiz de Fora',
      uf: 'MG',
    });
    expect(linhaDoEnderecoEditado(atual, { complemento: 'Sala 2' })).toBe(
      'Rua Ficticia, 10 Sala 2 - Centro - Juiz de Fora/MG - CEP 36000-000',
    );
    expect(linhaDoEnderecoEditado({}, {})).toBeNull();
  });
});

describe('quem pode', () => {
  it('editar: rep, gerente, admin e financeiro — relacionamento, loja e visitante não', () => {
    for (const r of ['rep', 'manager', 'admin', 'financeiro'] as const) expect(podeEditarCadastroDoCliente(r)).toBe(true);
    for (const r of ['relacionamento', 'store', 'guest'] as const) expect(podeEditarCadastroDoCliente(r)).toBe(false);
    expect(podeEditarCadastroDoCliente(null)).toBe(false);
  });

  it('qualquer cliente: gerente, admin e financeiro; o rep só a carteira', () => {
    expect(editaQualquerCliente('rep')).toBe(false);
    for (const r of ['manager', 'admin', 'financeiro'] as const) expect(editaQualquerCliente(r)).toBe(true);
  });

  it('CPF/CNPJ e "Já atualizei no Control": só admin e financeiro', () => {
    for (const r of ['admin', 'financeiro'] as const) {
      expect(podeTrocarDocumentoDoCliente(r)).toBe(true);
      expect(podeConfirmarAlteracaoNoControl(r)).toBe(true);
    }
    for (const r of ['rep', 'manager', 'relacionamento', 'store', 'guest'] as const) {
      expect(podeTrocarDocumentoDoCliente(r)).toBe(false);
      expect(podeConfirmarAlteracaoNoControl(r)).toBe(false);
    }
  });

  it('a fila de cadastros alterados: financeiro, admin e gerente', () => {
    for (const r of ['admin', 'financeiro', 'manager'] as const) expect(veAlteracoesPendentesDoCadastro(r)).toBe(true);
    for (const r of ['rep', 'relacionamento', 'store'] as const) expect(veAlteracoesPendentesDoCadastro(r)).toBe(false);
  });
});

describe('rótulos e o contrato do parceiro', () => {
  it('todo campo editável e a linha address têm rótulo e nome no contrato', () => {
    const esperados = [...CAMPOS_EDITAVEIS_DO_CLIENTE, 'address'].sort();
    expect(Object.keys(ROTULO_DO_CAMPO_DO_CADASTRO).sort()).toEqual(esperados);
    expect(Object.keys(CAMPO_DO_CONTRATO_DO_PARCEIRO).sort()).toEqual(esperados);
  });

  it('as peças do endereço e a linha viram UM "endereco", na ordem do contrato', () => {
    expect(camposNoContratoDoParceiro(['cep', 'address', 'whatsapp', 'name', 'uf', 'coluna_do_futuro'])).toEqual([
      'razao_social',
      'whatsapp',
      'endereco',
    ]);
    expect(camposNoContratoDoParceiro(['cnpj', 'trade_name', 'observacoes', 'inscricao_estadual', 'email'])).toEqual([
      'nome_fantasia',
      'cnpj_cpf',
      'inscricao_estadual',
      'email',
      'observacoes',
    ]);
  });

  it('a frase do que mudou junta o endereço num rótulo só', () => {
    expect(rotulosDosCamposAlterados(['address', 'numero', 'whatsapp', 'cep'])).toEqual(['WhatsApp', 'Endereço']);
    expect(rotulosDosCamposAlterados(['cnpj'])).toEqual(['CPF/CNPJ']);
  });

  it('o valor para ler: documento e CEP com máscara, vazio escrito', () => {
    expect(formatarValorDoCadastro('cnpj', CNPJ)).toBe(CNPJ_COM_MASCARA);
    expect(formatarValorDoCadastro('cep', '36000000')).toBe('36000-000');
    expect(formatarValorDoCadastro('email', null)).toBe('(vazio)');
    expect(formatarValorDoCadastro('whatsapp', '32999990000')).toBe('32999990000');
  });
});
