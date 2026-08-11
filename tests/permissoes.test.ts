import { describe, it, expect } from 'vitest';
import {
  temPermissao,
  PERMISSOES_PADRAO_GERENTE,
  TODAS_PERMISSOES,
} from '../packages/shared/src/constants/permissoes.js';

describe('temPermissao', () => {
  it('admin tem tudo, inclusive o que não está no array dele', () => {
    for (const tecla of TODAS_PERMISSOES) {
      expect(temPermissao('admin', [], tecla)).toBe(true);
      expect(temPermissao('admin', null, tecla)).toBe(true);
    }
  });

  it('gerente sem coluna gravada fica no padrão do papel — o que ele já fazia', () => {
    expect(temPermissao('manager', null, 'aprovar_pedidos')).toBe(true);
    expect(temPermissao('manager', undefined, 'faturar_pedidos')).toBe(true);
    expect(temPermissao('manager', null, 'gerenciar_representantes')).toBe(true);
    // Importar era exclusiva do admin: o gerente legado NÃO ganha isso de graça.
    expect(temPermissao('manager', null, 'importar_produtos')).toBe(false);
  });

  it('gerente com array gravado tem só o que está no array', () => {
    expect(temPermissao('manager', ['aprovar_pedidos'], 'aprovar_pedidos')).toBe(true);
    expect(temPermissao('manager', ['aprovar_pedidos'], 'faturar_pedidos')).toBe(false);
  });

  it('gerente com array vazio não tem nada — vazio é uma escolha, não ausência', () => {
    for (const tecla of TODAS_PERMISSOES) {
      expect(temPermissao('manager', [], tecla)).toBe(false);
    }
  });

  it('rep e loja passam: tecla é conceito de gerente, o papel deles já foi filtrado na rota', () => {
    expect(temPermissao('rep', null, 'aprovar_pedidos')).toBe(true);
    expect(temPermissao('store', null, 'aprovar_pedidos')).toBe(true);
    expect(temPermissao('guest', null, 'aprovar_pedidos')).toBe(true);
  });

  it('o padrão do papel é exatamente o que o gerente faz hoje', () => {
    expect([...PERMISSOES_PADRAO_GERENTE].sort()).toEqual(
      ['aprovar_pedidos', 'faturar_pedidos', 'gerenciar_representantes'].sort(),
    );
  });
});
