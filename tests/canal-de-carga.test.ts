import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { conferirCanalDeCarga, PADRAO_DO_CANAL } from '../_tools/canal-de-carga.mjs';
import { VALORES_DOS_CANAIS, CANAIS_PADRAO } from '../apps/api/src/lib/canais.js';

/**
 * A trava de canal dos scripts de carga do _tools (048).
 *
 * O `faturar-retroativo.mjs` já recusava rodar com `canal_faturamento = 'api'`.
 * Os scripts que gravam cadastro, retrato e catálogo ficaram sem nada: depois
 * que o Yan virar o canal, rodar um deles sem querer sobrescreve o que o
 * Control mandou — e o `tabelas-2027/carregar.mjs` chega a APAGAR as tabelas
 * de preço antigas.
 *
 * O que fica trancado:
 *
 *   1. canal no padrão ('carga'/'manual'), ou banco sem a 048: grava como
 *      sempre — é o comportamento de hoje;
 *   2. canal em 'api' (ou 'firebird'): recusa, dizendo qual coluna e qual
 *      valor;
 *   3. banco que não respondeu: recusa — na dúvida não grava;
 *   4. empresa que não está neste banco: recusa.
 *
 * Os scripts são .mjs que leem o .env e o banco ao serem carregados — não dá
 * para importá-los num teste. A regra mora num módulo sem efeito colateral
 * (_tools/canal-de-carga.mjs), testado aqui; e cada script é conferido por
 * leitura, como já se faz em importar-clientes-regras.test.ts.
 *
 * Empresas e dados fictícios de propósito.
 */

const EMPRESA = 'empresa-ficticia-1';
const OUTRA = 'empresa-ficticia-2';

const linha = (id: string, canais: Record<string, string | null>) => ({ id, ...canais });

const resposta = (data: unknown): RespostaTabela => ({ data, error: null });

const SEM_048: RespostaTabela = {
  data: null,
  error: { code: '42703', message: 'column companies.canal_cadastro does not exist' },
};

const BANCO_MUDO: RespostaTabela = {
  data: null,
  error: { code: '57014', message: 'canceling statement due to statement timeout' },
};

const conferir = (companies: RespostaTabela | RespostaTabela[], opcoes: Record<string, unknown>) => {
  const fake = criarSupabaseFake({ companies });
  return conferirCanalDeCarga(fake.cliente, {
    empresas: EMPRESA,
    canais: ['cadastro'],
    acao: 'A carga de clientes por planilha',
    ...opcoes,
  }) as Promise<string | null>;
};

