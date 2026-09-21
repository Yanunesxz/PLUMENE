import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { montarEdicaoDoCadastro, validarEdicaoDoCadastro } from '@csb/shared';
import {
  AVISO_DO_CEP_SEM_INTERNET,
  abortarEm,
  avisoDaConsultaDeCep,
  consultarViaCep,
  criarConsultaDeCep,
  precisaConferirOCepAntesDeSalvar,
  preencherComOCep,
  saidaDoCep,
  voltarAoEnderecoDoCadastro,
  type Buscador,
  type RespostaDoCep,
} from '../apps/web/src/lib/viaCep.js';

/**
 * A consulta de CEP (ViaCEP), tirada do cadastro novo para servir também a
 * edição do cadastro (17/09/2026).
 *
 * O que estes testes trancam:
 *   • o corte de tempo funciona sem `AbortSignal.timeout` (iPhone no iOS 15);
 *   • CEP inválido não sai do aparelho; `erro` do ViaCEP vira "não encontrado";
 *     rede fora vira "falhou" — nunca uma exceção na tela;
 *   • a resposta de um CEP ANTIGO é jogada fora;
 *   • o CEP nunca apaga o que a pessoa digitou.
 */

const respondeCom =
  (corpo: unknown): Buscador =>
  async () => ({ json: async () => corpo });

describe('abortarEm', () => {
  const original = AbortSignal.timeout;
  afterEach(() => {
    (AbortSignal as { timeout?: typeof AbortSignal.timeout }).timeout = original;
    vi.useRealTimers();
  });

  it('usa AbortSignal.timeout quando existe', () => {
    const sinal = abortarEm(1000);
    expect(sinal).not.toBeNull();
    expect(sinal?.aborted).toBe(false);
  });

  it('sem AbortSignal.timeout (Safari 15), corta com AbortController e setTimeout', () => {
    vi.useFakeTimers();
    (AbortSignal as { timeout?: typeof AbortSignal.timeout }).timeout = undefined;
    const sinal = abortarEm(6000);
    expect(sinal).not.toBeNull();
    expect(sinal?.aborted).toBe(false);
    vi.advanceTimersByTime(6000);
    expect(sinal?.aborted).toBe(true);
  });
});

