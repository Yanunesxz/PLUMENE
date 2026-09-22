import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import {
  coresPorSku,
  coresPorSkuParaOControl,
  coresSemNumeroParaOControl,
  corParaOControl,
  observacaoDeCores,
  observacaoGeralParaOControl,
  juntarObservacao,
  rotuloDaBolinha,
  type CorDaFicha,
} from '../packages/shared/src/pedidos/observacaoCores.js';
import type { OrderWithItems } from '../packages/shared/src/index.js';
import { criarSupabaseFake, type ConsultaFeita } from './supabaseFake.js';

/**
 * NOME no app, NÚMERO no Control — pedido do Yan, 22/09/2026, com os prints
 * do catálogo impresso: no app a cor aparece pelo nome ("CORES / ESTAMPAS:
 * PINK") e "está ótimo"; mas "na hora de subir pro Control tem que ser Cor 1,
 * Cor 2, do jeito que está no catálogo" — o pessoal do estoque confere pelo
 * número da bolinha.
 *
 * O que fica trancado aqui:
 *   1. a tradução pura (shared): bolinha "01" → "Cor 1", "10" → "Cor 10",
 *      VARIADAS → "Variadas", COR ÚNICA sem número → "Cor única", várias
 *      cores → "3M Cor 2 / 2G Cor 1", sem diferença de maiúscula/acento/
 *      espaço; sem casamento único e numerado, o NOME, como antes — nunca um
 *      número inventado — e a lista do que caiu no nome, com o motivo;
 *   2. a observação GERAL que vai ao Control (rodapé da planilha,
 *      `observacoes` da API) fica só com o recado do rep: sem a cor das peças
 *      do pedido e sem a cor de peça que saiu dele;
 *   3. a planilha oficial sai com "Cor N" na coluna OBSERVAÇÃO da linha e
 *      AVISA o operador de toda cor que foi pelo nome e de toda cor anotada
 *      que ficou fora do rodapé;
 *   4. o catálogo (GET /products), de onde a planilha tira as fichas, nunca
 *      troca um erro do banco por `colors: []`;
 *   5. a tela do app continua com o nome (só o que vai ao Control usa o
 *      número).
 * O feed da API de Parceiro está em partner-pedidos.test.ts, junto do resto
 * do contrato dos pedidos.
 */

// A ficha de uma peça como a CS tem no banco (22/09/2026): numeradas "01"…,
// a VARIADAS com código "VAR" e o selo marcado.
const FICHA_0015: CorDaFicha[] = [
  { codigo: '01', nome: 'rosa', variadas: false },
  { codigo: '02', nome: 'azul marinho', variadas: false },
  { codigo: '03', nome: 'pink', variadas: false },
  { codigo: 'VAR', nome: 'Variadas', variadas: true },
];

// A peça cuja ÚNICA bolinha é a VARIADAS: o app a chama "Cores variadas"
// (58 peças da CS assim); o Control recebe "Variadas", como no catálogo.
const FICHA_0020: CorDaFicha[] = [{ codigo: 'VAR', nome: 'Cores variadas', variadas: true }];

describe('rotuloDaBolinha — como a bolinha aparece no catálogo impresso', () => {
  it('"01" vira "Cor 1" e "10" vira "Cor 10" — sem o zero à esquerda', () => {
    expect(rotuloDaBolinha({ codigo: '01', variadas: false })).toBe('Cor 1');
    expect(rotuloDaBolinha({ codigo: '02', variadas: false })).toBe('Cor 2');
    expect(rotuloDaBolinha({ codigo: '10', variadas: false })).toBe('Cor 10');
  });

  it('a bolinha SORTIDA não vira número — mesmo com número no cadastro', () => {
    // Yan, 22/09/2026: "as cores sortidas continuam com nome". Na CS, 138
    // bolinhas VARIADAS têm o código "VAR" e 20 têm número ("04"): nas duas o
    // Control recebe o NOME cadastrado ("Variadas", "Cores variadas"), que é o
    // que o catálogo imprime — quem chama devolve o nome quando isto é null.
    expect(rotuloDaBolinha({ codigo: 'VAR', variadas: true, nome: 'Variadas' })).toBeNull();
    expect(rotuloDaBolinha({ codigo: '04', variadas: true, nome: 'Variadas' })).toBeNull();
  });

  it('a bolinha COR ÚNICA não vira "Cor 1" — vai pelo nome', () => {
    // Yan, 22/09/2026: onde não há duas cores para escolher, o número não diz
    // nada. Na CS são 20 bolinhas "Cor única" com o código '01' (19 peças só
    // têm ela) e as 9 de bolinha-selo sem número (0981, 0990, 1007…).
    expect(rotuloDaBolinha({ codigo: '01', variadas: false, nome: 'Cor única' })).toBeNull();
    expect(rotuloDaBolinha({ codigo: 'VAR', variadas: false, nome: 'Cores variadas' })).toBeNull();
    expect(rotuloDaBolinha({ codigo: '01', variadas: false, nome: 'ÚNICA' })).toBeNull();
  });

  it('código sem número de verdade não vira "Cor": quem chama fica com o nome', () => {
    expect(rotuloDaBolinha({ codigo: '00', variadas: false })).toBeNull();
    expect(rotuloDaBolinha({ codigo: '', variadas: false })).toBeNull();
    expect(rotuloDaBolinha({ codigo: 'X1', variadas: false })).toBeNull();
  });
});

