import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { camposQueVieram, linhaForaDasPecas, montarEdicaoDoCadastro } from '@csb/shared';
import type { AlteracaoDoCliente, CustomerDetail, EditarCadastroDoClienteResponse } from '@csb/shared';
import {
  AVISO_DA_EDICAO_SEM_REGISTRO_PARA_O_CONTROL,
  alteracaoPendente,
  autoriaDaAlteracao,
  avisoDaConfirmacao,
  avisoDaConfirmacaoInterrompida,
  avisoDoCadastroMudadoPorFora,
  avisoDoCadastroSalvo,
  avisoSemReleituraDaFicha,
  camposDaListaDoCliente,
  camposRecusadosQueNaoForamMandados,
  avisoDaReleituraDepoisDoErro,
  confirmacaoTalvezGravada,
  edicaoGravadaApesarDoErro,
  edicaoSemRegistroParaOControl,
  edicaoTalvezGravada,
  emLotesDeConfirmacao,
  errosDoServidorNaEdicao,
  fichaDoConflito,
  formularioAposConflito,
  formularioDoCliente,
  fraseDoRodapeComErroNoCampo,
  linhasDaAlteracao,
  marcarConfirmadasNaFicha,
  mensagemDoErroDaConfirmacao,
  mensagemDoErroDaEdicao,
  notaDaLinhaSuperada,
  pendentesNaOrdemDeDigitar,
  separarAlteracoes,
  situacaoDaAlteracao,
  valoresDoCliente,
} from '../apps/web/src/lib/edicaoDoCadastro.js';

/**
 * As telas da edição do cadastro (Yan, 17/09/2026: "Quero poder mudar sim, e
 * quando mudar lá tem que mudar no ERP do Fábio também").
 *
 * O que estes testes trancam:
 *   • abrir e salvar sem mexer não manda nada — nem a máscara do documento,
 *     nem o endereço vazio do cliente legado;
 *   • depois de um 409, o campo que OUTRA pessoa mudou volta ao valor novo (e
 *     não é desfeito no próximo salvar), e a digitação desta pessoa fica;
 *   • o cartão "Para atualizar no Control" mostra só as pendentes, campo a
 *     campo, sem repetir a linha do endereço;
 *   • as frases de depois de salvar e de confirmar.
 *
 * Documentos fictícios (DV válido, empresa inexistente).
 */

const CNPJ = '11222333000181';

function cliente(extra: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'LOJA FICTICIA LTDA',
    trade_name: 'Loja Fictícia',
    cnpj: CNPJ,
    whatsapp: '32999990000',
    email: null,
    address: 'Rua A, 10 - Centro - Muriaé/MG - CEP 36880-000',
    credit_limit: null,
    blocked: false,
    block_reason: null,
    price_table_id: null,
    erp_id: '05836',
    cep: '36880000',
    logradouro: 'Rua A',
    numero: '10',
    complemento: null,
    bairro: 'Centro',
    cidade: 'Muriaé',
    uf: 'MG',
    inscricao_estadual: null,
    observacoes: null,
    pedidos: [],
    ...extra,
  };
}

function alteracao(extra: Partial<AlteracaoDoCliente> = {}): AlteracaoDoCliente {
  return {
    id: 'a1',
    customer_id: '00000000-0000-4000-8000-000000000001',
    alterado_por: 'u1',
    alterado_por_nome: 'Pessoa Teste',
    alterado_em: '2026-09-17T14:30:00.000Z',
    campos: { whatsapp: { antes: '32999990000', depois: '32988880000' } },
    erp_pendente: true,
    erp_atualizado_em: null,
    erp_atualizado_por: null,
    erp_atualizado_por_nome: null,
    erp_atualizado_via: null,
    ...extra,
  };
}

describe('formularioDoCliente', () => {
  it('documento e CEP com máscara, UF maiúscula, nulo vira texto vazio', () => {
    const f = formularioDoCliente(cliente({ uf: 'mg', email: null }));
    expect(f.cnpj).toBe('11.222.333/0001-81');
    expect(f.cep).toBe('36880-000');
    expect(f.uf).toBe('MG');
    expect(f.email).toBe('');
    expect(f.complemento).toBe('');
  });

  it('abrir e salvar sem mexer não manda nada — a máscara não é alteração', () => {
    const c = cliente({ uf: 'mg', cnpj: '11.222.333/0001-81' });
    const edicao = montarEdicaoDoCadastro(valoresDoCliente(c), formularioDoCliente(c));
    expect(camposQueVieram(edicao.novo)).toEqual([]);
  });

  it('cliente legado (só a linha do endereço): campos vazios que ficam vazios não vão', () => {
    const legado = cliente({
      cep: null,
      logradouro: null,
      numero: null,
      bairro: null,
      cidade: null,
      uf: null,
      address: 'RUA VELHA 100 CENTRO MURIAE MG',
    });
    const f = { ...formularioDoCliente(legado), whatsapp: '32988880000' };
    const edicao = montarEdicaoDoCadastro(valoresDoCliente(legado), f);
    expect(edicao).toEqual({ novo: { whatsapp: '32988880000' }, vistos: { whatsapp: '32999990000' } });
  });
});

describe('formularioAposConflito', () => {
  it('o campo que outra pessoa mudou volta ao valor novo; o que só esta pessoa digitou fica', () => {
    const antes = cliente();
    const agora = cliente({ whatsapp: '32977770000', cep: '36880100' });
    const digitado = { ...formularioDoCliente(antes), observacoes: 'Entregar de manhã' };

    const { formulario, mudaram } = formularioAposConflito(digitado, antes, agora);

    expect(mudaram).toEqual(['whatsapp', 'cep']);
    expect(formulario.whatsapp).toBe('32977770000');
    expect(formulario.cep).toBe('36880-100');
    expect(formulario.observacoes).toBe('Entregar de manhã');

    // O próximo salvar leva só a observação: nada desfaz a edição do outro.
    const edicao = montarEdicaoDoCadastro(valoresDoCliente(agora), formulario);
    expect(edicao.novo).toEqual({ observacoes: 'Entregar de manhã' });
  });

  it('se os dois mudaram o mesmo campo, fica o de agora (a pessoa confere e digita de novo)', () => {
    const antes = cliente();
    const agora = cliente({ email: 'outro@exemplo.com' });
    const digitado = { ...formularioDoCliente(antes), email: 'meu@exemplo.com' };
    const { formulario, mudaram } = formularioAposConflito(digitado, antes, agora);
    expect(mudaram).toEqual(['email']);
    expect(formulario.email).toBe('outro@exemplo.com');
  });

  it('documento com e sem máscara não é mudança de outra pessoa', () => {
    const antes = cliente({ cnpj: '11.222.333/0001-81' });
    const agora = cliente({ cnpj: CNPJ });
    expect(formularioAposConflito(formularioDoCliente(antes), antes, agora).mudaram).toEqual([]);
  });
});

