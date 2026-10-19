import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mostraPlanilhaDoControl } from '../apps/web/src/lib/pedido.js';

/**
 * A planilha do Control some quando o canal de pedidos está na API.
 *
 * Com `canal_pedido_erp = 'api'` quem lança pedido no Control é o programa da
 * fábrica. Se o financeiro ainda pudesse exportar o formulário e importar à
 * mão, o MESMO pedido entraria duas vezes no Control — e um pedido duplicado
 * vira nota duplicada. O portão é o mesmo do "Marcar faturado" (048/049): a
 * tela pergunta os canais em `/orders/canais` e esconde o que o Control
 * passou a fazer sozinho.
 */

describe('quem decide se a planilha do Control aparece', () => {
  it('canal de pedidos manual: a planilha fica — é assim que se trabalha hoje', () => {
    expect(mostraPlanilhaDoControl({ pedido_erp: 'manual', faturamento: 'manual' }, true)).toBe(true);
    expect(mostraPlanilhaDoControl({ pedido_erp: 'manual', faturamento: 'api' }, true)).toBe(true);
  });

  it('canal de pedidos na API: a planilha some, mesmo com o faturamento manual', () => {
    expect(mostraPlanilhaDoControl({ pedido_erp: 'api', faturamento: 'manual' }, true)).toBe(false);
    expect(mostraPlanilhaDoControl({ pedido_erp: 'api', faturamento: 'api' }, true)).toBe(false);
  });

  it('sem os canais (offline, ou a API não leu) a tela é a de sempre: a planilha fica', () => {
    expect(mostraPlanilhaDoControl(null, true)).toBe(true);
    expect(mostraPlanilhaDoControl(undefined, true)).toBe(true);
  });

  it('marca sem o formulário oficial não ganha a planilha de volta por causa do canal', () => {
    // VITE_BRAND_CONTROL_EXPORT=false: a instalação da outra marca nunca teve
    // o formulário, e o canal manual não é motivo para inventá-lo.
    expect(mostraPlanilhaDoControl({ pedido_erp: 'manual', faturamento: 'manual' }, false)).toBe(false);
    expect(mostraPlanilhaDoControl({ pedido_erp: 'api', faturamento: 'manual' }, false)).toBe(false);
  });
});

/**
 * O portão não é função pura: é `{cond && <Botao/>}` dentro do JSX. Para
 * esses, o teste lê o arquivo e exige que o portão esteja lá — não é tão
 * forte quanto executar a tela, mas pega o que importa: alguém apagar a
 * guarda sem querer num refactor.
 */
const LISTA = path.resolve(__dirname, '../apps/web/src/modules/pedidos/PaginaPedidos.tsx');
const fonte = readFileSync(LISTA, 'utf8');

describe('a lista de pedidos obedece ao canal', () => {
  it('pergunta os canais também por causa da planilha, não só pela venda interna', () => {
    // Até 19/10/2026 a pergunta saía só para a venda interna (o "Marcar
    // faturado" do cartão). Se voltar a sair só para ela, o financeiro — que
    // é quem exporta — nunca saberia que o canal virou 'api'.
    expect(fonte).toMatch(/!ehVendaInterna && !MARCA\.exportaControl/);
    expect(fonte).toMatch(/get<ApiResponse<CanaisDoPedido \| null>>\('\/orders\/canais', token\)/);
  });

  it('o botão "Exportar" passa pelo portão dos canais', () => {
    expect(fonte).toMatch(/const ofereceAPlanilha = mostraPlanilhaDoControl\(canais, MARCA\.exportaControl\)/);
    expect(fonte).toMatch(/ofereceAPlanilha \? \([\s\S]{0,400}Exportar/);
  });

  it('no lugar do botão fica a frase que explica — não um buraco na tela', () => {
    expect(fonte).toMatch(/O Control recebe os pedidos sozinho/);
  });

  it('o modo de escolha e o "Gerar planilha" morrem junto com o botão', () => {
    // Os canais chegam DEPOIS da tela: a escolha que já estava aberta precisa
    // fechar sozinha quando a resposta diz 'api'.
    expect(fonte).toMatch(/const escolhendoParaExportar = selectMode && ofereceAPlanilha/);
    expect(fonte).toMatch(/\{escolhendoParaExportar && \(/);
    expect(fonte).toMatch(/if \(escolhendoParaExportar\) \{/);
  });

  it('e a exportação em si recusa gerar a planilha com o canal na API', () => {
    expect(fonte).toMatch(/async function handleExport\(\)[\s\S]{0,400}if \(!ofereceAPlanilha\) return;/);
  });

  it('o "Marcar faturado" do cartão continua no portão do faturamento', () => {
    // O canal de pedidos não pode ter encostado no portão do faturamento:
    // são dois canais, duas decisões (048, decisão 11).
    expect(fonte).toMatch(/const faturadoPeloControl = faturaPeloControl\(canais\)/);
    expect(fonte).toMatch(/!faturadoPeloControl &&/);
  });
});