describe('corParaOControl — o nome da nota vira o número da bolinha da peça', () => {
  it('casa o nome gravado com a bolinha da peça', () => {
    expect(corParaOControl('rosa', FICHA_0015)).toBe('Cor 1');
    expect(corParaOControl('pink', FICHA_0015)).toBe('Cor 3');
    // Sortida vai pelo NOME cadastrado, cada peça com o seu.
    expect(corParaOControl('Variadas', FICHA_0015)).toBe('Variadas');
    expect(corParaOControl('Cores variadas', FICHA_0020)).toBe('Cores variadas');
  });

  it('não liga para maiúscula, acento nem espaço', () => {
    const ficha: CorDaFicha[] = [
      { codigo: '01', nome: 'orquídea', variadas: false },
      { codigo: '02', nome: 'azul marinho', variadas: false },
    ];
    expect(corParaOControl('Orquidea', ficha)).toBe('Cor 1');
    expect(corParaOControl('ORQUÍDEA', ficha)).toBe('Cor 1');
    expect(corParaOControl('Azul  Marinho', ficha)).toBe('Cor 2');
  });

  it('sem casamento — cor renomeada depois do pedido — sai o NOME, como antes', () => {
    expect(corParaOControl('verde bandeira', FICHA_0015)).toBe('verde bandeira');
  });

  it('peça sem ficha de cores sai com o nome', () => {
    expect(corParaOControl('azul', undefined)).toBe('azul');
    expect(corParaOControl('azul', [])).toBe('azul');
  });

  it('nome ambíguo (duas bolinhas com o mesmo nome) sai com o nome — nunca chuta o número', () => {
    const ficha: CorDaFicha[] = [
      { codigo: '01', nome: 'rosa', variadas: false },
      { codigo: '04', nome: 'Rosa', variadas: false },
    ];
    expect(corParaOControl('rosa', ficha)).toBe('rosa');
  });

  it('bolinha casada mas sem número sai com o nome', () => {
    const ficha: CorDaFicha[] = [{ codigo: '', nome: 'lisa', variadas: false }];
    expect(corParaOControl('lisa', ficha)).toBe('lisa');
  });

  it('a peça de uma cor só vai pelo nome, nunca "Cor 1"', () => {
    // As 19 peças "Cor única" com código '01' (1036-1041, 0304-0309, 0107…) e
    // as 9 de bolinha-selo sem número: o Control recebe o nome do cadastro, o
    // mesmo que o app mostra (Yan, 22/09/2026).
    const unicaNumerada: CorDaFicha[] = [{ codigo: '01', nome: 'Cor única', variadas: false }];
    expect(corParaOControl('Cor única', unicaNumerada)).toBe('Cor única');
    const selo: CorDaFicha[] = [{ codigo: 'VAR', nome: 'Cores variadas', variadas: false }];
    expect(corParaOControl('Cores variadas', selo)).toBe('Cores variadas');
  });
});