describe('camposDaListaDoCliente', () => {
  it('só o que a lista do aparelho guarda e a edição muda', () => {
    expect(camposDaListaDoCliente(cliente({ name: 'NOVO NOME' }))).toEqual({
      name: 'NOVO NOME',
      trade_name: 'Loja Fictícia',
      cnpj: CNPJ,
      whatsapp: '32999990000',
    });
  });
});

describe('avisoDoCadastroSalvo', () => {
  const salvo = (extra: Partial<Extract<EditarCadastroDoClienteResponse, { alteracao: unknown }>>) =>
    ({
      data: cliente(),
      alteracao: alteracao(),
      erp_pendente: true,
      control_puxa_pela_api: false,
      avisados: { financeiro: 1, admin: 0 },
      ...extra,
    }) as EditarCadastroDoClienteResponse;

  it('sem mudança real', () => {
    expect(avisoDoCadastroSalvo({ data: cliente(), sem_mudanca: true })).toMatch(/Nada mudou/);
  });

  it('com aviso entregue ao financeiro: o financeiro foi avisado', () => {
    expect(avisoDoCadastroSalvo(salvo({}))).toBe('Cadastro salvo. O financeiro foi avisado para atualizar no Control.');
    expect(avisoDoCadastroSalvo(salvo({ avisados: { financeiro: 2, admin: 1 } }))).toMatch(/financeiro foi avisado/);
  });

  it('aviso só no aparelho do admin: NÃO diz que o financeiro foi avisado (revisão de 17/09/2026)', () => {
    // A API conta os dois separados justamente para isso; somar dizia ao
    // representante que o financeiro sabia, e ele não avisava por outro caminho.
    const frase = avisoDoCadastroSalvo(salvo({ avisados: { financeiro: 0, admin: 2 } }));
    expect(frase).not.toMatch(/financeiro foi avisado/);
    expect(frase).toMatch(/só ao administrador/);
    expect(frase).toMatch(/lista para atualizar no Control/);
  });

  it('cliente fora do Control', () => {
    expect(avisoDoCadastroSalvo(salvo({ erp_pendente: false, avisados: null }))).toBe(
      'Cadastro salvo. Cliente ainda não está no Control.',
    );
  });

  it('Control que puxa pela API: sem push, e a frase não promete aviso', () => {
    expect(avisoDoCadastroSalvo(salvo({ control_puxa_pela_api: true, avisados: null }))).toMatch(/integração/);
  });

  it('push sem aparelho ou fora do tempo: não diz que avisou', () => {
    for (const avisados of [null, { financeiro: 0, admin: 0 }]) {
      const frase = avisoDoCadastroSalvo(salvo({ avisados }));
      expect(frase).not.toMatch(/avisado/);
      expect(frase).toMatch(/lista para atualizar no Control/);
    }
  });

  it('quem salvou é do financeiro: o zero do financeiro não é "ninguém com aviso ligado" (revisão de 17/09/2026)', () => {
    // O aviso nunca vai para quem editou: o único financeiro da empresa, com o
    // push ligado, conta zero — e lia que ninguém do financeiro tinha aviso.
    const frase = avisoDoCadastroSalvo(salvo({ avisados: { financeiro: 0, admin: 1 } }), 'financeiro');
    expect(frase).toBe('Cadastro salvo. A mudança ficou na lista para atualizar no Control.');
    // Para quem não é do financeiro, a frase de sempre.
    for (const papel of ['rep', 'manager', 'admin', null, undefined] as const) {
      expect(avisoDoCadastroSalvo(salvo({ avisados: { financeiro: 0, admin: 1 } }), papel)).toMatch(/só ao administrador/);
    }
    // Um colega do financeiro recebeu: diz que o financeiro foi avisado.
    expect(avisoDoCadastroSalvo(salvo({ avisados: { financeiro: 1, admin: 0 } }), 'financeiro')).toMatch(
      /financeiro foi avisado/,
    );
    // O 500 SALVO_SEM_RELER_A_FICHA monta a mesma frase, com o papel.
    const e = erroDaApi('SALVO_SEM_RELER_A_FICHA', {
      error: 'O cadastro foi salvo, mas não deu para recarregar a ficha.',
      erp_pendente: true,
      control_puxa_pela_api: false,
      avisados: { financeiro: 0, admin: 1 },
    });
    expect(edicaoGravadaApesarDoErro(e, 'financeiro')?.mensagem).toBe(
      'Cadastro salvo. A mudança ficou na lista para atualizar no Control.',
    );
  });

  it('a ficha e o diálogo passam o papel de quem salvou', () => {
    const ficha = lerDoRepo('apps/web/src/modules/clientes/PaginaCliente.tsx');
    expect(ficha).toMatch(/avisoDoCadastroSalvo\(resposta, user\?\.role\)/);
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    expect(dialogo).toMatch(/edicaoGravadaApesarDoErro\(err, user\?\.role\)/);
  });
});

describe('mensagemDoErroDaEdicao', () => {
  it('erro da API: a frase dela, que já vem em português', () => {
    const e = Object.assign(new Error('Só o financeiro ou o administrador trocam o CPF/CNPJ do cliente'), {
      code: 'DOCUMENTO_SO_ESCRITORIO',
    });
    expect(mensagemDoErroDaEdicao(e)).toBe('Só o financeiro ou o administrador trocam o CPF/CNPJ do cliente');
  });

  it('falha de rede ("Load failed" no iPhone) vira frase que se entende', () => {
    expect(mensagemDoErroDaEdicao(new TypeError('Load failed'))).toMatch(/Confira a internet/);
    expect(mensagemDoErroDaEdicao('qualquer coisa')).toMatch(/Tente de novo/);
  });
});

