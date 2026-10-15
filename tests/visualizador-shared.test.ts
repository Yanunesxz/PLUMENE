import { describe, it, expect } from 'vitest';
import {
  PAPEIS_COMPRADORES,
  PAPEIS_DA_FABRICA,
  PAPEIS_GERENCIAVEIS,
  PAPEIS_QUE_LEEM_O_ESCRITORIO,
  PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL,
  SO_LEITURA,
  USER_ROLE,
  USER_ROLE_LABELS,
  ehComprador,
  ehPapelGerenciavel,
  ehSoLeitura,
  editaQualquerCliente,
  podeCancelarPedido,
  podeConfirmarAlteracaoNoControl,
  podeEditarCadastroDoCliente,
  podeInformarMotivo,
  podeTrocarClienteDoPedido,
  podeTrocarDocumentoDoCliente,
  teclaLigaOBotao,
  temPermissao,
  usaStatusInterno,
  veAlteracoesPendentesDoCadastro,
} from '@csb/shared';
import type { AuthRole, Order } from '@csb/shared';

/**
 * O papel visualizador (054) nas regras do @csb/shared — as funções puras que
 * as telas e a API consultam.
 *
 * Pedido do Yan (15/10/2026): "ele pode ver tudo so nao pode alterar nada".
 * Aqui isso vira duas perguntas, feitas uma por uma: ele está em toda lista de
 * LEITURA, e em nenhuma lista de ESCRITA?
 */

const PAPEL: AuthRole = 'visualizador';

describe('o papel existe e tem nome', () => {
  it('está em USER_ROLE', () => {
    expect(USER_ROLE.VISUALIZADOR).toBe('visualizador');
  });

  it('tem rótulo — é o que aparece no menu e na tela de Logins', () => {
    expect(USER_ROLE_LABELS.visualizador).toBe('Visualizador');
  });

  it('o admin pode criar este login', () => {
    expect(ehPapelGerenciavel(PAPEL)).toBe(true);
    expect(PAPEIS_GERENCIAVEIS).toContain(PAPEL);
  });

  it('a lista de papéis gerenciáveis segue a ordem da tela', () => {
    // Gerente | Financeiro | Relacionamento | Visualizador | Administrador.
    expect([...PAPEIS_GERENCIAVEIS]).toEqual([
      'manager',
      'financeiro',
      'relacionamento',
      'visualizador',
      'admin',
    ]);
  });

  it('representante e loja continuam nascendo nas telas próprias', () => {
    expect(ehPapelGerenciavel('rep')).toBe(false);
    expect(ehPapelGerenciavel('store')).toBe(false);
    expect(ehPapelGerenciavel('guest')).toBe(false);
  });
});

describe('ehSoLeitura', () => {
  it('é verdade para o visualizador', () => {
    expect(ehSoLeitura(PAPEL)).toBe(true);
    expect(SO_LEITURA).toContain(PAPEL);
  });

  it.each<[AuthRole]>([
    ['admin'],
    ['manager'],
    ['financeiro'],
    ['relacionamento'],
    ['rep'],
    ['store'],
    ['guest'],
  ])('é mentira para %s — nenhum outro papel ficou de leitura por acidente', (papel) => {
    expect(ehSoLeitura(papel)).toBe(false);
  });

  it('papel ausente não é "só leitura" — quem decide isso é a rota', () => {
    expect(ehSoLeitura(undefined)).toBe(false);
    expect(ehSoLeitura(null)).toBe(false);
  });
});

describe('as listas de papéis', () => {
  it('LÊ como o escritório', () => {
    expect(PAPEIS_QUE_LEEM_O_ESCRITORIO).toContain(PAPEL);
  });

  it('a lista de leitura é a da fábrica MAIS ele — ninguém a mais', () => {
    expect([...PAPEIS_QUE_LEEM_O_ESCRITORIO].sort()).toEqual(
      [...PAPEIS_DA_FABRICA, PAPEL].sort(),
    );
  });

  it('NÃO entra em PAPEIS_DA_FABRICA — essa lista é de quem MEXE em pedido', () => {
    expect(PAPEIS_DA_FABRICA).not.toContain(PAPEL);
  });

  it('NÃO compra', () => {
    expect(PAPEIS_COMPRADORES).not.toContain(PAPEL);
    expect(ehComprador(PAPEL)).toBe(false);
  });
});

describe('nenhuma regra de ESCRITA deixa o visualizador passar', () => {
  it('não edita o cadastro do cliente', () => {
    expect(podeEditarCadastroDoCliente(PAPEL)).toBe(false);
  });

  it('não edita cliente de carteira alheia (não edita nenhum)', () => {
    expect(editaQualquerCliente(PAPEL)).toBe(false);
  });

  it('não troca o CPF/CNPJ', () => {
    expect(podeTrocarDocumentoDoCliente(PAPEL)).toBe(false);
  });

  it('não dá baixa na fila do Control', () => {
    expect(podeConfirmarAlteracaoNoControl(PAPEL)).toBe(false);
  });

  it('não cancela pedido', () => {
    const pedido = { status: 'pending_approval', invoiced: false, rep_id: 'vis-1' } as Order;
    expect(podeCancelarPedido(pedido, PAPEL, 'vis-1', false)).toBe('forbidden');
  });

  it('não informa o motivo de um cancelamento', () => {
    const pedido = { status: 'rejected', invoiced: false } as Order;
    expect(podeInformarMotivo(pedido, PAPEL)).toBe(false);
  });

  it('não troca o cliente do pedido', () => {
    const pedido = { status: 'pending_approval', invoiced: false, rep_id: 'vis-1' } as Order;
    expect(podeTrocarClienteDoPedido(pedido, PAPEL, 'vis-1')).toBe('forbidden');
  });
});