describe('coresSemNumeroParaOControl — o que foi pelo NOME, e por quê', () => {
  const skus = new Set(['0015', '0706']);

  it('lista cada cor que caiu no nome, com o motivo, uma vez por referência e nome', () => {
    const fichas = new Map<string, CorDaFicha[]>([
      [
        '0015',
        [
          ...FICHA_0015,
          { codigo: '05', nome: 'nude', variadas: false },
          { codigo: '06', nome: 'Nude', variadas: false },
          { codigo: '', nome: 'lisa', variadas: false },
        ],
      ],
    ]);
    const notas = [
      '0015 3M pink', // numerada: não entra
      '0015 2G verde bandeira',
      '0015 1GG verde bandeira', // a mesma cor em outro tamanho: um aviso só
      '0015 1P nude',
      '0015 1EG lisa',
      '0706 6M azul',
    ].join('\n');
    expect(coresSemNumeroParaOControl(notas, skus, fichas)).toEqual([
      { sku: '0015', nome: 'verde bandeira', motivo: 'sem_casamento' },
      { sku: '0015', nome: 'nude', motivo: 'ambigua' },
      { sku: '0015', nome: 'lisa', motivo: 'sem_numero' },
      { sku: '0706', nome: 'azul', motivo: 'sem_ficha' },
    ]);
  });

  it('tudo numerado: lista vazia', () => {
    const fichas = new Map([['0015', FICHA_0015]]);
    expect(coresSemNumeroParaOControl('0015 3M pink\n0015 2G Rosa', skus, fichas)).toEqual([]);
  });

  it('cor SORTIDA e cor ÚNICA não são aviso: o nome delas é a resposta certa', () => {
    // Yan, 22/09/2026 — "as cores sortidas continuam com nome". Se entrassem
    // na lista, quem exporta receberia um aviso em quase todo pedido (na CS,
    // 781 das 1.344 referências com cor são sortidas) e pararia de ler os
    // avisos que importam.
    const fichas = new Map<string, CorDaFicha[]>([
      ['0015', FICHA_0015],
      ['0020', FICHA_0020],
      ['1036', [{ codigo: '01', nome: 'Cor única', variadas: false }]],
    ]);
    const skusComUnica = new Set(['0015', '0020', '1036']);
    const notas = '0015 4GG Variadas\n0020 2M Cores variadas\n1036 3P Cor única';
    expect(coresSemNumeroParaOControl(notas, skusComUnica, fichas)).toEqual([]);
  });
});

describe('observacaoGeralParaOControl — o recado do rep, sem cor de peça nenhuma', () => {
  it('tira as linhas de cor do pedido E as de peça que saiu dele', () => {
    const r = observacaoGeralParaOControl(
      'ENTREGAR SEXTA\n\n0015 3M pink\n0020 2G azul\n0020 1P rosa',
      new Set(['0015']),
    );
    expect(r.texto).toBe('ENTREGAR SEXTA');
    expect(r.linhasDeOutrasPecas).toEqual([
      { sku: '0020', linha: '0020 2G azul' },
      { sku: '0020', linha: '0020 1P rosa' },
    ]);
  });

  it('reconhece a grade numerada ("304" = 3 no 04) e a "Cor única" do #14628', () => {
    const r = observacaoGeralParaOControl('0080 304 azul\n1036 3P Cor única', new Set(['0015']));
    expect(r.texto).toBe('');
    expect(r.linhasDeOutrasPecas.map((l) => l.sku)).toEqual(['0080', '1036']);
  });

  it('o recado do representante fica, mesmo citando referência', () => {
    // Recados reais dos pedidos da CS (#14613, #14648) e o "0015 2 peças", que
    // o modo genérico de semLinhasDeCor tiraria: falta o tamanho colado.
    const recados = [
      'FATURAR EM 2 REMESSAS',
      'Ref. 0848 mandar  a cor Marrom no lugar do Rosa Claro 1p 1m 1g 2gg.',
      'Ref. 0750 cores 1 , 2 e 4.',
      '0020 2 peças a mais se tiver',
      '0020 cores 1 e 3',
    ].join('\n');
    const r = observacaoGeralParaOControl(`${recados}\n0015 3M pink`, new Set(['0015']));
    expect(r.texto).toBe(recados);
    expect(r.linhasDeOutrasPecas).toEqual([]);
  });

  it('sem notas: vazio', () => {
    expect(observacaoGeralParaOControl(null, new Set())).toEqual({ texto: '', linhasDeOutrasPecas: [] });
  });
});