describe('consultarViaCep', () => {
  it('CEP inválido não consulta ninguém', async () => {
    const buscar = vi.fn(respondeCom({}));
    expect(await consultarViaCep('3600', buscar)).toEqual({ situacao: 'nao_encontrado' });
    expect(await consultarViaCep('00000-000', buscar)).toEqual({ situacao: 'nao_encontrado' });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('consulta pelos dígitos e traduz localidade para cidade, com UF maiúscula', async () => {
    const buscar = vi.fn(
      respondeCom({ logradouro: ' Rua das Flores ', bairro: 'Centro', localidade: 'Juiz de Fora', uf: 'mg' }),
    );
    const r = await consultarViaCep('36.000-000', buscar);
    expect(buscar).toHaveBeenCalledWith('https://viacep.com.br/ws/36000000/json/', expect.anything());
    expect(r).toEqual({
      situacao: 'encontrado',
      endereco: { logradouro: 'Rua das Flores', bairro: 'Centro', cidade: 'Juiz de Fora', uf: 'MG' },
    });
  });

  it('manda um sinal de corte de tempo junto', async () => {
    const buscar = vi.fn(respondeCom({ uf: 'MG' }));
    await consultarViaCep('36000000', buscar);
    const init = buscar.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('"erro": true (ou "true") do ViaCEP é CEP que não existe', async () => {
    expect(await consultarViaCep('36000000', respondeCom({ erro: true }))).toEqual({ situacao: 'nao_encontrado' });
    expect(await consultarViaCep('36000000', respondeCom({ erro: 'true' }))).toEqual({ situacao: 'nao_encontrado' });
  });

  it('rede fora, corte de tempo ou resposta estranha viram "falhou" — nunca exceção', async () => {
    const semRede: Buscador = async () => {
      throw new TypeError('Load failed');
    };
    expect(await consultarViaCep('36000000', semRede)).toEqual({ situacao: 'falhou' });
    expect(await consultarViaCep('36000000', respondeCom(null))).toEqual({ situacao: 'falhou' });
    const jsonQuebrado: Buscador = async () => ({
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    expect(await consultarViaCep('36000000', jsonQuebrado)).toEqual({ situacao: 'falhou' });
  });
});

describe('criarConsultaDeCep', () => {
  const achou = (logradouro: string): RespostaDoCep => ({
    situacao: 'encontrado',
    endereco: { logradouro, bairro: '', cidade: '', uf: '' },
  });

  it('a resposta de um CEP antigo que chega DEPOIS do novo vai para o lixo', async () => {
    let soltarPrimeira: (r: RespostaDoCep) => void = () => {};
    const consultar = vi.fn((cep: string) =>
      cep === '36000000'
        ? new Promise<RespostaDoCep>((resolve) => {
            soltarPrimeira = resolve;
          })
        : Promise.resolve(achou('Rua do CEP novo')),
    );
    const fila = criarConsultaDeCep(consultar);

    const primeira = fila.consultar('36000-000');
    const segunda = await fila.consultar('36010-000');
    soltarPrimeira(achou('Rua do CEP antigo'));

    expect(segunda).toEqual(achou('Rua do CEP novo'));
    expect(await primeira).toBeNull();
  });

  it('mexer no CEP (esquecer) descarta o que estava em voo', async () => {
    let soltar: (r: RespostaDoCep) => void = () => {};
    const fila = criarConsultaDeCep(
      () =>
        new Promise<RespostaDoCep>((resolve) => {
          soltar = resolve;
        }),
    );
    const emVoo = fila.consultar('36000000');
    fila.esquecer();
    soltar(achou('Rua qualquer'));
    expect(await emVoo).toBeNull();
  });

  it('pedido único volta com a resposta', async () => {
    const fila = criarConsultaDeCep(async () => ({ situacao: 'falhou' }));
    expect(await fila.consultar('36000000')).toEqual({ situacao: 'falhou' });
  });
});

describe('preencherComOCep', () => {
  const doCep = { logradouro: 'Rua Nova', bairro: 'Centro', cidade: 'Muriaé', uf: 'MG' };

  it('preenche só o que está vazio — o que a pessoa digitou fica', () => {
    const form = { logradouro: 'Av. que eu digitei', bairro: '  ', cidade: '', uf: '', numero: '12' };
    expect(preencherComOCep(form, doCep)).toEqual({
      logradouro: 'Av. que eu digitei',
      bairro: 'Centro',
      cidade: 'Muriaé',
      uf: 'MG',
      numero: '12',
    });
  });

  it('com podeTrocar, troca o que veio do cadastro (endereço do CEP antigo)', () => {
    const form = { logradouro: 'Rua Velha', bairro: 'Bairro Velho', cidade: 'Cataguases', uf: 'MG' };
    const digitados = new Set(['bairro']);
    expect(preencherComOCep(form, doCep, (c) => !digitados.has(c))).toEqual({
      logradouro: 'Rua Nova',
      bairro: 'Bairro Velho',
      cidade: 'Muriaé',
      uf: 'MG',
    });
  });

  it('CEP geral de cidade (sem rua nem bairro) nunca apaga nada', () => {
    const form = { logradouro: 'Rua Velha', bairro: 'Bairro Velho', cidade: '', uf: '' };
    const cepGeral = { logradouro: '', bairro: '', cidade: 'Muriaé', uf: 'MG' };
    expect(preencherComOCep(form, cepGeral, () => true)).toEqual({
      logradouro: 'Rua Velha',
      bairro: 'Bairro Velho',
      cidade: 'Muriaé',
      uf: 'MG',
    });
  });

  it('sem nada a preencher devolve o mesmo objeto (o React não re-renderiza à toa)', () => {
    const form = { logradouro: 'Rua Nova', bairro: 'Centro', cidade: 'Muriaé', uf: 'MG' };
    expect(preencherComOCep(form, doCep, () => true)).toBe(form);
  });
});

describe('voltarAoEnderecoDoCadastro — o CEP trocado e depois devolvido ao do cadastro (revisão de 17/09/2026)', () => {
  const doCadastro = { logradouro: 'Rua A', bairro: 'Centro', cidade: 'Muriaé', uf: 'MG' };
  const deBH = { logradouro: 'Avenida Afonso Pena', bairro: 'Centro', cidade: 'Belo Horizonte', uf: 'MG' };

  it('o engano desfeito: a rua e a cidade do CEP descartado voltam às do cadastro', () => {
    const nada = new Set<string>();
    // 36880-000 → 30130-000: a consulta troca o endereço (nada foi digitado).
    const comBH = preencherComOCep(doCadastro, deBH, (c) => !nada.has(c));
    expect(comBH).toEqual(deBH);
    // 30130-000 → 36880-000 de novo: sem isto ficava CEP de Muriaé com rua de BH.
    expect(voltarAoEnderecoDoCadastro(comBH, doCadastro, (c) => nada.has(c))).toEqual(doCadastro);
  });

  it('o que a pessoa digitou depois da consulta fica', () => {
    const digitados = new Set<string>(['logradouro']);
    const form = { ...deBH, logradouro: 'Rua que eu digitei' };
    expect(voltarAoEnderecoDoCadastro(form, doCadastro, (c) => digitados.has(c))).toEqual({
      logradouro: 'Rua que eu digitei',
      bairro: 'Centro',
      cidade: 'Muriaé',
      uf: 'MG',
    });
  });

  it('já igual ao cadastro devolve o mesmo objeto', () => {
    const form = { ...doCadastro };
    expect(voltarAoEnderecoDoCadastro(form, doCadastro, () => false)).toBe(form);
  });

  it('o diálogo decide a saída do CEP por `saidaDoCep` e guarda de onde veio o preenchimento', () => {
    // A decisão (voltar? consultar?) mora em `saidaDoCep`, testada abaixo como o
    // diálogo a usa. Aqui, só que o diálogo a usa assim.
    const dialogo = readFileSync(
      path.resolve(__dirname, '..', 'apps/web/src/components/comercial/EditarCadastroDoCliente.tsx'),
      'utf8',
    );
    const inicio = dialogo.indexOf('const aoSairDoCep = async (): Promise<ResultadoDaSaidaDoCep> => {');
    expect(inicio).toBeGreaterThan(-1);
    const fim = dialogo.indexOf('const guardarNaLista', inicio);
    const corpo = dialogo.slice(inicio, fim);
    expect(corpo).toMatch(/const saida = saidaDoCep\(estado\);/);
    expect(corpo).toMatch(/cepDoPreenchimento\.current = saida\.cepDoPreenchimento;/);
    expect(corpo).toMatch(
      /saida\.voltou \? voltarAoEnderecoDoCadastro\(f, estado\.doCadastro, estado\.digitado\) : f/,
    );
    // Só a consulta que ACHOU diz de onde vieram os campos.
    const achou = corpo.indexOf("if (r.situacao === 'encontrado') {");
    expect(corpo.indexOf('cepDoPreenchimento.current = digitos;', achou)).toBeGreaterThan(achou);
    expect(corpo).toMatch(/preencherComOCep\(f, r\.endereco, \(c\) => saida\.cepMudou && !digitados\.current\.has\(c\)\)/);
  });
});

// ─── A saída do campo, como o diálogo a faz ──────────────────────────────────

type FormDoCep = Record<'cep' | 'logradouro' | 'numero' | 'bairro' | 'cidade' | 'uf', string>;

/**
 * O diálogo de edição sem o navegador: o formulário, os campos digitados, o
 * último CEP consultado e o CEP do preenchimento — os mesmos passos de
 * `aoSairDoCep` e de `mudar` em EditarCadastroDoCliente.tsx.
 */
function dialogoDeCep(cadastro: FormDoCep, viaCep: (cep: string) => RespostaDoCep, online = true) {
  let form: FormDoCep = { ...cadastro };
  const digitados = new Set<string>();
  let cepConsultado = '';
  let cepDoPreenchimento = '';
  let consultas = 0;
  const estado = () => ({
    form,
    cepDoCadastro: cadastro.cep,
    doCadastro: { logradouro: cadastro.logradouro, bairro: cadastro.bairro, cidade: cadastro.cidade, uf: cadastro.uf },
    digitado: (c: string) => digitados.has(c),
    cepConsultado,
    cepDoPreenchimento,
    online,
  });
  return {
    get form() {
      return form;
    },
    get consultas() {
      return consultas;
    },
    estado,
    ficarOnline() {
      online = true;
    },
    digitar(campo: keyof FormDoCep, valor: string) {
      digitados.add(campo);
      form = { ...form, [campo]: valor };
      if (campo === 'cep') cepConsultado = '';
    },
    sair() {
      const saida = saidaDoCep(estado());
      cepDoPreenchimento = saida.cepDoPreenchimento;
      form = saida.form;
      if (!saida.consultar) return saida;
      cepConsultado = saida.consultar;
      consultas++;
      const r = viaCep(saida.consultar);
      if (r.situacao === 'encontrado') {
        cepDoPreenchimento = saida.consultar;
        form = preencherComOCep(form, r.endereco, (c) => saida.cepMudou && !digitados.has(c));
      } else if (r.situacao === 'falhou') cepConsultado = '';
      return saida;
    },
  };
}

const JUIZ_DE_FORA: RespostaDoCep = {
  situacao: 'encontrado',
  endereco: { logradouro: 'Rua Halfeld', bairro: 'Centro', cidade: 'Juiz de Fora', uf: 'MG' },
};
const SAO_PAULO: RespostaDoCep = {
  situacao: 'encontrado',
  endereco: { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' },
};

describe('saidaDoCep — a volta ao endereço do cadastro só desfaz a consulta de OUTRO CEP (revisão de 17/09/2026)', () => {
  it('cadastro sem rua e bairro: a segunda saída do CEP NÃO apaga o que a consulta do próprio CEP preencheu', () => {
    const parcial: FormDoCep = { cep: '36000-000', logradouro: '', numero: '', bairro: '', cidade: 'Juiz de Fora', uf: 'MG' };
    const d = dialogoDeCep(parcial, () => JUIZ_DE_FORA);

    d.sair();
    expect(d.form).toMatchObject({ logradouro: 'Rua Halfeld', bairro: 'Centro' });
    d.digitar('numero', '10');
    d.sair();
    d.sair();

    // Antes: rua e bairro voltavam a "" (o vazio do cadastro), a consulta não
    // voltava e o Salvar acusava os dois obrigatórios.
    expect(d.form).toMatchObject({ logradouro: 'Rua Halfeld', bairro: 'Centro', numero: '10', cidade: 'Juiz de Fora' });
    expect(d.consultas).toBe(1);
  });

  it('o engano desfeito continua valendo: CEP trocado e devolvido volta rua e cidade às do cadastro', () => {
    const completo: FormDoCep = { cep: '36880-000', logradouro: 'Rua A', numero: '12', bairro: 'Centro', cidade: 'Muriaé', uf: 'MG' };
    const d = dialogoDeCep(completo, () => SAO_PAULO);

    d.digitar('cep', '01310-100');
    d.sair();
    expect(d.form).toMatchObject({ logradouro: 'Avenida Paulista', cidade: 'São Paulo', uf: 'SP' });
    d.digitar('cep', '36880-000');
    const saida = d.sair();

    expect(saida.voltou).toBe(true);
    expect(d.form).toMatchObject({ logradouro: 'Rua A', bairro: 'Centro', cidade: 'Muriaé', uf: 'MG' });
    expect(saida.cepDoPreenchimento).toBe('');
    expect(d.consultas).toBe(1);
    // Sair de novo não volta nada.
    expect(d.sair().voltou).toBe(false);
  });

  it('cliente legado (sem CEP no cadastro): apagar o CEP depois da consulta desfaz o endereço que ela pôs — a edição do WhatsApp salva (revisão de 17/09/2026)', () => {
    // Só a linha `address`: as peças são vazias. A pessoa digita um CEP, a
    // consulta preenche rua, bairro, cidade e UF, e ela desiste apagando o CEP.
    const legado: FormDoCep = { cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '' };
    const d = dialogoDeCep(legado, () => JUIZ_DE_FORA);
    d.digitar('cep', '36000-000');
    d.sair();
    expect(d.form).toMatchObject({ logradouro: 'Rua Halfeld', bairro: 'Centro', cidade: 'Juiz de Fora', uf: 'MG' });

    d.digitar('cep', '');
    const saida = d.sair();

    // Antes: nada voltava (CEP vazio não é "válido") e o Salvar cobrava CEP e
    // número numa edição que era só do WhatsApp.
    expect(saida.voltou).toBe(true);
    expect(saida.consultar).toBeNull();
    expect(saida.cepDoPreenchimento).toBe('');
    expect(d.form).toEqual(legado);
    const edicao = montarEdicaoDoCadastro(
      { whatsapp: '32999990000', cep: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null },
      { ...d.form, whatsapp: '32988880000' },
    );
    expect(edicao.novo).toEqual({ whatsapp: '32988880000' });
    expect(Object.keys(validarEdicaoDoCadastro({ whatsapp: '32999990000' }, edicao.novo))).toEqual([]);
    // O que a pessoa DIGITOU fica — a volta só desfaz a consulta.
    const e = dialogoDeCep(legado, () => JUIZ_DE_FORA);
    e.digitar('cep', '36000-000');
    e.sair();
    e.digitar('bairro', 'Bairro Digitado');
    e.digitar('cep', '');
    e.sair();
    expect(e.form).toMatchObject({ logradouro: '', cidade: '', uf: '', bairro: 'Bairro Digitado' });
    // CEP apagado com o cadastro TENDO CEP: é CEP mudado, não volta (a régua pede o CEP).
    const completo: FormDoCep = { cep: '36880-000', logradouro: 'Rua A', numero: '12', bairro: 'Centro', cidade: 'Muriaé', uf: 'MG' };
    const f = dialogoDeCep(completo, () => SAO_PAULO);
    f.digitar('cep', '');
    expect(f.sair()).toMatchObject({ voltou: false, cepMudou: true });
  });
});

describe('precisaConferirOCepAntesDeSalvar — o CEP que a consulta não viu (revisão de 17/09/2026)', () => {
  const completo: FormDoCep = { cep: '36880-000', logradouro: 'Rua Coronel Domiciano', numero: '12', bairro: 'Centro', cidade: 'Muriaé', uf: 'MG' };

  it('Enter dentro do CEP (sem sair do campo): o Salvar para e consulta; depois da consulta, segue', () => {
    const d = dialogoDeCep(completo, () => SAO_PAULO);
    d.digitar('cep', '01310-100');

    // Antes: o PATCH saía só com o CEP, e a rua e a cidade de Muriaé ficavam.
    expect(precisaConferirOCepAntesDeSalvar(saidaDoCep(d.estado()), '')).toBe(true);
    d.sair(); // o que o Salvar faz antes de parar
    expect(d.form).toMatchObject({ logradouro: 'Avenida Paulista', cidade: 'São Paulo' });
    expect(precisaConferirOCepAntesDeSalvar(saidaDoCep(d.estado()), '01310100')).toBe(false);
  });

  it('CEP trocado sem internet: a saída avisa; com a rede de volta, o Salvar consulta antes de mandar', () => {
    const d = dialogoDeCep(completo, () => SAO_PAULO, false);
    d.digitar('cep', '01310-100');

    const semRede = d.sair();
    expect(semRede.consultar).toBeNull();
    expect(semRede.aviso).toBe(AVISO_DO_CEP_SEM_INTERNET);
    expect(d.form.logradouro).toBe('Rua Coronel Domiciano');

    d.ficarOnline();
    expect(precisaConferirOCepAntesDeSalvar(saidaDoCep(d.estado()), '')).toBe(true);
  });

  it('a consulta que falhou por rede não trava o Salvar: a segunda vez segue (a pessoa leu "digite na mão")', () => {
    const d = dialogoDeCep(completo, () => ({ situacao: 'falhou' }));
    d.digitar('cep', '01310-100');
    d.sair();
    expect(precisaConferirOCepAntesDeSalvar(saidaDoCep(d.estado()), '')).toBe(true);
    expect(precisaConferirOCepAntesDeSalvar(saidaDoCep(d.estado()), '01310100')).toBe(false);
  });

  it('CEP de sempre com rua vazia no cadastro: o Salvar NÃO consulta (não põe endereço numa edição só do WhatsApp)', () => {
    const parcial: FormDoCep = { ...completo, logradouro: '', bairro: '' };
    const d = dialogoDeCep(parcial, () => JUIZ_DE_FORA);
    // (a pessoa mexeu só no WhatsApp, que não entra na conta do CEP)
    expect(saidaDoCep(d.estado()).consultar).toBe('36880000');
    expect(precisaConferirOCepAntesDeSalvar(saidaDoCep(d.estado()), '')).toBe(false);
  });

  it('CEP devolvido ao do cadastro por Enter, com a rua de outro CEP ainda nos campos: o Salvar para e volta', () => {
    const d = dialogoDeCep(completo, () => SAO_PAULO);
    d.digitar('cep', '01310-100');
    d.sair();
    d.digitar('cep', '36880-000'); // e Enter, sem sair do campo
    expect(precisaConferirOCepAntesDeSalvar(saidaDoCep(d.estado()), '')).toBe(true);
  });

  it('o diálogo confere o CEP no Salvar antes de validar e de mandar', () => {
    const dialogo = readFileSync(
      path.resolve(__dirname, '..', 'apps/web/src/components/comercial/EditarCadastroDoCliente.tsx'),
      'utf8',
    );
    const inicio = dialogo.indexOf('const salvar = async (e: FormEvent) => {');
    const confere = dialogo.indexOf(
      'if (precisaConferirOCepAntesDeSalvar(saidaAgora, cepConferidoAoSalvar.current)) {',
      inicio,
    );
    expect(inicio).toBeGreaterThan(-1);
    expect(confere).toBeGreaterThan(inicio);
    expect(confere).toBeLessThan(dialogo.indexOf('setTentouSalvar(true);', inicio));
    expect(confere).toBeLessThan(dialogo.indexOf('api.patch<EditarCadastroDoClienteResponse>', inicio));
    expect(dialogo.indexOf('const r = await aoSairDoCep();', confere)).toBeGreaterThan(confere);
    // Mexer no CEP de novo libera outra conferência.
    expect(dialogo).toMatch(/cepConsultado\.current = '';\s*cepConferidoAoSalvar\.current = '';/);
  });
});

describe('avisoDaConsultaDeCep', () => {
  it('diz o que fazer quando o CEP não preencheu', () => {
    expect(avisoDaConsultaDeCep({ situacao: 'nao_encontrado' })).toMatch(/não encontrado/);
    expect(avisoDaConsultaDeCep({ situacao: 'falhou' })).toMatch(/digite o endereço na mão/);
    expect(
      avisoDaConsultaDeCep({ situacao: 'encontrado', endereco: { logradouro: '', bairro: '', cidade: '', uf: '' } }),
    ).toBeNull();
  });
});
