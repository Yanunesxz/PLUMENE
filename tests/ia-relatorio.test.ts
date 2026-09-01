import { describe, it, expect } from 'vitest';
import {
  diasDesde,
  resumirCarteira,
  linhasDaCarteira,
  linhasDaEmpresa,
  montarPedido,
  escolherProvedor,
  relatorioLocal,
  MAXIMO_DE_LINHAS,
  type ClienteParaRelatorio,
} from '../apps/api/src/modules/ia/ia.relatorio.js';

/**
 * O relatório de IA é tão bom quanto os dados que chegam nela — e ESTA é a
 * parte testável: ordenação (piores primeiro), corte de tamanho (custo) e
 * agregado por representante. A chamada de rede fica de fora de propósito.
 */

const HOJE = new Date('2026-08-31T12:00:00Z');
const cliente = (over: Partial<ClienteParaRelatorio>): ClienteParaRelatorio => ({
  name: 'LOJA QUALQUER LTDA',
  ...over,
});

describe('diasDesde', () => {
  it('conta os dias e nunca devolve negativo', () => {
    expect(diasDesde('2026-08-21', HOJE)).toBe(10);
    expect(diasDesde('2027-01-01', HOJE)).toBe(0); // data futura (relógio torto) não explode
    expect(diasDesde(null, HOJE)).toBeNull();
    expect(diasDesde('rabisco', HOJE)).toBeNull();
  });
});

describe('resumo da carteira', () => {
  it('classifica pela mesma régua do app e soma o vencido', () => {
    const r = resumirCarteira(
      [
        cliente({ last_purchase_at: '2026-08-01' }), // ativo
        cliente({ last_purchase_at: '2026-04-01', overdue_amount: 100 }), // esfriando
        cliente({ last_purchase_at: '2025-01-01', overdue_amount: 50.5 }), // parado
        cliente({}), // sem registro
      ],
      HOJE,
    );
    expect(r).toMatchObject({ total: 4, ativos: 1, esfriando: 1, parados: 1, semRegistro: 1 });
    expect(r.vencidoTotal).toBeCloseTo(150.5);
  });
});

describe('linhas da carteira (visão do rep)', () => {
  it('os mais parados vêm primeiro — são eles que sobrevivem ao corte', () => {
    const linhas = linhasDaCarteira(
      [
        cliente({ name: 'RECENTE', last_purchase_at: '2026-08-20' }),
        cliente({ name: 'PARADAO', last_purchase_at: '2024-01-10', total_purchased: 15230 }),
        cliente({ name: 'MORNO', last_purchase_at: '2026-02-01' }),
      ],
      HOJE,
    );
    expect(linhas[0]).toContain('PARADAO');
    expect(linhas[0]).toContain('10/01/2024');
    expect(linhas[0]).toContain('R$ 15230');
    expect(linhas[2]).toContain('RECENTE');
  });

  it('carteira gigante vira corte com aviso, nunca prompt infinito', () => {
    const muitos = Array.from({ length: MAXIMO_DE_LINHAS + 25 }, (_, i) =>
      cliente({ name: `LOJA ${i}`, last_purchase_at: '2026-08-01' }),
    );
    const linhas = linhasDaCarteira(muitos, HOJE);
    expect(linhas).toHaveLength(MAXIMO_DE_LINHAS + 1);
    expect(linhas.at(-1)).toContain('+ 25 clientes');
  });

  it('nome fantasia vale mais que razão social, e sem data vira "sem registro"', () => {
    const [linha] = linhasDaCarteira(
      [cliente({ name: 'J J COMERCIO DE ROUPAS EIRELI', trade_name: 'SONHO INTIMO' })],
      HOJE,
    );
    expect(linha).toContain('SONHO INTIMO');
    expect(linha).not.toContain('EIRELI');
    expect(linha).toContain('sem registro de compra');
  });
});

describe('linhas da empresa (visão do escritório)', () => {
  it('agrega por representante, nomeia pelo cadastro e separa quem não tem rep', () => {
    const nomes = new Map([['01879', 'SILVIO']]);
    const linhas = linhasDaEmpresa(
      [
        cliente({ rep_erp_id: '01879', last_purchase_at: '2026-08-01' }),
        cliente({ rep_erp_id: '01879', last_purchase_at: '2024-05-01', overdue_amount: 200 }),
        cliente({ rep_erp_id: null }),
      ],
      nomes,
      HOJE,
    );
    const doSilvio = linhas.find((l) => l.startsWith('SILVIO:'));
    expect(doSilvio).toContain('2 clientes');
    expect(doSilvio).toContain('1 parados');
    expect(linhas.some((l) => l.startsWith('SEM REPRESENTANTE:'))).toBe(true);
    // O pior parado aparece na lista nominal com o rep entre parênteses.
    expect(linhas.join('\n')).toContain('(SILVIO)');
  });
});