describe('coresPorSkuParaOControl — o resumo por referência que vai ao Control', () => {
  const skus = new Set(['0015', '0020', '0706']);
  const fichas = new Map<string, CorDaFicha[]>([
    ['0015', FICHA_0015],
    ['0020', FICHA_0020],
  ]);

  it('uma cor só vira o número dela', () => {
    const resumo = coresPorSkuParaOControl('0015 3M pink\n0015 2G pink', skus, fichas);
    expect(resumo.get('0015')).toBe('Cor 3');
  });

  it('várias cores mantêm o formato de hoje, trocando só o nome', () => {
    const resumo = coresPorSkuParaOControl('0015 3M azul marinho\n0015 2G rosa', skus, fichas);
    expect(resumo.get('0015')).toBe('3M Cor 2 / 2G Cor 1');
  });

  it('a bolinha SORTIDA sai pelo nome do cadastro, como o app mostra', () => {
    const resumo = coresPorSkuParaOControl('0015 4GG Variadas\n0020 2M Cores variadas', skus, fichas);
    expect(resumo.get('0015')).toBe('Variadas');
    expect(resumo.get('0020')).toBe('Cores variadas');
  });

  it('referência sem ficha e cor sem casamento ficam com o nome, sem apagar nada', () => {
    const notas = '0706 6M azul\n0015 3M pink\n0015 2G verde bandeira';
    const resumo = coresPorSkuParaOControl(notas, skus, fichas);
    expect(resumo.get('0706')).toBe('azul');
    expect(resumo.get('0015')).toBe('3M Cor 3 / 2G verde bandeira');
  });

  it('lê as notas como o app grava: recado do rep não entra', () => {
    const cores = observacaoDeCores([
      { sku: '0015', size: 'M', quantity: 3, color_code: '03', color_name: 'pink' },
      { sku: '0015', size: 'G', quantity: 2, color_code: '01', color_name: 'rosa' },
    ]);
    const notas = juntarObservacao('FATURAR EM 2 REMESSAS', cores)!;
    const resumo = coresPorSkuParaOControl(notas, skus, fichas);
    expect([...resumo]).toEqual([['0015', '3M Cor 3 / 2G Cor 1']]);
  });
});

