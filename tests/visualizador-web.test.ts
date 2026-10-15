import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { navItemsForRole } from '../apps/web/src/components/layout/navItems.js';
import {
  decisaoDoPedido,
  podeCancelarSolicitacao,
  podeLancarNoErp,
  seloDoPedido,
} from '../apps/web/src/lib/pedido.js';
import type { Order, OrderStatus } from '@csb/shared';

/**
 * O que o visualizador (054) VÊ e o que não vê no app — pelas funções puras,
 * que é onde a regra cabe num teste.
 *
 * Pedido do Yan (15/10/2026): "ele pode ver tudo so nao pode alterar nada".
 * No app isso quer dizer duas coisas: o menu dele leva só a tela que ele pode
 * abrir, e nenhuma tela desenha botão que responderia 403 no toque.
 */

const PAPEL = 'visualizador' as const;

// ─── O menu ──────────────────────────────────────────────────────────────────

describe('menu do visualizador', () => {
  const itens = navItemsForRole(PAPEL);
  const enderecos = itens.map((i) => i.to);

  it.each([
    ['/dashboard', 'Painel'],
    ['/orders', 'Pedidos'],
    ['/catalog', 'Catálogo'],
    ['/customers', 'Clientes'],
    ['/representantes', 'Representantes'],
    ['/atividades', 'Atividades'],
    ['/integracao', 'Integração'],
    ['/logins', 'Logins'],
  ])('leva a %s (%s)', (destino) => {
    expect(enderecos).toContain(destino);
  });

  it.each([
    ['/minha-area', 'é cheia de ação: push, relatório de IA, OK de tarefa, fila offline'],
    ['/alertas', 'central do representante — e é lá que se ativam os avisos'],
    ['/acessos', 'gerar convite e vitrine é escrita'],
    ['/importar', 'subir planilha e foto é escrita'],
    ['/orders/new', 'montar pedido é escrita'],
  ])('NÃO leva a %s (%s)', (destino) => {
    expect(enderecos).not.toContain(destino);
  });

  it('não ganhou o menu do representante por descuido', () => {
    // `navItemsForRole` termina em `return repItems`: papel sem ramo próprio
    // herda o menu de quem vende. Era o estado antes de 15/10/2026.
    const doRep = navItemsForRole('rep').map((i) => i.to);
    expect(enderecos).not.toEqual(doRep);
    expect(enderecos).toContain('/dashboard'); // o rep não tem Painel
  });

  it('nenhum item mostra número de fila — ele não trabalha fila', () => {
    for (const item of itens) {
      expect(item.fila, `${item.to} veio com fila`).toBeUndefined();
    }
  });

  it('nenhum item depende de tecla do gerente', () => {
    // A tecla não barra o visualizador (`temPermissao` devolve true para quem
    // não é gerente): item com `permissao` aqui daria falsa sensação de guarda.
    for (const item of itens) {
      expect(item.permissao, `${item.to} veio com permissao`).toBeUndefined();
    }
  });

  it('os itens longos têm rótulo curto para o menu de abas do celular', () => {
    for (const item of itens) {
      if (item.label.length > 9) {
        expect(item.short, `${item.label} sem rótulo curto`).toBeTruthy();
      }
    }
  });

  it('os outros papéis continuam com o menu deles', () => {
    expect(navItemsForRole('relacionamento').map((i) => i.to)).toEqual([
      '/atividades',
      '/customers',
    ]);
    expect(navItemsForRole('store').map((i) => i.to)).toContain('/minha-area');
    expect(navItemsForRole('financeiro').map((i) => i.to)).toContain('/integracao');
    expect(navItemsForRole('admin').map((i) => i.to)).toContain('/logins');
  });
});

// ─── Os botões do pedido ─────────────────────────────────────────────────────

describe('nenhuma decisão de pedido aparece para ele', () => {
  const ESTADOS: OrderStatus[] = [
    'draft',
    'pending_rep',
    'pending_approval',
    'approved',
    'sent_erp',
    'rejected',
  ];

  it.each(ESTADOS)('status %s: nada a decidir', (status) => {
    // `decisaoDoPedido` devolvendo null é o que apaga o CartaoDecisao e os
    // botões de aprovar/recusar, no Painel e no detalhe do pedido.
    expect(decisaoDoPedido(PAPEL, status)).toBeNull();
  });

  it('nem com a tecla "ligada" — a tecla não fala sobre este papel', () => {
    for (const status of ESTADOS) {
      expect(decisaoDoPedido(PAPEL, status, true)).toBeNull();
    }
  });

  it('não lança no ERP', () => {
    expect(podeLancarNoErp(PAPEL, 'approved', false)).toBe(false);
  });

  it('não cancela a solicitação ao Control', () => {
    const pedido = { erp_order_id: null, erp_requested_at: '2026-10-15T10:00:00Z' } as Pick<
      Order,
      'erp_order_id'
    > & { erp_requested_at: string };
    expect(podeCancelarSolicitacao(PAPEL, pedido)).toBe(false);
  });

  it('e o financeiro continua decidindo e lançando', () => {
    expect(decisaoDoPedido('financeiro', 'pending_approval')).not.toBeNull();
    expect(podeLancarNoErp('financeiro', 'approved', false)).toBe(true);
  });
});

