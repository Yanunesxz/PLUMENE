import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';
import { generateToken, hashToken } from '../apps/api/src/lib/tokens.js';

/**
 * Vitrine temporária — o link que o representante manda para o curioso.
 *
 * O que estes testes protegem: link vencido ou revogado não abre, e o token
 * guardado no banco nunca é o token do link.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';

async function carregar(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/access/showcase.service.js');
  return { ...mod, fake };
}

const daquiAHoras = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const horasAtras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const linkBase = {
  id: 'link-1',
  company_id: EMPRESA,
  rep_id: REP,
  price_table_id: 'tabela-1',
  opened_count: 3,
  last_opened_at: null,
  created_at: horasAtras(1),
};

beforeEach(() => {
  vi.resetModules();
});

describe('token de link', () => {
  it('gera valores diferentes a cada chamada', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('tem entropia suficiente para não ser adivinhado', () => {
    expect(generateToken().length).toBeGreaterThanOrEqual(42);
  });

  it('o hash é estável e não revela o token', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toHaveLength(64); // sha-256 em hex
  });
});

describe('abrir a vitrine', () => {
  it('abre quando o link está no prazo', async () => {
    const { abrirVitrine } = await carregar({
      showcase_links: { data: { ...linkBase, expires_at: daquiAHoras(5), revoked_at: null }, error: null },
    });

    const r = await abrirVitrine('qualquer');
    expect(r.ok).toBe(true);
  });

  it('recusa link vencido', async () => {
    const { abrirVitrine } = await carregar({
      showcase_links: { data: { ...linkBase, expires_at: horasAtras(1), revoked_at: null }, error: null },
    });

    const r = await abrirVitrine('qualquer');
    expect(r).toEqual({ ok: false, motivo: 'expirado' });
  });

  it('recusa link revogado, mesmo dentro do prazo', async () => {
    const { abrirVitrine } = await carregar({
      showcase_links: { data: { ...linkBase, expires_at: daquiAHoras(5), revoked_at: horasAtras(1) }, error: null },
    });

    const r = await abrirVitrine('qualquer');
    expect(r).toEqual({ ok: false, motivo: 'revogado' });
  });

  it('recusa token que não existe', async () => {
    const { abrirVitrine } = await carregar({ showcase_links: { data: null, error: null } });

    const r = await abrirVitrine('inventado');
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
  });

  it('procura pelo HASH, nunca pelo token em claro', async () => {
    const { abrirVitrine, fake } = await carregar({
      showcase_links: { data: { ...linkBase, expires_at: daquiAHoras(5), revoked_at: null }, error: null },
    });

    await abrirVitrine('token-secreto');

    const filtro = fake.filtrosDe('showcase_links', 'eq').find((f) => f.args[0] === 'token_hash');
    expect(filtro!.args[1]).toBe(hashToken('token-secreto'));
    expect(filtro!.args[1]).not.toBe('token-secreto');
  });

  it('conta a abertura — link muito aberto é sinal de que vazou', async () => {
    const { abrirVitrine, fake } = await carregar({
      showcase_links: { data: { ...linkBase, expires_at: daquiAHoras(5), revoked_at: null }, error: null },
    });

    await abrirVitrine('qualquer');

    const gravou = fake.ultimaGravacao('showcase_links', 'update')!.valores as { opened_count: number };
    expect(gravou.opened_count).toBe(4);
  });
});

describe('link amarrado a um cliente (035)', () => {
  it('criar com cliente grava o customer_id no link', async () => {
    const { criarVitrine, fake } = await carregar({
      showcase_links: [
        // sonda "a coluna customer_id existe?" (consome duas entradas — o
        // dublê pré-busca a resposta seguinte a cada from())
        { data: [], error: null },
        { data: [], error: null },
        { data: { id: 'link-9', expires_at: daquiAHoras(6) }, error: null },
      ],
    });
    const criado = await criarVitrine(EMPRESA, REP, 'tabela-1', 6, 'cliente-7');
    expect(criado?.id).toBe('link-9');
    const gravacao = fake.ultimaGravacao('showcase_links', 'insert');
    expect((gravacao?.valores as { customer_id?: string }).customer_id).toBe('cliente-7');
  });

  it('sem a migração 035, o vínculo é descartado e o link ainda nasce', async () => {
    const { criarVitrine, fake } = await carregar({
      showcase_links: [
        { data: null, error: { message: 'column customer_id does not exist' } },
        { data: null, error: { message: 'column customer_id does not exist' } },
        { data: { id: 'link-9', expires_at: daquiAHoras(6) }, error: null },
      ],
    });
    const criado = await criarVitrine(EMPRESA, REP, 'tabela-1', 6, 'cliente-7');
    expect(criado?.id).toBe('link-9');
    const gravacao = fake.ultimaGravacao('showcase_links', 'insert');
    expect((gravacao?.valores as { customer_id?: string }).customer_id).toBeUndefined();
  });
});

describe('o link vale por um pedido', () => {
  it('encerra assim que o pedido sai — dois pedidos pelo mesmo link é confusão', async () => {
    const { encerrarVitrinePorPedido, fake } = await carregar({
      showcase_links: { data: { id: 'link-1' }, error: null },
    });

    await encerrarVitrinePorPedido('link-1');

    const gravou = fake.ultimaGravacao('showcase_links', 'update')!.valores as { revoked_at: string };
    expect(gravou.revoked_at).toBeTruthy();
  });

  it('só encerra o que ainda está aberto — não reescreve a data de quem já foi revogado', async () => {
    const { encerrarVitrinePorPedido, fake } = await carregar({
      showcase_links: { data: { id: 'link-1' }, error: null },
    });

    await encerrarVitrinePorPedido('link-1');

    const condicoes = fake.filtrosDe('showcase_links', 'is').map((f) => f.args[0]);
    expect(condicoes).toContain('revoked_at');
  });

  it('link encerrado não abre de novo', async () => {
    const { abrirVitrine } = await carregar({
      showcase_links: {
        data: { ...linkBase, expires_at: daquiAHoras(5), revoked_at: horasAtras(0.1) },
        error: null,
      },
    });

    expect(await abrirVitrine('mesmo-token')).toEqual({ ok: false, motivo: 'revogado' });
  });
});

describe('criar a vitrine', () => {
  it('guarda o hash e devolve o token em claro uma única vez', async () => {
    const { criarVitrine, fake } = await carregar({
      showcase_links: { data: { id: 'novo', expires_at: daquiAHoras(6) }, error: null },
    });

    const criada = await criarVitrine(EMPRESA, REP, 'tabela-1', 6);

    const gravado = fake.ultimaGravacao('showcase_links', 'insert')!.valores as { token_hash: string };
    expect(gravado.token_hash).toBe(hashToken(criada!.token));
    expect(JSON.stringify(gravado)).not.toContain(criada!.token);
  });

  it('a validade escolhida vira a data de expiração', async () => {
    const { criarVitrine, fake } = await carregar({
      showcase_links: { data: { id: 'novo', expires_at: daquiAHoras(12) }, error: null },
    });

    await criarVitrine(EMPRESA, REP, 'tabela-1', 12);

    const { expires_at } = fake.ultimaGravacao('showcase_links', 'insert')!.valores as { expires_at: string };
    const horas = (new Date(expires_at).getTime() - Date.now()) / 3600_000;
    expect(horas).toBeGreaterThan(11.9);
    expect(horas).toBeLessThan(12.1);
  });
});