describe('no app a cor continua pelo NOME', () => {
  it('as notas do pedido continuam gravando só o nome', () => {
    const cores = observacaoDeCores([
      { sku: '0015', size: 'M', quantity: 3, color_code: '03', color_name: 'pink' },
    ]);
    expect(cores).toBe('0015 3M pink');
  });

  it('a leitura da tela (coresPorSku) dá o nome das MESMAS notas que o Control recebe numeradas', () => {
    const skus = new Set(['0015']);
    const notas = '0015 3M pink\n0015 2G rosa';
    expect(coresPorSku(notas, skus).get('0015')).toBe('3M pink / 2G rosa');
    expect(
      coresPorSkuParaOControl(notas, skus, new Map([['0015', FICHA_0015]])).get('0015'),
    ).toBe('3M Cor 3 / 2G Cor 1');
  });

  const RAIZ = path.resolve(__dirname, '..');
  const lerDoRepo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');
  const arquivosDe = (dir: string): string[] =>
    readdirSync(path.join(RAIZ, dir)).flatMap((nome) => {
      const rel = `${dir}/${nome}`;
      if (statSync(path.join(RAIZ, rel)).isDirectory()) return arquivosDe(rel);
      return /\.(ts|tsx)$/.test(nome) ? [rel] : [];
    });

  it('só a planilha e a API de Parceiro usam o número — nenhuma tela', () => {
    const usam = [...arquivosDe('apps/web/src'), ...arquivosDe('apps/api/src')].filter((rel) =>
      /coresPorSkuParaOControl|corParaOControl|rotuloDaBolinha|coresSemNumeroParaOControl|observacaoGeralParaOControl/.test(
        lerDoRepo(rel),
      ),
    );
    expect(usam.sort()).toEqual([
      'apps/api/src/modules/partner/partner.service.ts',
      'apps/web/src/lib/exportOrders.ts',
    ]);
  });

  it('o detalhe do pedido lê a cor pelo nome, e o seletor mostra o nome da bolinha', () => {
    const detalhe = lerDoRepo('apps/web/src/modules/pedidos/PaginaDetalhePedido.tsx');
    expect(detalhe).toMatch(/coresPorSku\(order\?\.notes, skusDoPedido\)/);
    const seletor = lerDoRepo('apps/web/src/components/comercial/SeletorTamanho.tsx');
    expect(seletor).toMatch(/Cores \/ Estampas:[\s\S]{0,120}corSelecionada\?\.nome/);
  });

  it('a lista de pedidos entrega a ficha de cores do catálogo em cache à exportação', () => {
    const lista = lerDoRepo('apps/web/src/modules/pedidos/PaginaPedidos.tsx');
    expect(lista).toMatch(/exportarPedidosParaControl\(detailed, \{[\s\S]{0,200}coresDoProduto,/);
    expect(lista).toMatch(/m\.set\(p\.id, p\.colors\)/);
  });
});

// ─── A planilha oficial ──────────────────────────────────────────────────────

describe('a planilha do Control sai com "Cor N" na coluna OBSERVAÇÃO', () => {
  const MODELO = path.resolve(__dirname, '../apps/web/public/modelos/pedido-cs-1.xlsx');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A 0030 está no catálogo baixado, mas NÃO no pedido: foi tirada no "editar
  // peças" da triagem, e a linha de cor dela ficou nas notas.
  const FICHA_0030: CorDaFicha[] = [
    { codigo: '01', nome: 'azul', variadas: false },
    { codigo: '02', nome: 'rosa', variadas: false },
  ];
  const TODAS_AS_FICHAS = new Map([
    ['p15', FICHA_0015],
    ['p20', FICHA_0020],
    ['p30', FICHA_0030],
  ]);

  /**
   * Roda a exportação de verdade (`exportarPedidosParaControl`): o modelo vem
   * do disco no lugar do `fetch`, e a folha de compartilhamento do celular
   * devolve o arquivo que seria entregue.
   */
  async function exportar(
    pedido: Record<string, unknown>,
    coresDoProduto?: Map<string, CorDaFicha[]>,
  ): Promise<{ xml: string; avisos: string[] }> {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(String(url)).toMatch(/modelos\/pedido-cs-1\.xlsx$/);
      return new Response(new Uint8Array(readFileSync(MODELO)));
    });
    let entregue: File | null = null;
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: async ({ files }: { files: File[] }) => {
        entregue = files[0] ?? null;
      },
    });

    const { exportarPedidosParaControl } = await import('../apps/web/src/lib/exportOrders.js');
    const resultado = await exportarPedidosParaControl([pedido as unknown as OrderWithItems], {
      skuDoProduto: new Map([
        ['p15', '0015'],
        ['p20', '0020'],
        ['p30', '0030'],
      ]),
      tamanhoDaVariante: new Map([
        ['v15m', 'M'],
        ['v15g', 'G'],
        ['v20p', 'P'],
      ]),
      tabelaDoPedido: () => 1,
      corDoProduto: new Map(),
      ...(coresDoProduto ? { coresDoProduto } : {}),
    });
    expect(resultado.arquivos).toBe(1);
    expect(entregue).not.toBeNull();
    const bytes = new Uint8Array(await entregue!.arrayBuffer());
    return {
      xml: new TextDecoder().decode(unzipSync(bytes)['xl/worksheets/sheet1.xml']!),
      // A 0020 do teste não está na Tabela 1 do modelo: o aviso de preço
      // dela não é assunto deste arquivo.
      avisos: resultado.avisos.filter((a) => !a.endsWith('sairá sem preço.')),
    };
  }

  const PEDIDO = {
    id: 'o1-planilha',
    order_number: 14700,
    created_at: '2026-09-22T10:00:00Z',
    notes: 'ENTREGAR SEXTA\n\n0015 3M pink\n0015 2G Rosa\n0020 1P Cores variadas',
    discount_percent: 0,
    items: [
      { product_id: 'p15', variant_id: 'v15m', quantity: 3, unit_price: 43.9 },
      { product_id: 'p15', variant_id: 'v15g', quantity: 2, unit_price: 43.9 },
      { product_id: 'p20', variant_id: 'v20p', quantity: 1, unit_price: 39.9 },
    ],
  };

  const celula = (xml: string, ref: string) =>
    xml.match(new RegExp(`<c r="${ref}"[^>]*t="inlineStr"><is><t[^>]*>([^<]*)</t>`))?.[1] ?? null;

  it('cada referência leva o número da bolinha; várias cores no formato de hoje', async () => {
    const { xml, avisos } = await exportar(PEDIDO, TODAS_AS_FICHAS);
    expect(celula(xml, 'B13')).toBe('3M Cor 3 / 2G Cor 1');
    expect(celula(xml, 'B14')).toBe('Cores variadas'); // sortida vai pelo nome
    // O rodapé continua só com o recado do rep: a cor mora na linha.
    expect(celula(xml, 'A45')).toBe('PÁGINA 01. ENTREGAR SEXTA');
    expect(xml).not.toMatch(/<t[^>]*>[^<]*(pink|Rosa)/);
    // Tudo numerado: nada para o operador conferir.
    expect(avisos).toEqual([]);
  });

  it('a cor de peça que SAIU do pedido não vai ao rodapé pelo nome — vira aviso, já numerada', async () => {
    // O #14628 da CS: a 1036 saiu na triagem e "1036 3P Cor única" continuava
    // indo ao estoque no rodapé.
    const { xml, avisos } = await exportar(
      { ...PEDIDO, notes: 'ENTREGAR SEXTA\n\n0015 3M pink\n0015 2G Rosa\n0030 2G azul' },
      TODAS_AS_FICHAS,
    );
    expect(celula(xml, 'A45')).toBe('PÁGINA 01. ENTREGAR SEXTA');
    expect(xml).not.toMatch(/<t[^>]*>[^<]*(0030|azul)/);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/^Pedido 14700: a 0030 não está na planilha — a cor anotada para ela \(Cor 1\) ficou fora do rodapé/);
  });

  it('a peça que ficou de fora (sem tamanho) leva a cor para o aviso, não para o rodapé', async () => {
    const pedido = {
      ...PEDIDO,
      items: [
        ...PEDIDO.items.filter((i) => i.product_id !== 'p20'),
        { product_id: 'p20', variant_id: 'v20-sem-tamanho', quantity: 1, unit_price: 39.9 },
      ],
    };
    const { xml, avisos } = await exportar(pedido, TODAS_AS_FICHAS);
    expect(celula(xml, 'A45')).toBe('PÁGINA 01. ENTREGAR SEXTA');
    expect(avisos).toEqual([
      'Pedido 14700: 0020 sem tamanho no pedido — não entrou na planilha.',
      expect.stringMatching(/^Pedido 14700: a 0020 não está na planilha — a cor anotada para ela \(Cores variadas\)/),
    ]);
  });

  it('catálogo baixado SEM as fichas: a cor sai pelo nome, como antes — e o operador é avisado', async () => {
    // Um soluço do banco ao baixar o catálogo gravava `colors: []` por cima
    // do cache bom: a planilha mandava o nome em tudo, com avisos = [].
    const { xml, avisos } = await exportar(PEDIDO);
    expect(celula(xml, 'B13')).toBe('3M pink / 2G Rosa');
    expect(celula(xml, 'B14')).toBe('Cores variadas');
    expect(avisos).toHaveLength(3);
    expect(avisos[0]).toMatch(/^Pedido 14700: a cor da 0015 saiu pelo nome \("pink"\), não pelo número — o catálogo baixado está sem a ficha de cores da peça\. Recarregue o catálogo/);
    expect(avisos[1]).toMatch(/0015 saiu pelo nome \("Rosa"\)/);
    expect(avisos[2]).toMatch(/0020 saiu pelo nome \("Cores variadas"\)/);
  });

  it('cor renomeada na ficha: a linha sai misturada, e o aviso diz qual cor foi pelo nome', async () => {
    const renomeada = FICHA_0015.map((c) => (c.codigo === '03' ? { ...c, nome: 'pink neon' } : c));
    const { xml, avisos } = await exportar(
      PEDIDO,
      new Map([
        ['p15', renomeada],
        ['p20', FICHA_0020],
      ]),
    );
    expect(celula(xml, 'B13')).toBe('3M pink / 2G Cor 1');
    expect(avisos).toEqual([
      expect.stringMatching(/^Pedido 14700: a cor da 0015 saiu pelo nome \("pink"\), não pelo número — essa cor não está na ficha de cores da peça/),
    ]);
  });
});