describe('as regras de LEITURA incluem o visualizador', () => {
  it('vê o status interno do pedido, como o resto do escritório', () => {
    // Sem isto a lista dele mostraria os três degraus do CLIENTE ("Enviado pra
    // fábrica") em vez do que o financeiro está vendo na mesma tela.
    expect(usaStatusInterno(PAPEL)).toBe(true);
  });

  it('vê a fila "Cadastros alterados para atualizar no Control"', () => {
    expect(veAlteracoesPendentesDoCadastro(PAPEL)).toBe(true);
    expect(PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL).toContain(PAPEL);
  });

  it('e a fila tem UMA lista só — a rota e as duas telas leem daqui', () => {
    // Eram três listas escritas à mão (o requireRole, o portão do cartão na
    // Minha Área e o do Painel). Com três, a rota liberou o visualizador e a
    // tela não desenhou a fila: permissão sem porta (15/10/2026).
    const todos: AuthRole[] = [
      'admin',
      'manager',
      'financeiro',
      'relacionamento',
      'visualizador',
      'rep',
      'store',
      'guest',
    ];
    for (const papel of todos) {
      expect(
        veAlteracoesPendentesDoCadastro(papel),
        `${papel}: a função e a lista discordam`,
      ).toBe(PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL.includes(papel));
    }
  });

  it('ver a fila NÃO é dar baixa nela', () => {
    // O visualizador e o gerente veem a fila e não dão baixa; o cartão recebe
    // isso em `podeConfirmar` e nem promete o botão.
    for (const papel of ['visualizador', 'manager'] as const) {
      expect(veAlteracoesPendentesDoCadastro(papel)).toBe(true);
      expect(podeConfirmarAlteracaoNoControl(papel)).toBe(false);
    }
  });

  it('e isso não mudou para quem já via (nem liberou quem não via)', () => {
    expect(usaStatusInterno('manager')).toBe(true);
    expect(usaStatusInterno('rep')).toBe(false);
    expect(usaStatusInterno('store')).toBe(false);
    expect(veAlteracoesPendentesDoCadastro('financeiro')).toBe(true);
    expect(veAlteracoesPendentesDoCadastro('rep')).toBe(false);
  });
});

describe('temPermissao continua como era', () => {
  /**
   * De propósito: `temPermissao` deixa passar quem não é gerente, e é isso que
   * mantém a triagem do representante viva em `PATCH /orders/:id/status`.
   * Portanto a tecla NÃO barra o visualizador — quem barra é o `requireRole`
   * da rota, e no web o `usePermissao`, que tem o ramo de só leitura.
   *
   * O teste existe para que ninguém "conserte" isto aqui: mudar `temPermissao`
   * trancaria o visualizador FORA de /representantes, que é uma tela de
   * leitura dele (a rota exige a tecla `gerenciar_representantes`).
   */
  it('a tecla do gerente não é o que segura o visualizador', () => {
    expect(temPermissao(PAPEL, null, 'aprovar_pedidos')).toBe(true);
    expect(temPermissao(PAPEL, null, 'gerenciar_representantes')).toBe(true);
  });

  it('o gerente legado (coluna nula) não perdeu nada', () => {
    expect(temPermissao('manager', null, 'aprovar_pedidos')).toBe(true);
    expect(temPermissao('manager', null, 'importar_produtos')).toBe(false);
  });
});

describe('teclaLigaOBotao — o que o app mostra', () => {
  /**
   * A outra metade da dupla: `temPermissao` diz quem ENTRA, esta diz se o
   * BOTÃO aparece. É a função que o `usePermissao` do web chama, e é por ela
   * que "Excluir pedido" e "Enviar pra fábrica" somem da tela do visualizador
   * — esses dois botões eram guardados SÓ pela tecla, que não o barra.
   */
  it.each(['aprovar_pedidos', 'faturar_pedidos', 'gerenciar_representantes', 'importar_produtos'] as const)(
    'nenhum botão de %s para o visualizador',
    (tecla) => {
      expect(teclaLigaOBotao(PAPEL, null, tecla)).toBe(false);
      // Nem com a coluna "ligada" na mão: o papel vem antes da tecla.
      expect(teclaLigaOBotao(PAPEL, [tecla], tecla)).toBe(false);
    },
  );

  it('o admin continua com tudo', () => {
    expect(teclaLigaOBotao('admin', null, 'aprovar_pedidos')).toBe(true);
    expect(teclaLigaOBotao('admin', [], 'importar_produtos')).toBe(true);
  });

  it('o gerente continua respondendo pelas teclas dele', () => {
    expect(teclaLigaOBotao('manager', ['aprovar_pedidos'], 'aprovar_pedidos')).toBe(true);
    expect(teclaLigaOBotao('manager', ['aprovar_pedidos'], 'faturar_pedidos')).toBe(false);
    expect(teclaLigaOBotao('manager', null, 'aprovar_pedidos')).toBe(true);
    expect(teclaLigaOBotao('manager', null, 'importar_produtos')).toBe(false);
  });

  it('o representante não perdeu a triagem', () => {
    // Era o risco de mexer em `temPermissao`: devolver false para rep
    // derrubaria o botão de mandar o pedido para a fábrica.
    expect(teclaLigaOBotao('rep', null, 'aprovar_pedidos')).toBe(true);
  });

  it('a venda interna continua faturando o pedido dela', () => {
    expect(teclaLigaOBotao('rep', null, 'faturar_pedidos')).toBe(true);
  });
});