describe('relatório local (o app escreve sozinho, custo zero)', () => {
  it('resume, prioriza quem mais comprava entre os parados e fecha com próximo passo', () => {
    const texto = relatorioLocal(
      [
        cliente({ name: 'ATIVA', last_purchase_at: '2026-08-01' }),
        cliente({ name: 'PEQUENA PARADA', last_purchase_at: '2025-06-01', total_purchased: 800 }),
        cliente({ name: 'GRANDE PARADA', last_purchase_at: '2025-09-01', total_purchased: 42000, overdue_amount: 350 }),
        cliente({ name: 'ESFRIANDO SO', last_purchase_at: '2026-04-15', total_purchased: 99000 }),
        cliente({}),
      ],
      { alcance: 'minha carteira' },
      HOJE,
    );
    expect(texto).toContain('Sua carteira tem 5 clientes: 2 parados');
    // Parado grande vem antes do parado pequeno E antes do esfriando gigante:
    // primeiro o grupo (parado), depois o tamanho da compra.
    const ordem = [texto.indexOf('GRANDE PARADA'), texto.indexOf('PEQUENA PARADA'), texto.indexOf('ESFRIANDO SO')];
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect(texto).toContain('Quem procurar primeiro:');
    expect(texto).toContain('vencido R$ 350');
    expect(texto).toContain('Próximo passo:');
    expect(texto).not.toContain('ATIVA —'); // quem está em dia não entra na lista de visita
  });

  it('carteira toda em dia não inventa urgência', () => {
    const texto = relatorioLocal([cliente({ last_purchase_at: '2026-08-20' })], { alcance: 'minha carteira' }, HOJE);
    expect(texto).toContain('carteira em dia');
    expect(texto).not.toContain('Quem procurar primeiro');
  });

  it('sem histórico nenhum, diz que falta carregar — não que está tudo bem', () => {
    const texto = relatorioLocal([cliente({}), cliente({})], { alcance: 'minha carteira' }, HOJE);
    expect(texto).toContain('não há registro de compra');
  });

  it('na empresa inteira, aponta as carteiras com mais parados pelo nome do rep', () => {
    const texto = relatorioLocal(
      [
        cliente({ rep_erp_id: '01879', last_purchase_at: '2024-01-01' }),
        cliente({ rep_erp_id: '01879', last_purchase_at: '2024-06-01' }),
        cliente({ rep_erp_id: '00779', last_purchase_at: '2026-08-01' }),
      ],
      { alcance: 'empresa inteira', nomeDoRep: new Map([['01879', 'SILVIO']]) },
      HOJE,
    );
    expect(texto).toContain('A empresa tem 3 clientes');
    expect(texto).toContain('- SILVIO: 2 parados de 2');
    expect(texto).not.toContain('Rep 00779'); // carteira sem parado não vira cobrança
  });
});

describe('escolherProvedor', () => {
  it('a chave presente decide; com as duas, a preferência desempata', () => {
    expect(escolherProvedor({ anthropic: '', openai: '' })).toBeNull();
    expect(escolherProvedor({ anthropic: 'sk-ant', openai: '' })).toBe('anthropic');
    expect(escolherProvedor({ anthropic: '', openai: 'sk-oai' })).toBe('openai');
    expect(escolherProvedor({ anthropic: 'sk-ant', openai: 'sk-oai' })).toBe('anthropic');
    expect(escolherProvedor({ anthropic: 'sk-ant', openai: 'sk-oai', preferencia: 'openai' })).toBe('openai');
    // Preferir openai SEM ter a chave não desliga a IA — cai no que existe.
    expect(escolherProvedor({ anthropic: 'sk-ant', openai: '', preferencia: 'openai' })).toBe('anthropic');
  });
});

describe('montarPedido', () => {
  it('o resumo com os números vai junto dos dados', () => {
    const resumo = resumirCarteira([cliente({ last_purchase_at: '2025-01-01' })], HOJE);
    const pedido = montarPedido('minha carteira', resumo, ['LINHA 1']);
    expect(pedido).toContain('1 parados (180+ dias sem comprar)');
    expect(pedido).toContain('LINHA 1');
  });
});