describe('o selo do pedido fala a língua do escritório', () => {
  it('mostra o estado INTERNO, não os degraus do cliente', () => {
    // Ele olha a mesma lista que o gerente: se visse "Enviado pra fábrica"
    // onde o gerente vê "Aguardando aprovação", a tela mentiria para ele.
    const pedido = { status: 'pending_approval', invoiced: false } as Order;
    expect(seloDoPedido(pedido, PAPEL)).toEqual(seloDoPedido(pedido, 'manager'));
  });

  it('e isso é diferente do que o representante vê', () => {
    const pedido = { status: 'pending_approval', invoiced: false } as Order;
    expect(seloDoPedido(pedido, PAPEL).texto).not.toBe(seloDoPedido(pedido, 'rep').texto);
  });
});

// ─── As guardas que vivem no código das telas ───────────────────────────────

/**
 * Alguns portões não são função pura: são `{cond && <Botao/>}` dentro do JSX.
 * Para esses, o teste lê o arquivo e exige que o portão esteja lá — não é tão
 * forte quanto executar o componente, mas pega o caso que importa: alguém
 * apagar a guarda sem querer num refactor.
 */
const WEB = path.resolve(__dirname, '../apps/web/src');
const fonte = (relativo: string) => readFileSync(path.join(WEB, relativo), 'utf8');

/** Todos os arquivos de código de uma pasta, recursivamente. */
function arquivosDe(dir: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    if (statSync(cheio).isDirectory()) achados.push(...arquivosDe(cheio));
    else if (/\.(ts|tsx)$/.test(nome)) achados.push(cheio);
  }
  return achados;
}

/** Em quais arquivos de PRODUÇÃO (fora tests/) este nome aparece sendo usado. */
function chamadoresDe(nome: string): string[] {
  const raizes = [
    WEB,
    path.resolve(__dirname, '../apps/api/src'),
    path.resolve(__dirname, '../packages/shared/src'),
  ];
  const usos: string[] = [];
  for (const raiz of raizes) {
    for (const arquivo of arquivosDe(raiz)) {
      const texto = readFileSync(arquivo, 'utf8');
      // `nome(` é uso; a linha da definição e a do `export` ficam de fora.
      const chamadas = [...texto.matchAll(new RegExp(`\\b${nome}\\(`, 'g'))].length;
      const definicoes = [...texto.matchAll(new RegExp(`function\\s+${nome}\\(`, 'g'))].length;
      if (chamadas - definicoes > 0) usos.push(path.relative(path.resolve(__dirname, '..'), arquivo));
    }
  }
  return usos;
}

/**
 * O trecho do router que descreve UMA rota: de `path: 'x'` até o `path:` da
 * rota seguinte.
 *
 * Cortar "uns 400 caracteres" a partir do `path:` não serve — a janela passa
 * do fim do bloco e cai na rota de baixo. Tirei a guarda de `orders/new` para
 * testar e o teste passou, porque a janela alcançou o `PrivateRoute` de
 * `/acessos`, que fica logo depois.
 */
function blocoDaRota(router: string, rota: string): string {
  const inicio = router.indexOf(`path: '${rota}'`);
  if (inicio === -1) return '';
  const depois = router.indexOf("path: '", inicio + `path: '${rota}'`.length);
  return router.slice(inicio, depois === -1 ? undefined : depois);
}

