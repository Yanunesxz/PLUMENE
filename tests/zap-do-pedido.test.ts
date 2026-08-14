import { describe, it, expect } from 'vitest';
import { linkDoWhatsApp } from '../apps/web/src/lib/pedido.js';

/**
 * O botão "Enviar pedido no WhatsApp" monta um wa.me com o número do cadastro.
 * O cadastro veio do Control SEM o DDI — e o wa.me sem o 55 diz que o número
 * não existe. Estes testes seguram a montagem do link.
 */
describe('link do WhatsApp do pedido', () => {
  it('põe o 55 na frente do número nacional (DDD + linha)', () => {
    expect(linkDoWhatsApp('(11) 1734-0709', 'oi')).toBe(
      `https://wa.me/551117340709?text=${encodeURIComponent('oi')}`,
    );
    expect(linkDoWhatsApp('32 99849 3125', 'oi')).toBe(
      `https://wa.me/5532998493125?text=${encodeURIComponent('oi')}`,
    );
  });

  it('não duplica o 55 de quem já veio internacional', () => {
    expect(linkDoWhatsApp('+55 32 99849-3125', 'oi')).toBe(
      `https://wa.me/5532998493125?text=${encodeURIComponent('oi')}`,
    );
  });

  it('sem número, abre o seletor de conversa com a mensagem pronta', () => {
    expect(linkDoWhatsApp(null, 'oi')).toBe(`https://wa.me/?text=${encodeURIComponent('oi')}`);
    expect(linkDoWhatsApp('', 'oi')).toBe(`https://wa.me/?text=${encodeURIComponent('oi')}`);
  });

  it('sem mensagem, abre só a conversa (o ícone de contato usa assim)', () => {
    expect(linkDoWhatsApp('(11) 1734-0709')).toBe('https://wa.me/551117340709');
  });

  it('codifica o link público inteiro dentro da mensagem', () => {
    const url = linkDoWhatsApp('32999999999', 'Veja: https://app.com/pedido/abc.def');
    expect(url).toContain(encodeURIComponent('https://app.com/pedido/abc.def'));
    expect(url).not.toContain('pedido/abc.def?'); // nada solto sem codificar
  });
});