describe('a trava de canal das cargas do _tools', () => {
  it('canal no padrão: grava — é o comportamento de hoje', async () => {
    expect(await conferir(resposta([linha(EMPRESA, { canal_cadastro: 'carga' })]), {})).toBeNull();
  });

  it('canal virado para a API: recusa, com a coluna e o valor na frase', async () => {
    const recusa = await conferir(resposta([linha(EMPRESA, { canal_cadastro: 'api' })]), {});
    expect(recusa).toContain('canal_cadastro=api');
    expect(recusa).toContain('A carga de clientes por planilha está recusada');
    expect(recusa).toContain('O cadastro desta empresa vem do Control');
  });

  it('canal em firebird também recusa: o que vale é NÃO ser o padrão', async () => {
    expect(await conferir(resposta([linha(EMPRESA, { canal_cadastro: 'firebird' })]), {})).toContain(
      'canal_cadastro=firebird',
    );
  });

  it('todo valor que não é o padrão recusa, em todos os canais', async () => {
    for (const [canal, valores] of Object.entries(VALORES_DOS_CANAIS)) {
      const coluna = `canal_${canal}`;
      for (const valor of valores) {
        const recusa = await conferir(resposta([linha(EMPRESA, { [coluna]: valor })]), {
          canais: [canal],
        });
        if (valor === PADRAO_DO_CANAL[canal as keyof typeof PADRAO_DO_CANAL]) {
          expect(recusa, `${coluna}=${valor}`).toBeNull();
        } else {
          expect(recusa, `${coluna}=${valor}`).toContain(`${coluna}=${valor}`);
        }
      }
    }
  });

  it('sem a 048 no banco (coluna ausente): grava, depois de conferir que a empresa existe', async () => {
    expect(await conferir([SEM_048, resposta([{ id: EMPRESA }])], {})).toBeNull();
  });

  it('sem a 048 e empresa de outro banco: recusa — carga no banco errado estraga igual', async () => {
    expect(await conferir([SEM_048, resposta([])], {})).toContain('Empresa não encontrada');
  });

  it('banco que não respondeu: recusa — na dúvida não grava', async () => {
    const recusa = await conferir(BANCO_MUDO, {});
    expect(recusa).toContain('Falha ao ler o canal da empresa');
    expect(recusa).toContain('statement timeout');
  });

  it('empresa que não está neste banco: recusa', async () => {
    expect(await conferir(resposta([]), {})).toContain('Empresa não encontrada');
  });

  it('coluna que voltou nula (banco sem a 048 de verdade): vale o padrão e grava', async () => {
    expect(await conferir(resposta([linha(EMPRESA, { canal_cadastro: null })]), {})).toBeNull();
  });

  it('script que escreve dois fluxos: basta UM canal virado para recusar', async () => {
    const data = [linha(EMPRESA, { canal_catalogo: 'carga', canal_cadastro: 'api' })];
    const recusa = await conferir(resposta(data), {
      canais: ['catalogo', 'cadastro'],
      acao: 'A troca das tabelas de preço por aqui',
    });
    expect(recusa).toContain('canal_cadastro=api');
    expect(recusa).toContain('A troca das tabelas de preço por aqui está recusada');
  });

  it('script que varre o banco inteiro: basta UMA empresa com o canal virado', async () => {
    const data = [linha(EMPRESA, { canal_catalogo: 'carga' }), linha(OUTRA, { canal_catalogo: 'api' })];
    const recusa = await conferir(resposta(data), {
      empresas: [EMPRESA, OUTRA, EMPRESA], // repetido de propósito: a lista vem de produtos
      canais: ['catalogo'],
      acao: 'A sincronia de catálogo por aqui',
    });
    expect(recusa).toContain('canal_catalogo=api');
  });

  it('varredura em que uma das empresas sumiu do banco: recusa', async () => {
    const recusa = await conferir(resposta([linha(EMPRESA, { canal_catalogo: 'carga' })]), {
      empresas: [EMPRESA, OUTRA],
      canais: ['catalogo'],
    });
    expect(recusa).toContain(OUTRA);
  });

  it('lista de empresa vazia: recusa em vez de deixar passar calado', async () => {
    expect(await conferir(resposta([]), { empresas: [] })).toContain('Nenhuma empresa');
  });

  it('canal que não existe na régua: recusa antes de encostar no banco', async () => {
    expect(await conferir(resposta([]), { canais: ['inventado'] })).toContain('Canal desconhecido');
  });

  it('a consulta é uma só, filtrando as empresas pedidas', async () => {
    const fake = criarSupabaseFake({ companies: resposta([linha(EMPRESA, { canal_catalogo: 'carga' })]) });
    await conferirCanalDeCarga(fake.cliente, {
      empresas: EMPRESA,
      canais: ['catalogo'],
      acao: 'teste',
    });
    const selects = fake.filtrosDe('companies', 'select');
    expect(selects).toHaveLength(1);
    expect(selects[0]!.args[0]).toBe('id, canal_catalogo');
    expect(fake.filtrosDe('companies', 'in')[0]!.args).toEqual(['id', [EMPRESA]]);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('a régua do padrão é a mesma da API (os scripts não importam TypeScript)', () => {
    for (const [canal, padrao] of Object.entries(CANAIS_PADRAO)) {
      expect(PADRAO_DO_CANAL[canal as keyof typeof PADRAO_DO_CANAL], canal).toBe(padrao);
    }
    expect(Object.keys(PADRAO_DO_CANAL).sort()).toEqual(Object.keys(VALORES_DOS_CANAIS).sort());
  });
});

// ─── Os scripts, conferidos por leitura ──────────────────────────────────────

const fonte = (relativo: string) =>
  readFileSync(path.resolve(__dirname, '..', '_tools', relativo), 'utf8');

/** Script → os canais que a trava dele cita. */
const COM_TRAVA: Array<[string, string[]]> = [
  ['importar-clientes.mjs', ['cadastro']],
  ['importar-carteira.mjs', ['cadastro']],
  ['consertar-whatsapp-com-nome.mjs', ['cadastro']],
  ['carregar-historico-abc.mjs', ['retrato']],
  ['conferir-precos-tabela.mjs', ['catalogo']],
  ['catalogo-cores/sincronizar.mjs', ['catalogo']],
  ['tabelas-2027/ajustes-catalogo.mjs', ['catalogo']],
  ['tabelas-2027/carregar-faixa-maior.mjs', ['catalogo']],
  ['tabelas-2027/estoque-provisorio.mjs', ['catalogo']],
  ['tabelas-2027/carregar.mjs', ['catalogo', 'cadastro']],
];

describe('os scripts de carga chamam a trava', () => {
  it.each(COM_TRAVA)('%s cita o canal que o bloqueia', (script, canais) => {
    const texto = fonte(script);
    const subida = script.includes('/') ? '../canal-de-carga.mjs' : './canal-de-carga.mjs';
    expect(texto).toContain(`import { exigirCanalDeCarga } from '${subida}';`);
    expect(texto).toMatch(/await exigirCanalDeCarga\(/);
    for (const canal of canais) expect(texto).toContain(`'${canal}'`);
    // O cabeçalho conta qual canal tranca, para quem abre o arquivo saber.
    expect(texto).toContain('TRAVA (048)');
  });

  it('a trava vem ANTES da primeira gravação de cada script', () => {
    for (const [script] of COM_TRAVA) {
      const texto = fonte(script);
      const trava = texto.indexOf('await exigirCanalDeCarga(');
      const gravacao = texto.search(/\.(insert|upsert|update|delete)\(/);
      expect(trava, script).toBeGreaterThan(0);
      if (gravacao >= 0) expect(trava, script).toBeLessThan(gravacao);
    }
  });

  it('faturar-retroativo.mjs continua com a trava própria dele', () => {
    const texto = fonte('faturar-retroativo.mjs');
    expect(texto).toContain("canal?.canal_faturamento === 'api'");
    expect(texto).toMatch(/canal_faturamento=api/);
  });

  it('catalogo-cores/carregar.mjs segue sem trava, e o arquivo diz por quê', () => {
    const texto = fonte('catalogo-cores/carregar.mjs');
    expect(texto).not.toContain('exigirCanalDeCarga');
    expect(texto).toContain('SEM TRAVA DE CANAL');
    // O motivo tem de continuar verdadeiro: ele só escreve em product_colors.
    const tabelasGravadas = [...texto.matchAll(/\.from\('([a-z_]+)'\)\s*\n?\s*\.(insert|upsert|update|delete)\(/g)];
    for (const m of tabelasGravadas) expect(m[1]).toBe('product_colors');
  });
});