// ─── O catálogo que alimenta a planilha ──────────────────────────────────────

/**
 * A planilha lê as fichas de cores do catálogo EM CACHE, e quem enche o cache
 * é o GET /products. Até 22/09/2026 um erro do banco ao ler product_colors
 * era engolido e virava `colors: []` com 200 — gravado por cima do cache bom.
 */
describe('o catálogo nunca entrega ficha de cores vazia por um erro do banco', () => {
  const PRODUTOS = [{ id: 'p15', sku: '0015', name: 'Camisola', active: true, image_url: null }];
  const LINHAS = [
    { product_id: 'p15', codigo: '01', nome: 'rosa', hex: '#F4B6C2', variadas: false, ordem: 0 },
    { product_id: 'p15', codigo: '03', nome: 'pink', hex: '#E0218A', variadas: false, ordem: 2 },
  ];
  const OK = { data: [], error: null };
  const AUSENTE = (alvo: string) => ({
    data: null,
    error: { message: `column ${alvo} does not exist`, code: '42703' },
  });

  /**
   * product_colors como o banco responde: as sondas (`select(coluna).limit(1)`)
   * pelo mapa `sondas`; a leitura paginada (a que tem `.range`) pela `leitura`,
   * que recebe o select pedido — o PostgREST recusa coluna que não existe.
   */
  function productColors(
    leitura: (colunas: string) => { data: unknown; error: { message: string; code?: string } | null },
    sondas: Record<string, { data: unknown; error: { message: string; code?: string } | null }> = {},
  ) {
    return (c: ConsultaFeita) => {
      const colunas = String(c.filtros.find((f) => f.metodo === 'select')?.args[0] ?? '');
      if (!c.filtros.some((f) => f.metodo === 'range')) return sondas[colunas] ?? OK;
      return leitura(colunas);
    };
  }

  async function catalogo(product_colors: ReturnType<typeof productColors>) {
    vi.resetModules();
    const fake = criarSupabaseFake({
      products: { data: PRODUTOS, error: null },
      product_variants: { data: [], error: null },
      product_colors,
    });
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    const { getProducts } = await import('../apps/api/src/modules/catalog/catalog.service.js');
    return { getProducts, fake };
  }

  afterEach(() => {
    vi.doUnmock('../apps/api/src/config/supabase.js');
  });

  it('erro ao ler as fichas SOBE (500) — a tela fica com o cache que tem', async () => {
    const { getProducts } = await catalogo(productColors(() => ({ data: null, error: { message: 'caiu' } })));
    await expect(getProducts('empresa-1')).rejects.toThrow(/caiu/);
  });

  it('sem a 020 (hex_par/estampa) as bolinhas vêm sem o par — antes sumiam todas', async () => {
    const { getProducts } = await catalogo(
      productColors(
        (colunas) =>
          /hex_par|estampa/.test(colunas)
            ? AUSENTE('product_colors.hex_par')
            : { data: LINHAS, error: null },
        { hex_par: AUSENTE('product_colors.hex_par') },
      ),
    );
    const [p] = await getProducts('empresa-1');
    expect(p!.colors!.map((c) => [c.codigo, c.nome, c.hex_par])).toEqual([
      ['01', 'rosa', null],
      ['03', 'pink', null],
    ]);
  });

  it('sem a 019 (a tabela não existe) o catálogo abre, só sem bolinha — como antes', async () => {
    const { getProducts } = await catalogo(
      productColors(() => AUSENTE('product_colors.codigo'), {
        codigo: {
          data: null,
          error: { message: "Could not find the table 'public.product_colors' in the schema cache", code: 'PGRST205' },
        },
      }),
    );
    const [p] = await getProducts('empresa-1');
    expect(p!.colors).toEqual([]);
  });

  it('a leitura das fichas desempata a ordem — a página não embaralha passando de 1.000', async () => {
    const { getProducts, fake } = await catalogo(productColors(() => ({ data: LINHAS, error: null })));
    await getProducts('empresa-1');
    expect(fake.filtrosDe('product_colors', 'order').map((f) => f.args[0])).toEqual([
      'ordem',
      'product_id',
      'codigo',
    ]);
  });
});
