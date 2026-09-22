import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DIGITOS_MINIMOS_DO_WHATSAPP as DIGITOS_DO_SHARED, campoSoDoAppPreenchido } from '@csb/shared';
import {
  DIGITOS_MINIMOS_DO_WHATSAPP,
  clientesComWhatsappEditadoNoApp,
  linhaParaClienteExistente,
  temWhatsapp,
} from '../_tools/importar-clientes-regras.mjs';

/**
 * A carga por código (_tools/importar-clientes.mjs) e o WhatsApp do app
 * (22/09/2026). Pedido do Yan: "que eu possa alterar o wtss do cliente sem ter
 * que subir pro control, numero uma coisa numero de wtss outro".
 *
 * O script em si lê o .env e o banco na hora em que é carregado — não dá para
 * importar num teste. A regra mora num módulo sem efeito colateral
 * (importar-clientes-regras.mjs), testado aqui; e o script é conferido por
 * leitura: ele tem de usar a regra no cliente que já existe.
 */

const linha = {
  company_id: 'empresa-ficticia',
  erp_id: '09999',
  name: 'LOJA FICTICIA LTDA',
  whatsapp: '32900000009', // o telefone do Excel do Control
  email: 'loja@exemplo.com',
  address: 'Rua Ficticia, 10',
};

describe('carga por código: o WhatsApp só preenche o vazio (22/09/2026)', () => {
  it('cliente existente com WhatsApp preenchido: o do Excel não entra — o resto vai', () => {
    const patch = linhaParaClienteExistente(linha, { id: 'c1', whatsapp: '32988880000' });
    expect('whatsapp' in patch).toBe(false);
    expect(patch).toMatchObject({ name: 'LOJA FICTICIA LTDA', email: 'loja@exemplo.com', address: 'Rua Ficticia, 10' });
    // A linha de entrada não é mexida (a mesma serve para criar, se precisar).
    expect(linha.whatsapp).toBe('32900000009');
  });

  it('cliente existente com WhatsApp vazio (null, "" ou só espaço), ou sem a leitura: o do Excel preenche', () => {
    for (const vazio of [null, undefined, '', '   ']) {
      expect(linhaParaClienteExistente(linha, { id: 'c1', whatsapp: vazio })).toMatchObject({ whatsapp: '32900000009' });
    }
    expect(linhaParaClienteExistente(linha, undefined)).toMatchObject({ whatsapp: '32900000009' });
  });

  // ─── Revisão de 22/09/2026 ───────────────────────────────────────────────

  it('WhatsApp com um NOME no lugar do número (carga de carteira antiga): conta como vazio, e o número do Excel o troca', () => {
    for (const lixo of ['MARIA', 'JUNIOR', '0', '1234567']) {
      expect(linhaParaClienteExistente(linha, { id: 'c1', whatsapp: lixo }), lixo).toMatchObject({ whatsapp: '32900000009' });
    }
  });

  it('WhatsApp que o app APAGOU de propósito (edição dele no histórico): continua vazio — o telefone do Excel não volta', () => {
    const editados = new Set(['c1']);
    const patch = linhaParaClienteExistente(linha, { id: 'c1', whatsapp: null }, editados);
    expect('whatsapp' in patch).toBe(false);
    expect(patch).toMatchObject({ email: 'loja@exemplo.com' });
    // Outro cliente, sem edição do WhatsApp no app: preenche como sempre.
    expect(linhaParaClienteExistente(linha, { id: 'c2', whatsapp: null }, editados)).toMatchObject({
      whatsapp: '32900000009',
    });
  });

  it('WhatsApp vazio no Excel nunca apaga nada — nem o nome que o conserto ainda vai trocar', () => {
    for (const vazio of [null, '', '  ']) {
      for (const doApp of ['32988880000', 'MARIA', null]) {
        const patch = linhaParaClienteExistente({ ...linha, whatsapp: vazio }, { id: 'c1', whatsapp: doApp });
        expect('whatsapp' in patch, `${String(vazio)} sobre ${String(doApp)}`).toBe(false);
      }
    }
  });

  it('clientesComWhatsappEditadoNoApp: só as linhas do histórico com a chave whatsapp em campos', () => {
    const ids = clientesComWhatsappEditadoNoApp([
      { customer_id: 'c1', campos: { whatsapp: { antes: '32999990000', depois: null } } },
      { customer_id: 'c2', campos: { email: { antes: 'a@exemplo.com', depois: 'b@exemplo.com' } } },
      { customer_id: 'c3', campos: { whatsapp: { antes: null, depois: '32988880000' }, email: { antes: null, depois: 'c@exemplo.com' } } },
      { customer_id: 'c4', campos: null },
    ]);
    expect([...ids].sort()).toEqual(['c1', 'c3']);
    expect(clientesComWhatsappEditadoNoApp([]).size).toBe(0);
  });

  it('a régua do "é telefone" é a mesma do shared (o POST /partner/v1/clientes) — o script não importa TypeScript', () => {
    expect(DIGITOS_MINIMOS_DO_WHATSAPP).toBe(DIGITOS_DO_SHARED);
    for (const v of [null, '', '  ', 'MARIA', '0', '1234567', '12345678', '(32) 99999-0000', '3233331111']) {
      expect(temWhatsapp(v), String(v)).toBe(campoSoDoAppPreenchido('whatsapp', v));
    }
  });

  it('o script lê o WhatsApp dos existentes e o histórico do app, e usa a regra no cliente que já existe', () => {
    const script = readFileSync(path.resolve(__dirname, '../_tools/importar-clientes.mjs'), 'utf8');
    expect(script).toContain(
      "import { clientesComWhatsappEditadoNoApp, linhaParaClienteExistente } from './importar-clientes-regras.mjs';",
    );
    expect(script).toContain("baixarTudo('customers', 'id, erp_id, cnpj, whatsapp', true)");
    // O histórico: só as linhas que mexeram no WhatsApp, e a 051 ausente não para a carga.
    expect(script).toMatch(/\.from\('customer_changes'\)/);
    expect(script).toMatch(/\.not\('campos->whatsapp', 'is', null\)/);
    expect(script).toMatch(/PGRST205/);
    expect(script).toMatch(
      /linhaParaClienteExistente\(linha, existentePorId\.get\(existeId\), whatsappsEditadosNoApp\)/,
    );
    // O que vai para o update é o patch da regra, nunca a linha crua.
    expect(script).toMatch(/paraAtualizar\.push\(\{ id: existeId, \.\.\.patch \}\)/);
    expect(script).not.toMatch(/paraAtualizar\.push\(\{ id: existeId, \.\.\.linha \}\)/);
  });
});