describe('o portão está escrito na tela', () => {
  /**
   * Cada par é (arquivo, o PORTÃO em si) — não a palavra `ehSoLeitura` solta.
   *
   * Procurar só pelo nome da função dava verde com a guarda apagada: a linha
   * do `import` continua lá e o teste não notava nada (provei tirando o ramo
   * do `usePermissao`). O trecho abaixo é a condição de verdade; se alguém a
   * remover num refactor, o teste cai e diz qual tela ficou aberta.
   */
  it.each([
    ['modules/pedidos/PaginaPedidos.tsx', '{!soLeitura && (', 'esconde "Novo pedido"'],
    ['modules/catalogo/PaginaCatalogo.tsx', 'soLeitura ? {} : { onAdd:', 'esconde adicionar peça'],
    ['modules/catalogo/PaginaCatalogo.tsx', 'cartCount > 0 && !soLeitura', 'esconde o carrinho'],
    ['modules/logins/PaginaLogins.tsx', 'soLeitura={soLeitura}', 'tira os ícones do cartão'],
    ['modules/logins/CartaoDeLogin.tsx', '{!soLeitura && (', 'esconde editar'],
    ['modules/logins/CartaoDeLogin.tsx', '!ehVoce && !soLeitura && (', 'esconde bloquear e excluir'],
    ['modules/painel/PaginaPainel.tsx', '{!ehSoLeitura(user?.role) && <EnviarAviso />}', 'esconde o aviso em massa'],
    ['modules/representantes/PaginaRepresentantes.tsx', "=== 'financeiro' || ehSoLeitura(user?.role)", 'deixa a tela só de leitura'],
    ['modules/atividades/PaginaAtividades.tsx', '!ehSoLeitura(user?.role) &&', 'esconde "Excluir" da tarefa'],
    [
      'hooks/useAvisosNoCelular.ts',
      'if (soLeitura || !token || !chaveGlobal || ocupado) return;',
      'não ASSINA aviso',
    ],
    [
      'hooks/useAvisosNoCelular.ts',
      'if (soLeitura || !token || ocupado) return;',
      'nem desassina',
    ],
    [
      'hooks/useAvisosNoCelular.ts',
      "soLeitura ? 'indisponivel' : estadoDoAparelho",
      'e o cartão nem oferece ativar',
    ],
    [
      'hooks/useAvisosNoCelular.ts',
      'if (token && !soLeitura) void descobrir(token);',
      'nem vai buscar a assinatura deste aparelho',
    ],
    [
      'hooks/useSyncOnReconnect.ts',
      'wasOffline.current && token && !soLeitura',
      'não descarrega fila offline deixada por outro login no aparelho',
    ],
    /**
     * O detalhe do pedido é a tela com MAIS botões que ele abre, e os dois de
     * WhatsApp não são rota (são link `wa.me`, não dão 403): mandam mensagem
     * para fora em nome da fábrica. "Enviar cópia ao representante" era pior —
     * a condição `order.rep_id !== user?.id` é SEMPRE verdadeira para ele.
     */
    [
      'modules/pedidos/PaginaDetalhePedido.tsx',
      '{!ehLoja && !soLeitura && order.public_link && (',
      'esconde "Enviar pedido para o cliente"',
    ],
    [
      'modules/pedidos/PaginaDetalhePedido.tsx',
      'const enviaCopiaAoRep = !ehLoja && !soLeitura &&',
      'esconde "Enviar cópia ao representante"',
    ],
    [
      'modules/pedidos/PaginaDetalhePedido.tsx',
      'const soLeitura = ehSoLeitura(user?.role);',
      'e o papel é lido uma vez, ao lado de ehLoja',
    ],
    /**
     * A fila do Control: a rota deixava o visualizador ler e nenhuma tela dele
     * desenhava a fila (a Minha Área dele cai no Painel). Agora o cartão mora
     * no Painel, atrás de quem VÊ, e a baixa continua com quem mexe no Control.
     */
    [
      'modules/painel/PaginaPainel.tsx',
      'veAlteracoesPendentesDoCadastro(user?.role)',
      'o Painel pergunta quem VÊ a fila do Control',
    ],
    [
      'modules/painel/PaginaPainel.tsx',
      '{veFilaDoControl && filaDoControl.length > 0 && (',
      'e desenha o cartão da fila',
    ],
    [
      'modules/painel/PaginaPainel.tsx',
      'podeConfirmar={podeDarBaixaNoControl}',
      'sem prometer a baixa a quem não dá baixa',
    ],
    [
      'modules/minha-area/PaginaMinhaArea.tsx',
      'const veCadastrosAlterados = veAlteracoesPendentesDoCadastro(user?.role);',
      'a Minha Área usa a mesma pergunta',
    ],
    [
      'components/comercial/CadastrosAlteradosParaOControl.tsx',
      "{podeConfirmar ? ' e dar baixa.' : '.'}",
      'a frase do cartão acompanha quem pode dar baixa',
    ],
  ])('%s — %s (%s)', (arquivo, portao) => {
    expect(fonte(arquivo), `${arquivo} perdeu o portão \`${portao}\``).toContain(portao);
  });

  /**
   * Os gates NEGATIVOS das telas de cliente (`role !== 'financeiro'`,
   * `role !== 'relacionamento'`): quem não está citado GANHA o botão, e foi
   * assim que o visualizador nasceu com quatro botões de escrita. São dois por
   * tela — contar é o que percebe UM deles voltando a ficar de fora.
   */
  it.each([
    ['modules/clientes/PaginaClientes.tsx', '"Novo cliente" e o carrinho de vender'],
    ['modules/clientes/PaginaCliente.tsx', '"Novo pedido" e "Trocar tabela"'],
  ])('%s tem DOIS portões — %s', (arquivo) => {
    const texto = fonte(arquivo);
    expect(texto.split('!ehSoLeitura(user?.role)').length - 1).toBe(2);
  });

  it('a tela de Pedidos continua exportando — exportar só lê', () => {
    // O pedido do Yan inclui as exportações entre o que ele PODE: elas geram
    // arquivo e não tocam em nada. Se alguém esconder por engano, cai aqui.
    const texto = fonte('modules/pedidos/PaginaPedidos.tsx');
    const botaoExportar = texto.indexOf('Exportar');
    const portao = texto.indexOf('{!soLeitura && (');
    expect(botaoExportar).toBeGreaterThan(-1);
    expect(portao, 'o portão passou a cobrir o botão Exportar').toBeGreaterThan(botaoExportar);
  });

  it('o papel tem ramo próprio no menu, antes do fall-through do rep', () => {
    const navItems = fonte('components/layout/navItems.ts');
    const posicaoDoRamo = navItems.indexOf("role === 'visualizador'");
    // `lastIndexOf`: o fall-through de verdade é o ÚLTIMO — o arquivo é muito
    // comentado, e um comentário citando `return repItems` vem antes dele.
    const posicaoDoFallback = navItems.lastIndexOf('return repItems');
    expect(posicaoDoRamo).toBeGreaterThan(-1);
    expect(posicaoDoRamo).toBeLessThan(posicaoDoFallback);
  });

  it.each(['dashboard', 'representantes', 'atividades', 'integracao', 'logins'])(
    'a rota /%s abre para o papel',
    (rota) => {
      const bloco = blocoDaRota(fonte('router/index.tsx'), rota);
      expect(bloco, `rota ${rota} não encontrada`).not.toBe('');
      expect(bloco, `rota ${rota} sem o papel no PrivateRoute`).toContain("'visualizador'");
    },
  );

  it('/orders/new ganhou guarda de papel e o visualizador não está nela', () => {
    const bloco = blocoDaRota(fonte('router/index.tsx'), 'orders/new');
    expect(bloco).toContain('PrivateRoute roles=');
    expect(bloco).not.toContain("'visualizador'");
  });

  it('"Copiar link do pedido" continua sem portão — copiar não manda nada', () => {
    // A linha de corte do defeito do WhatsApp: ENVIAR é ação, COPIAR não. O
    // botão de copiar fica, como as exportações da tela de Pedidos — e o bloco
    // que o embrulha segue guardado só por `ehLoja`/`public_link`.
    const texto = fonte('modules/pedidos/PaginaDetalhePedido.tsx');
    expect(texto).toContain('Copiar link do pedido');
    expect(
      texto,
      'o bloco do "Copiar link" perdeu o portão original (ou ganhou o de só leitura)',
    ).toMatch(/\{!ehLoja && order\.public_link && \(\s*<div/);
  });

  /**
   * Permissão sem porta: em 15/10/2026 a rota `GET /customers/alteracoes-
   * pendentes` passou a aceitar o visualizador e o helper
   * `veAlteracoesPendentesDoCadastro` ganhou o papel — mas o helper não tinha
   * UM chamador de produção, e a única tela que desenhava a fila era a Minha
   * Área, atrás de quem dá baixa e para onde ele nem chega (cai no Painel).
   * A fila que o pedido manda ele LER não aparecia em lugar nenhum.
   */
  it('a fila do Control tem porta: o helper é chamado em produção', () => {
    const usos = chamadoresDe('veAlteracoesPendentesDoCadastro');
    expect(
      usos,
      'veAlteracoesPendentesDoCadastro não tem chamador de produção — ou a fila não tem tela, ' +
        'ou a função é código morto',
    ).not.toHaveLength(0);
    // A porta do visualizador é o Painel: /minha-area redireciona o papel.
    expect(usos.join(' ')).toContain(path.join('modules', 'painel', 'PaginaPainel.tsx'));
  });

  it('a tela de Logins oferece o papel no formulário', () => {
    // Sem o papel no seletor, o admin não tem como criar o login; sem o grupo
    // na lista, o login criado fica invisível na tela.
    //
    // O anchor é o USO da lista, não o nome dela: conferir só
    // `'PAPEIS_GERENCIAVEIS'` passava com os botões voltando para o array
    // escrito à mão, porque a linha do `import` continua lá.
    expect(fonte('modules/logins/FormularioDeLogin.tsx')).toContain(
      '{PAPEIS_GERENCIAVEIS.map((papel) => (',
    );
    expect(fonte('modules/logins/PaginaLogins.tsx')).toContain("papel: 'visualizador'");
  });
});