describe('mensagemDoErroDaConfirmacao — "Já atualizei no Control" (revisão de 17/09/2026)', () => {
  it('falha de rede no 4G fraco: nunca "Load failed" nem "Failed to fetch" cru no cartão', () => {
    for (const frase of ['Load failed', 'Failed to fetch']) {
      const m = mensagemDoErroDaConfirmacao(new TypeError(frase));
      expect(m).not.toContain(frase);
      expect(m).toBe('Não deu para falar com o servidor. Confira a internet e tente de novo.');
    }
  });

  it('erro da API: a frase dela; o resto, uma frase de marcar', () => {
    const e = Object.assign(new Error('Só o financeiro ou o administrador confirmam'), { code: 'FORBIDDEN' });
    expect(mensagemDoErroDaConfirmacao(e)).toBe('Só o financeiro ou o administrador confirmam');
    expect(mensagemDoErroDaConfirmacao('qualquer coisa')).toMatch(/marcar como atualizado/);
  });

  it('a ficha usa a tradução no catch da confirmação', () => {
    const ficha = lerDoRepo('apps/web/src/modules/clientes/PaginaCliente.tsx');
    expect(ficha).toMatch(/setErroAoConfirmar\(mensagemDoErroDaConfirmacao\(err\)\)/);
    expect(ficha).not.toMatch(/setErroAoConfirmar\(err instanceof Error \? err\.message/);
  });

  it('a baixa que pode ter ficado (503 CONFIRMACAO_NAO_CONFIRMADA ou rede): a ficha relê; os outros erros, não (revisão de 17/09/2026)', () => {
    expect(confirmacaoTalvezGravada(erroDaApi('CONFIRMACAO_NAO_CONFIRMADA', { error: 'O banco não confirmou a baixa.' }))).toBe(true);
    expect(confirmacaoTalvezGravada(new TypeError('Load failed'))).toBe(true);
    for (const code of ['UPDATE_FAILED', 'TENTE_DE_NOVO', 'NOT_FOUND', 'FORBIDDEN']) {
      expect(confirmacaoTalvezGravada(erroDaApi(code, { error: 'x' }))).toBe(false);
    }
    expect(confirmacaoTalvezGravada('qualquer coisa')).toBe(false);

    // A frase do 503 da API chega ao cartão sem dizer "nada foi marcado".
    const e503 = erroDaApi('CONFIRMACAO_NAO_CONFIRMADA', {
      error: 'O banco não confirmou a baixa. Abra a ficha de novo para conferir antes de marcar outra vez.',
    });
    expect(mensagemDoErroDaConfirmacao(e503)).not.toMatch(/[Nn]ada foi marcado/);

    // O catch da confirmação relê a ficha nesses casos — e quando um lote anterior já marcou.
    const ficha = lerDoRepo('apps/web/src/modules/clientes/PaginaCliente.tsx');
    const inicio = ficha.indexOf('const confirmarNoControl = async (ids: string[]) => {');
    const pegou = ficha.indexOf('} catch (err) {', inicio);
    const catchDaConfirmacao = ficha.slice(pegou, ficha.indexOf('} finally {', pegou));
    expect(catchDaConfirmacao).toMatch(/if \(confirmadas\.length > 0 \|\| confirmacaoTalvezGravada\(err\)\) \{/);
    expect(catchDaConfirmacao).toMatch(/api\.get<ApiResponse<CustomerDetail>>\(`\/customers\/\$\{id\}`, token\)/);
    expect(catchDaConfirmacao).toMatch(/setCliente\(res\.data\);/);
    // `confirmadas` vive fora do try: o catch sabe o que os lotes anteriores marcaram.
    expect(ficha.indexOf('const confirmadas: string[] = [];', inicio)).toBeLessThan(ficha.indexOf('try {', inicio));
  });

  it('a baixa interrompida no meio (mais de 50 ids, o 2º lote falha): a frase não diz "nada foi marcado" do todo', () => {
    expect(avisoDaConfirmacaoInterrompida(50, true)).toBe(
      '50 alterações marcadas no Control antes do erro. A ficha foi relida: o cartão mostra o que ainda falta.',
    );
    expect(avisoDaConfirmacaoInterrompida(1, false)).toBe(
      '1 alteração marcada no Control antes do erro; o resto não deu para confirmar — confira o cartão e toque de novo.',
    );
    expect(avisoDaConfirmacaoInterrompida(0, true)).toMatch(/Não deu para confirmar se marcou, então a ficha foi relida/);
    expect(avisoDaConfirmacaoInterrompida(0, false)).toBeNull();
    for (const frase of [avisoDaConfirmacaoInterrompida(50, true), avisoDaConfirmacaoInterrompida(3, false)]) {
      expect(frase).not.toMatch(/[Nn]ada foi marcado/);
    }
  });
});

function lerDoRepo(arquivo: string): string {
  return readFileSync(path.resolve(__dirname, '..', arquivo), 'utf8');
}

/** Um erro como `services/api.ts` lança: frase, código e o corpo JSON inteiro. */
const erroDaApi = (code: string, corpo: Record<string, unknown>) =>
  Object.assign(new Error(String(corpo['error'] ?? code)), { code, corpo });

describe('edicaoGravadaApesarDoErro — o 500 que diz que a edição ficou (revisão de 17/09/2026)', () => {
  it('SALVO_SEM_RELER_A_FICHA: gravou — a frase de salvo, montada com o corpo do 500', () => {
    const e = erroDaApi('SALVO_SEM_RELER_A_FICHA', {
      error: 'O cadastro foi salvo, mas não deu para recarregar a ficha.',
      alteracao: alteracao(),
      erp_pendente: true,
      control_puxa_pela_api: false,
      avisados: { financeiro: 1, admin: 1 },
    });
    expect(edicaoGravadaApesarDoErro(e)).toEqual({
      mensagem: 'Cadastro salvo. O financeiro foi avisado para atualizar no Control.',
      tipo: 'success',
    });
  });

  it('ALTERACAO_SEM_HISTORICO: o cliente ficou alterado — a frase da API, como erro', () => {
    const e = erroDaApi('ALTERACAO_SEM_HISTORICO', {
      error: 'O cadastro foi alterado, mas o registro para o Control falhou e não deu para desfazer — avise o suporte.',
    });
    expect(edicaoGravadaApesarDoErro(e)).toEqual({
      mensagem: 'O cadastro foi alterado, mas o registro para o Control falhou e não deu para desfazer — avise o suporte.',
      tipo: 'error',
    });
  });

  it('o resto não gravou (ou não se sabe): segue como erro', () => {
    for (const code of ['UPDATE_FAILED', 'ALTERACAO_NAO_REGISTRADA', 'GRAVACAO_NAO_CONFIRMADA', 'MUDOU_DE_NOVO']) {
      expect(edicaoGravadaApesarDoErro(erroDaApi(code, { error: 'x' }))).toBeNull();
    }
    expect(edicaoGravadaApesarDoErro(new TypeError('Load failed'))).toBeNull();
    expect(edicaoGravadaApesarDoErro('qualquer coisa')).toBeNull();
  });

  it('o diálogo fecha e a ficha relê quando gravou, ANTES de tratar o erro como falha', () => {
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    const pegou = dialogo.indexOf('const gravada = edicaoGravadaApesarDoErro(err, user?.role);');
    expect(pegou).toBeGreaterThan(-1);
    expect(dialogo.indexOf("esquecerCache('/customers');", pegou)).toBeGreaterThan(pegou);
    expect(dialogo.indexOf('onGravadoApesarDoErro(gravada);', pegou)).toBeGreaterThan(pegou);
    expect(pegou).toBeLessThan(dialogo.indexOf("if (codigo === 'MUDOU_DE_NOVO')"));
    expect(pegou).toBeLessThan(dialogo.indexOf('setErro(mensagemDoErroDaEdicao(err));'));
    const ficha = lerDoRepo('apps/web/src/modules/clientes/PaginaCliente.tsx');
    expect(ficha).toMatch(/onGravadoApesarDoErro=\{\(aviso\) => \{\s*setEditandoCadastro\(false\);/);
    expect(ficha).toMatch(/void relerDepoisDeGravar\(aviso\);/);
  });

  it('a releitura da ficha que também falha NÃO apaga o aviso de que a mudança não vai chegar ao Control (revisão de 17/09/2026)', () => {
    // Um toast só na ficha: a frase da releitura trocava "o registro para o
    // Control falhou… avise o suporte" por "O cadastro foi salvo, mas não deu
    // para recarregar a ficha" — e o representante saía achando que salvou tudo.
    const semHistorico = edicaoGravadaApesarDoErro(
      erroDaApi('ALTERACAO_SEM_HISTORICO', {
        error: 'O cadastro foi alterado, mas o registro para o Control falhou e não deu para desfazer — avise o suporte.',
      }),
    )!;
    const final = avisoSemReleituraDaFicha(semHistorico);
    expect(final.tipo).toBe('error');
    expect(final.mensagem).toContain('registro para o Control falhou');
    expect(final.mensagem).toContain('avise o suporte');
    expect(final.mensagem).toContain('Não deu para recarregar a ficha');
    expect(final.mensagem).not.toContain('foi salvo');

    // O 500 SALVO_SEM_RELER_A_FICHA também guarda o que aconteceu com o Control.
    const salvo = avisoSemReleituraDaFicha({
      mensagem: 'Cadastro salvo. O financeiro foi avisado para atualizar no Control.',
      tipo: 'success',
    });
    expect(salvo).toEqual({
      mensagem:
        'Cadastro salvo. O financeiro foi avisado para atualizar no Control. Não deu para recarregar a ficha: feche e abra a ficha de novo para ver os dados.',
      tipo: 'error',
    });

    // A ficha usa a frase composta com o aviso do salvar — nunca uma frase fixa de "salvo".
    const ficha = lerDoRepo('apps/web/src/modules/clientes/PaginaCliente.tsx');
    const releitura = ficha.slice(ficha.indexOf('const relerDepoisDeGravar = async ('));
    const corpoDaReleitura = releitura.slice(0, releitura.indexOf('\n  };'));
    expect(corpoDaReleitura).toMatch(/avisoSemReleituraDaFicha\(aviso\)/);
    expect(corpoDaReleitura).not.toContain('O cadastro foi salvo');
  });
});

describe('o erro de campo que vem do servidor (revisão de 17/09/2026)', () => {
  it('o rodapé diz onde olhar — a frase do campo fica lá em cima, fora da vista de quem tocou em Salvar', () => {
    expect(fraseDoRodapeComErroNoCampo(['cnpj'])).toBe('Não salvou: confira o campo CPF/CNPJ.');
    expect(fraseDoRodapeComErroNoCampo(['numero', 'cep'])).toBe('Não salvou: confira os campos Número, CEP.');
    expect(fraseDoRodapeComErroNoCampo([])).toBe('Não salvou: confira os campos marcados.');
  });

  it('o foco vai ao campo só DEPOIS de destravar o formulário, e o rodapé mostra a frase', () => {
    // Campo dentro de <fieldset disabled> não recebe foco: pedido no catch, com
    // o `salvando` ainda true na tela, o foco caía no body.
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    const inicio = dialogo.indexOf('const salvar = async (e: FormEvent) => {');
    const pegou = dialogo.indexOf('} catch (err) {', inicio);
    const fim = dialogo.indexOf('} finally {', pegou);
    const catchDoSalvar = dialogo.slice(pegou, fim);
    expect(pegou).toBeGreaterThan(inicio);
    expect(catchDoSalvar).not.toMatch(/\bfocar\(/);
    expect(catchDoSalvar).toMatch(/setErro\(fraseDoRodapeComErroNoCampo\(\['cnpj'\]\)\);\s*setFocarDepois\('cnpj'\);/);
    expect(catchDoSalvar).toMatch(/setFocarDepois\(primeiroDoServidor\);/);
    expect(dialogo).toMatch(
      /useEffect\(\(\) => \{\s*if \(salvando \|\| !focarDepois\) return;\s*document\.getElementById\(`\$\{prefixo\}-\$\{focarDepois\}`\)\?\.focus\(\);\s*setFocarDepois\(null\);\s*\}, \[salvando, focarDepois, prefixo\]\);/,
    );
  });
});

describe('o erro que deixa a gravação em dúvida (revisão de 17/09/2026)', () => {
  it('503 GRAVACAO_NAO_CONFIRMADA e falha de rede: relê; os outros erros, não', () => {
    expect(edicaoTalvezGravada(erroDaApi('GRAVACAO_NAO_CONFIRMADA', { error: 'O banco não confirmou' }))).toBe(true);
    expect(edicaoTalvezGravada(new TypeError('Failed to fetch'))).toBe(true);
    for (const code of ['MUDOU_DE_NOVO', 'UPDATE_FAILED', 'ALTERACAO_NAO_REGISTRADA', 'TENTE_DE_NOVO', 'VALIDATION_ERROR']) {
      expect(edicaoTalvezGravada(erroDaApi(code, { error: 'x' }))).toBe(false);
    }
    expect(edicaoTalvezGravada(Object.assign(new TypeError('x'), { code: 'X' }))).toBe(false);
    expect(edicaoTalvezGravada('qualquer coisa')).toBe(false);
  });

  it('a frase não culpa "outra pessoa": diz se o cadastro já está com a edição ou continua como estava', () => {
    const gravou = avisoDaReleituraDepoisDoErro(['whatsapp']);
    expect(gravou).toMatch(/Não deu para confirmar se salvou/);
    expect(gravou).toMatch(/WhatsApp/);
    expect(gravou).not.toMatch(/enquanto você editava/);
    expect(avisoDaReleituraDepoisDoErro([])).toMatch(/continua como estava/);
  });

  it('o diálogo relê (e a ficha atrás dele também) antes de mostrar o erro de sempre', () => {
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    const duvida = dialogo.indexOf('} else if (edicaoTalvezGravada(err)) {');
    expect(duvida).toBeGreaterThan(dialogo.indexOf("if (codigo === 'MUDOU_DE_NOVO')"));
    expect(duvida).toBeLessThan(dialogo.indexOf('setErro(mensagemDoErroDaEdicao(err));'));
    expect(dialogo.indexOf('await recarregar(null, avisoDaReleituraDepoisDoErro, mensagemDoErroDaEdicao(err));', duvida)).toBeGreaterThan(
      duvida,
    );
    // A releitura passa a ficha de agora para trás do diálogo.
    const recarregar = dialogo.slice(dialogo.indexOf('const recarregar = async ('), dialogo.indexOf('const salvar = async'));
    expect(recarregar).toMatch(/onRecarregado\(agora\);/);
    expect(recarregar).toMatch(/setConflito\(frase\(mudaram\)\);/);
    expect(recarregar).toMatch(/setErro\(seNaoReler\);/);
    // …e devolve a ficha relida, para o salvar decidir o que dizer.
    expect(recarregar).toMatch(/return agora;/);
  });
});

describe('503 GRAVACAO_NAO_CONFIRMADA com a edição já aplicada (revisão de 17/09/2026)', () => {
  // Nesse caminho a API volta ANTES de gravar em customer_changes: o cadastro
  // fica alterado e a mudança não entra na fila do Control — sem cartão, sem
  // push, sem item na Minha área. Dizer só "os campos já estão com o que está
  // no cadastro agora" fazia a pessoa fechar o diálogo achando que deu certo.
  const erro503 = () => erroDaApi('GRAVACAO_NAO_CONFIRMADA', { error: 'O banco não confirmou se o cadastro foi salvo.' });
  const novo = { whatsapp: '32988880000' };

  it('a ficha relida está com o valor enviado e sem pendência dele: a edição ficou SEM registro para o Control', () => {
    const relida = cliente({ whatsapp: '32988880000', alteracoes: [] });
    expect(edicaoSemRegistroParaOControl(erro503(), novo, relida)).toBe(true);
    // Sem o campo `alteracoes` (a leitura degradou) a conclusão é a mesma: o
    // 503 só sai por caminhos que não chegam a gravar o histórico.
    expect(edicaoSemRegistroParaOControl(erro503(), novo, cliente({ whatsapp: '32988880000' }))).toBe(true);
    expect(AVISO_DA_EDICAO_SEM_REGISTRO_PARA_O_CONTROL).toMatch(/Control/);
    expect(AVISO_DA_EDICAO_SEM_REGISTRO_PARA_O_CONTROL).toMatch(/suporte/);
  });

  it('não acusa quando há pendência do campo, quando o cadastro está como estava, nem fora do 503', () => {
    const comPendencia = cliente({ whatsapp: '32988880000', alteracoes: [alteracao()] });
    expect(edicaoSemRegistroParaOControl(erro503(), novo, comPendencia)).toBe(false);
    // A pendência de OUTRO campo não explica esta edição.
    const deOutroCampo = cliente({
      whatsapp: '32988880000',
      alteracoes: [alteracao({ campos: { email: { antes: null, depois: 'a@b.invalid' } } })],
    });
    expect(edicaoSemRegistroParaOControl(erro503(), novo, deOutroCampo)).toBe(true);
    // O cadastro continua como estava: não gravou.
    expect(edicaoSemRegistroParaOControl(erro503(), novo, cliente({ alteracoes: [] }))).toBe(false);
    // Falha de rede pura pode ter gravado COM histórico — aí o cartão aparece sozinho.
    expect(edicaoSemRegistroParaOControl(new TypeError('Failed to fetch'), novo, cliente({ whatsapp: '32988880000' }))).toBe(
      false,
    );
    expect(edicaoSemRegistroParaOControl(erroDaApi('MUDOU_DE_NOVO', {}), novo, cliente({ whatsapp: '32988880000' }))).toBe(
      false,
    );
    expect(edicaoSemRegistroParaOControl(erro503(), {}, cliente({ alteracoes: [] }))).toBe(false);
  });

  it('pendência ANTIGA do mesmo campo com outro `depois` não é o registro desta edição: acusa (revisão de 17/09/2026)', () => {
    // Segunda: WhatsApp 32999990000 → 32988880000, esperando o financeiro. Hoje:
    // → 32977770000, e o 503. O 503 nunca grava histórico: a pendência de
    // segunda não explica o 32977770000 — contada só pela chave, ela escondia o
    // aviso, e o cartão seguia mandando pôr 32988880000 no Control.
    const antiga = alteracao({ campos: { whatsapp: { antes: '32999990000', depois: '32988880000' } } });
    const relida = cliente({ whatsapp: '32977770000', alteracoes: [antiga] });
    expect(edicaoSemRegistroParaOControl(erro503(), { whatsapp: '32977770000' }, relida)).toBe(true);
    // A pendência que leva AO valor enviado continua valendo como registro (com máscara/espaço também).
    const mesma = alteracao({ campos: { whatsapp: { antes: '32988880000', depois: '32977770000' } } });
    expect(
      edicaoSemRegistroParaOControl(erro503(), { whatsapp: ' 32977770000 ' }, cliente({ whatsapp: '32977770000', alteracoes: [antiga, mesma] })),
    ).toBe(false);
    // Já resolvida não é registro de nada que esteja esperando o Control.
    const resolvida = alteracao({
      campos: { whatsapp: { antes: '32988880000', depois: '32977770000' } },
      erp_atualizado_em: '2026-09-17T15:00:00.000Z',
      erp_atualizado_via: 'app',
    });
    expect(edicaoSemRegistroParaOControl(erro503(), { whatsapp: '32977770000' }, cliente({ whatsapp: '32977770000', alteracoes: [resolvida] }))).toBe(
      true,
    );
  });

  it('gravou, e outra mão trocou OUTRO campo do mesmo envio antes da releitura: o campo que ficou com o valor mandado é acusado', () => {
    // O UPDATE é um compare-and-set de todas as colunas juntas: o WhatsApp com o
    // valor mandado prova que a edição gravou — o e-mail num terceiro valor não
    // desmente isso. Exigir TODOS os campos deixava o WhatsApp sem registro calado.
    const misturada = cliente({ whatsapp: '32988880000', email: 'terceiro@exemplo.invalid', alteracoes: [] });
    expect(
      edicaoSemRegistroParaOControl(erro503(), { whatsapp: '32988880000', email: 'novo@exemplo.invalid' }, misturada),
    ).toBe(true);
    // Nenhum campo com o valor mandado: não gravou (ou outra mão desfez tudo) — nada a acusar.
    const nenhum = cliente({ whatsapp: '32999990000', email: 'terceiro@exemplo.invalid', alteracoes: [] });
    expect(edicaoSemRegistroParaOControl(erro503(), { whatsapp: '32988880000', email: 'novo@exemplo.invalid' }, nenhum)).toBe(
      false,
    );
  });

  it('o diálogo avisa depois de reler, em vez de deixar só a frase da releitura', () => {
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    const duvida = dialogo.indexOf('} else if (edicaoTalvezGravada(err)) {');
    const aviso = dialogo.indexOf('edicaoSemRegistroParaOControl(err, edicao.novo, relida)', duvida);
    expect(aviso).toBeGreaterThan(duvida);
    expect(dialogo.indexOf('setErro(AVISO_DA_EDICAO_SEM_REGISTRO_PARA_O_CONTROL);', aviso)).toBeGreaterThan(aviso);
  });
});

describe('400 num campo que a tela nem mandou (revisão de 17/09/2026)', () => {
  // O cadastro mudou POR FORA (o POST do Control apagou o bairro) e o endereço
  // é validado como grupo: o 400 aponta uma peça que a tela não mandou. Marcar
  // o campo deixava "Bairro é obrigatório" embaixo de um bairro preenchido, e
  // digitar o mesmo valor não saía do lugar — o formulário compara com o `base`
  // velho e o campo não entra em `novo`.
  it('camposRecusadosQueNaoForamMandados: só o que o servidor recusou e a tela não enviou', () => {
    const erros = { bairro: 'Bairro é obrigatório', numero: 'Número é obrigatório' };
    expect(camposRecusadosQueNaoForamMandados(erros, { numero: '120' })).toEqual(['bairro']);
    // Tudo que veio no pedido: é erro de campo mesmo, a tela marca e fica.
    expect(camposRecusadosQueNaoForamMandados({ numero: 'Número é obrigatório' }, { numero: '' })).toEqual([]);
    // `null` (limpar) também é campo mandado.
    expect(camposRecusadosQueNaoForamMandados({ email: 'E-mail inválido' }, { email: null })).toEqual([]);
    expect(camposRecusadosQueNaoForamMandados({}, { numero: '120' })).toEqual([]);
  });

  it('a frase diz que o cadastro mudou por fora e o que fazer', () => {
    const frase = avisoDoCadastroMudadoPorFora(['bairro']);
    expect(frase).toMatch(/mudou por fora/);
    // Peça do endereço aparece como "Endereço", a mesma conta do 409.
    expect(frase).toMatch(/Endereço/);
    expect(frase).toMatch(/preencha o que falta/);
    expect(avisoDoCadastroMudadoPorFora(['whatsapp'])).toMatch(/WhatsApp/);
    expect(avisoDoCadastroMudadoPorFora([])).toMatch(/mudou por fora/);
  });

  it('sem reler não há saída; com a ficha relida o campo volta a ser mandável', () => {
    const formulario = { ...formularioDoCliente(cliente()), numero: '120' };
    // A ficha velha ainda mostra "Centro": o bairro nunca entra no pedido, e o
    // mesmo 400 se repete por mais que a pessoa redigite.
    const comAFichaVelha = montarEdicaoDoCadastro(valoresDoCliente(cliente()), formulario);
    expect(camposQueVieram(comAFichaVelha.novo)).toEqual(['numero']);
    expect(camposRecusadosQueNaoForamMandados({ bairro: 'Bairro é obrigatório' }, comAFichaVelha.novo)).toEqual([
      'bairro',
    ]);
    // Depois da releitura o bairro aparece vazio; preenchê-lo agora vai no pedido.
    const relida = cliente({ bairro: null });
    const depois = montarEdicaoDoCadastro(valoresDoCliente(relida), {
      ...formularioDoCliente(relida),
      numero: '120',
      bairro: 'Centro',
    });
    expect(camposQueVieram(depois.novo).sort()).toEqual(['bairro', 'numero']);
    expect(depois.vistos.bairro ?? null).toBeNull();
  });

  it('o diálogo relê a ficha nesse caso, antes de marcar o campo', () => {
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    expect(dialogo).toMatch(/const naoMandados = camposRecusadosQueNaoForamMandados\(errosDoCampo, edicao\.novo\);/);
    const ramo = dialogo.indexOf('} else if (naoMandados.length > 0) {');
    expect(ramo).toBeGreaterThan(-1);
    // Antes do ramo que só marca o campo recusado.
    expect(ramo).toBeLessThan(dialogo.indexOf('} else if (primeiroDoServidor) {'));
    expect(dialogo.indexOf('avisoDoCadastroMudadoPorFora', ramo)).toBeGreaterThan(ramo);
  });
});

describe('"Já atualizei no Control" com a releitura falhando (revisão de 17/09/2026)', () => {
  it('marcarConfirmadasNaFicha: só as confirmadas, e só se ainda pendentes, viram atualizadas no app por quem confirmou', () => {
    const lista = [
      alteracao({ id: 'a1' }),
      alteracao({ id: 'a2' }),
      alteracao({ id: 'a3', erp_atualizado_em: '2026-09-16T10:00:00.000Z', erp_atualizado_via: 'api' }),
    ];
    const marcadas = marcarConfirmadasNaFicha(lista, ['a1', 'a3'], { id: 'fin-1', nome: 'FINANCEIRO TESTE' }, '2026-09-17T15:00:00.000Z');
    expect(marcadas[0]).toMatchObject({
      erp_atualizado_em: '2026-09-17T15:00:00.000Z',
      erp_atualizado_por: 'fin-1',
      erp_atualizado_por_nome: 'FINANCEIRO TESTE',
      erp_atualizado_via: 'app',
    });
    expect(marcadas[1]).toEqual(lista[1]); // não confirmada: segue pendente
    expect(marcadas[2]).toEqual(lista[2]); // já resolvida pela API: não é reescrita
    expect(separarAlteracoes(marcadas).pendentes.map((a) => a.id)).toEqual(['a2']);
  });

  it('a ficha não relê pelo `carregar` (que vira a tela de erro): falhando, marca no cartão e avisa', () => {
    const ficha = lerDoRepo('apps/web/src/modules/clientes/PaginaCliente.tsx');
    const inicio = ficha.indexOf('const confirmarNoControl = async (ids: string[]) => {');
    const fim = ficha.indexOf('if (erro) {', inicio);
    const confirmar = ficha.slice(inicio, fim);
    expect(inicio).toBeGreaterThan(-1);
    expect(confirmar).not.toMatch(/carregar\(\)/);
    expect(confirmar).not.toMatch(/setErro\(/);
    expect(confirmar).toMatch(/marcarConfirmadasNaFicha\(c\.alteracoes \?\? \[\], confirmadas, quem, em\)/);
    expect(confirmar).toMatch(/Não deu para recarregar a ficha/);
  });
});

describe('a ficha não apaga o que está sendo digitado quando o cadastro é relido (revisão de 17/09/2026)', () => {
  it('motivo e título da visita voltam ao cadastro só quando o que eles mostram muda — nunca por qualquer troca do objeto', () => {
    const ficha = lerDoRepo('apps/web/src/modules/clientes/PaginaCliente.tsx');
    // Nenhum efeito preso ao objeto `cliente` inteiro reescreve o formulário.
    expect(ficha).not.toMatch(/setMotivo\(cliente\.inactivity_reason \?\? ''\)/);
    expect(ficha).not.toMatch(/\}, \[cliente\]\);/);
    expect(ficha).toMatch(
      /useEffect\(\(\) => \{\s*if \(!idDoCliente\) return;\s*setMotivo\(motivoGravado\);\s*setObsMotivo\(obsDoMotivoGravada\);\s*\}, \[idDoCliente, motivoGravado, obsDoMotivoGravada\]\);/,
    );
    expect(ficha).toMatch(/if \(idDoCliente && !marcando\) setTituloVisita\(tituloPadraoDaVisita\);\s*\}, \[idDoCliente, tituloPadraoDaVisita, marcando\]\);/);
    expect(ficha).toMatch(/const motivoGravado = cliente\?\.inactivity_reason \?\? '';/);
  });
});

describe('o diálogo enquanto salva (revisão de 17/09/2026)', () => {
  it('todos os campos ficam dentro de um fieldset travado por `salvando`', () => {
    // O que se digitasse durante o "Salvando…" não ia no pedido já enviado, e o
    // 200 fechava o diálogo dizendo "Cadastro salvo".
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    const trava = dialogo.indexOf('<fieldset disabled={salvando}');
    expect(trava).toBeGreaterThan(-1);
    const usos = [...dialogo.matchAll(/\{\.\.\.ligar\(/g)].map((m) => m.index!);
    expect(usos.length).toBeGreaterThanOrEqual(14);
    expect(Math.min(...usos)).toBeGreaterThan(trava);
    // O fechamento da trava é o último </fieldset> e vem depois do último campo.
    expect(dialogo.lastIndexOf('</fieldset>')).toBeGreaterThan(Math.max(...usos));
    expect(dialogo.split('<fieldset').length).toBe(dialogo.split('</fieldset>').length);
  });
});

describe('a linha do endereço que já não era a das peças (revisão de 17/09/2026)', () => {
  it('linhaForaDasPecas: linha diferente das peças conta; a das peças, o legado e a vazia não', () => {
    const atual = valoresDoCliente(cliente());
    expect(linhaForaDasPecas('Rua A, 10 - Centro - Muriaé/MG - CEP 36880-000', atual)).toBe(false);
    expect(linhaForaDasPecas('Avenida Nova, 99 - Bela Vista - Muriaé/MG - CEP 36880-000', atual)).toBe(true);
    expect(linhaForaDasPecas(null, atual)).toBe(false);
    const legado = valoresDoCliente(cliente({ logradouro: null, numero: null, bairro: null }));
    expect(linhaForaDasPecas('R A 10 CENTRO', legado)).toBe(false);
  });

  it('o cartão mostra a linha marcada mesmo com peça mudada — a troca de rua não fica escondida', () => {
    const linhas = linhasDaAlteracao({
      campos: {
        complemento: { antes: null, depois: 'Sala 2' },
        address: {
          antes: 'Avenida Nova, 99 - Bela Vista - Juiz de Fora/MG - CEP 36000-000',
          depois: 'Rua Ficticia, 10 Sala 2 - Centro - Juiz de Fora/MG - CEP 36000-000',
          linha_fora_das_pecas: true,
        },
      },
    });
    expect(linhas.map((l) => [l.rotulo, l.antes, l.depois])).toEqual([
      ['Complemento', '(vazio)', 'Sala 2'],
      [
        'Endereço completo',
        'Avenida Nova, 99 - Bela Vista - Juiz de Fora/MG - CEP 36000-000',
        'Rua Ficticia, 10 Sala 2 - Centro - Juiz de Fora/MG - CEP 36000-000',
      ],
    ]);
  });

  it('o diálogo mostra a linha do cadastro quando ela não bate com os campos', () => {
    const dialogo = lerDoRepo('apps/web/src/components/comercial/EditarCadastroDoCliente.tsx');
    expect(dialogo).toMatch(/const linhaDiferenteDosCampos = !enderecoLegado && linhaForaDasPecas\(base\.address, atual\);/);
    expect(dialogo).toMatch(/\{linhaDiferenteDosCampos && \(/);
  });
});

describe('fichaDoConflito — o 409 MUDOU_DE_NOVO já traz a ficha de agora', () => {
  it('a ficha do mesmo cliente vem da resposta, sem segunda ida ao servidor', () => {
    const agora = cliente({ whatsapp: '32977770000' });
    const e = erroDaApi('MUDOU_DE_NOVO', { error: 'Alguém alterou', campos: ['whatsapp'], data: agora });
    expect(fichaDoConflito(e, agora.id)).toEqual(agora);
  });

  it('sem ficha (a releitura falhou na API), ficha de outro cliente ou erro sem corpo: null — a tela relê pelo GET', () => {
    const id = cliente().id;
    expect(fichaDoConflito(erroDaApi('MUDOU_DE_NOVO', { data: null }), id)).toBeNull();
    expect(fichaDoConflito(erroDaApi('MUDOU_DE_NOVO', { data: cliente({ id: 'outro' }) }), id)).toBeNull();
    expect(fichaDoConflito(new Error('HTTP 409'), id)).toBeNull();
    expect(fichaDoConflito('qualquer coisa', id)).toBeNull();
  });
});

describe('errosDoServidorNaEdicao — o 400 da API vai para baixo de cada campo', () => {
  it('só campos editáveis com frase', () => {
    const e = erroDaApi('VALIDATION_ERROR', {
      error: 'Número é obrigatório',
      campos: { numero: 'Número é obrigatório', bairro: 'Bairro é obrigatório', erp_id: 'x', cidade: '' },
    });
    expect(errosDoServidorNaEdicao(e)).toEqual({ numero: 'Número é obrigatório', bairro: 'Bairro é obrigatório' });
  });

  it('400 do schema (sem `campos`) ou `campos` em lista (o do 409): nenhum erro por campo — cai na mensagem geral', () => {
    expect(errosDoServidorNaEdicao(erroDaApi('VALIDATION_ERROR', { error: 'Faltou o valor que estava na tela' }))).toEqual(
      {},
    );
    expect(errosDoServidorNaEdicao(erroDaApi('MUDOU_DE_NOVO', { campos: ['whatsapp'] }))).toEqual({});
    expect(errosDoServidorNaEdicao(new TypeError('Load failed'))).toEqual({});
  });
});

describe('o cartão "Para atualizar no Control"', () => {
  it('pendente é: cliente já no Control e ninguém deu baixa', () => {
    expect(alteracaoPendente(alteracao())).toBe(true);
    expect(alteracaoPendente(alteracao({ erp_atualizado_em: '2026-09-17T15:00:00Z' }))).toBe(false);
    expect(alteracaoPendente(alteracao({ erp_pendente: false }))).toBe(false);
  });

  it('separa pendentes e histórico mantendo a ordem', () => {
    const lista = [
      alteracao({ id: 'p2' }),
      alteracao({ id: 'r1', erp_atualizado_em: '2026-09-17T15:00:00Z', erp_atualizado_via: 'app' }),
      alteracao({ id: 'p1' }),
      alteracao({ id: 'n1', erp_pendente: false }),
    ];
    const { pendentes, resolvidas } = separarAlteracoes(lista);
    expect(pendentes.map((a) => a.id)).toEqual(['p2', 'p1']);
    expect(resolvidas.map((a) => a.id)).toEqual(['r1', 'n1']);
  });

  it('um campo por linha, com máscara; a linha única do endereço não se repete quando uma peça mudou', () => {
    const linhas = linhasDaAlteracao({
      campos: {
        address: { antes: 'Rua A, 10 - Centro', depois: 'Rua A, 120 - Centro' },
        numero: { antes: '10', depois: '120' },
        cnpj: { antes: CNPJ, depois: '11444777000161' },
        email: { antes: null, depois: 'loja@exemplo.com' },
      },
    });
    expect(linhas.map((l) => [l.rotulo, l.antes, l.depois])).toEqual([
      ['CPF/CNPJ', '11.222.333/0001-81', '11.444.777/0001-61'],
      ['E-mail', '(vazio)', 'loja@exemplo.com'],
      ['Número', '10', '120'],
    ]);
  });

  // ─── O campo que uma edição mais nova já trocou (revisão de 17/09/2026) ────
  //
  // E1 (10:00): WhatsApp A→B e e-mail X→Y. E2 (10:05): WhatsApp B→C. O app
  // está com C. O cartão é "a lista do que digitar": mostrar o B de E1 como
  // valor a pôr no Control fazia o financeiro digitar um valor vencido — e a
  // baixa de E1 soltava a coluna para o próximo envio do Control gravar B por
  // cima do C do app, sem aviso.
  const A = '32999990000';
  const B = '32988880000';
  const C = '32977770000';
  const e1 = (extra: Partial<AlteracaoDoCliente> = {}) =>
    alteracao({
      id: 'e1',
      alterado_em: '2026-09-17T10:00:00.000Z',
      campos: { whatsapp: { antes: A, depois: B }, email: { antes: 'x@exemplo.invalid', depois: 'y@exemplo.invalid' } },
      ...extra,
    });
  const e2 = (extra: Partial<AlteracaoDoCliente> = {}) =>
    alteracao({ id: 'e2', alterado_em: '2026-09-17T10:05:00.000Z', campos: { whatsapp: { antes: B, depois: C } }, ...extra });

  it('a edição mais nova do mesmo campo já RESOLVIDA pelo Control: a linha da pendente sai superada, com o valor que vale', () => {
    const resolvida = e2({ erp_atualizado_em: '2026-09-17T10:30:00.000Z', erp_atualizado_via: 'api' });
    const todas = [resolvida, e1()]; // como a API manda: das mais novas para as mais antigas
    expect(pendentesNaOrdemDeDigitar(todas).map((a) => a.id)).toEqual(['e1']);

    const [whatsapp, email] = linhasDaAlteracao(e1(), todas);
    expect(whatsapp).toMatchObject({ campo: 'whatsapp', antes: A, depois: B, superada: { depois: C, em: '2026-09-17T10:05:00.000Z' } });
    expect(email).toMatchObject({ campo: 'email', depois: 'y@exemplo.invalid' });
    expect(email!.superada).toBeUndefined();
    expect(notaDaLinhaSuperada(whatsapp!, () => '17/09/2026 07:05')).toBe(
      `Mudou de novo em 17/09/2026 07:05: no Control vale ${C}, não ${B}.`,
    );
    expect(notaDaLinhaSuperada(email!)).toBeNull();
  });

  it('as duas pendentes: o cartão vem na ordem de digitar (mais antiga primeiro) e a linha vencida sai marcada', () => {
    const todas = [e2(), e1()];
    const cartao = pendentesNaOrdemDeDigitar(todas);
    expect(cartao.map((a) => a.id)).toEqual(['e1', 'e2']);
    expect(linhasDaAlteracao(cartao[0]!, todas).find((l) => l.campo === 'whatsapp')!.superada?.depois).toBe(C);
    // A mais nova não é superada por ninguém.
    expect(linhasDaAlteracao(cartao[1]!, todas).every((l) => l.superada === undefined)).toBe(true);
    // A mesma hora: o id desempata, como na API.
    const mesmaHora = [alteracao({ id: 'b', alterado_em: '2026-09-17T10:00:00.000Z' }), alteracao({ id: 'a', alterado_em: '2026-09-17T10:00:00.000Z' })];
    expect(pendentesNaOrdemDeDigitar(mesmaHora).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('a mais nova levou o campo de VOLTA ao mesmo valor: nada a marcar; sem a lista, nada muda', () => {
    const volta = alteracao({ id: 'e3', alterado_em: '2026-09-17T11:00:00.000Z', campos: { whatsapp: { antes: C, depois: B } } });
    const todas = [volta, e2(), e1()];
    expect(linhasDaAlteracao(e1(), todas).every((l) => l.superada === undefined)).toBe(true);
    // Sem a lista (o histórico recolhido), as linhas são as de sempre.
    expect(linhasDaAlteracao(e1()).every((l) => l.superada === undefined)).toBe(true);
  });

  it('o cartão usa a ordem de digitar e passa a lista inteira para marcar as linhas vencidas', () => {
    const cartao = lerDoRepo('apps/web/src/components/comercial/AlteracoesParaOControl.tsx');
    expect(cartao).toMatch(/const pendentes = useMemo\(\(\) => pendentesNaOrdemDeDigitar\(alteracoes\), \[alteracoes\]\);/);
    expect(cartao).toMatch(/<CamposDaAlteracao alteracao=\{a\} todas=\{alteracoes\}/);
    expect(cartao).toMatch(/linhasDaAlteracao\(alteracao, todas\)/);
    expect(cartao).toMatch(/const nota = notaDaLinhaSuperada\(l\);/);
    // A baixa continua sendo só do que está na tela.
    expect(cartao).toMatch(/onConfirmar\(pendentes\.map\(\(a\) => a\.id\)\)/);
  });

  it('só a linha do endereço (sem peça): ela aparece', () => {
    const linhas = linhasDaAlteracao({ campos: { address: { antes: 'X', depois: 'Y' } } });
    expect(linhas.map((l) => l.rotulo)).toEqual(['Endereço completo']);
  });

  it('quem e quando; sem nome gravado, "Alguém"', () => {
    const f = () => '17/09/2026 11:30';
    expect(autoriaDaAlteracao(alteracao(), f)).toBe('Pessoa Teste · 17/09/2026 11:30');
    expect(autoriaDaAlteracao(alteracao({ alterado_por_nome: null }), f)).toBe('Alguém · 17/09/2026 11:30');
  });

  it('como a alteração terminou', () => {
    const f = () => '17/09/2026 12:00';
    const feita = { erp_atualizado_em: '2026-09-17T15:00:00Z' };
    expect(situacaoDaAlteracao(alteracao(), f)).toBe('Esperando atualizar no Control');
    expect(situacaoDaAlteracao(alteracao({ erp_pendente: false }), f)).toMatch(/ainda não estava no Control/);
    expect(
      situacaoDaAlteracao(alteracao({ ...feita, erp_atualizado_via: 'app', erp_atualizado_por_nome: 'Quem Confirmou' }), f),
    ).toBe('Atualizado no Control por Quem Confirmou em 17/09/2026 12:00');
    expect(situacaoDaAlteracao(alteracao({ ...feita, erp_atualizado_via: 'api' }), f)).toBe(
      'Atualizado pelo Control automaticamente em 17/09/2026 12:00',
    );
    expect(situacaoDaAlteracao(alteracao({ ...feita, erp_atualizado_via: 'app' }), f)).toBe(
      'Atualizado no Control em 17/09/2026 12:00',
    );
  });
});

describe('Já atualizei no Control', () => {
  it('os ids vão em lotes de até 50 (o limite da rota)', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);
    const lotes = emLotesDeConfirmacao(ids);
    expect(lotes.map((l) => l.length)).toEqual([50, 50, 20]);
    expect(lotes.flat()).toEqual(ids);
    expect(emLotesDeConfirmacao([])).toEqual([]);
  });

  it('a frase diz quando parte já estava em dia e quando chegou alteração nova', () => {
    const resolvida = alteracao({ erp_atualizado_em: '2026-09-17T15:00:00Z', erp_atualizado_via: 'app' });
    expect(avisoDaConfirmacao(2, 2, [resolvida])).toBe('Marcado como atualizado no Control.');
    expect(avisoDaConfirmacao(2, 1, [resolvida])).toBe('1 de 2 marcadas — as outras já estavam em dia.');
    expect(avisoDaConfirmacao(1, 0, [resolvida])).toMatch(/já estava em dia/);
    expect(avisoDaConfirmacao(1, 1, [resolvida, alteracao({ id: 'nova' })])).toMatch(/Chegou alteração nova/);
    expect(avisoDaConfirmacao(1, 1, null)).toBe('Marcado como atualizado no Control.');
  });
});
