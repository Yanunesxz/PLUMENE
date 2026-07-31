import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';
import { hashToken } from '../apps/api/src/lib/tokens.js';

/**
 * Convite de acesso da loja.
 *
 * A regra que mais importa aqui é o USO ÚNICO: o link cria uma conta e morre.
 * Se ele pudesse ser reusado, quem recebesse o print do WhatsApp criaria outra
 * conta para a mesma loja.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';
const CLIENTE = 'cliente-1';

async function carregar(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/access/invites.service.js');
  return { ...mod, fake };
}

const daquiADias = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
const ontem = () => new Date(Date.now() - 86400_000).toISOString();

const convitePendente = {
  id: 'convite-1',
  company_id: EMPRESA,
  customer_id: CLIENTE,
  rep_id: REP,
  expires_at: daquiADias(7),
  used_at: null,
  revoked_at: null,
  created_at: ontem(),
  customers: { name: 'Loja da Ana' },
  companies: { name: 'Corpo Sensual' },
};

beforeEach(() => {
  vi.resetModules();
});

describe('gerar o convite', () => {
  it('recusa cliente que não está na carteira do representante', async () => {
    const { criarConvite } = await carregar({ customers: { data: null, error: null } });

    const r = await criarConvite(EMPRESA, REP, 'de-outro-rep');
    expect(r).toEqual({ ok: false, motivo: 'cliente_nao_encontrado' });
  });

  it('recusa loja que já tem login', async () => {
    const { criarConvite } = await carregar({
      customers: { data: { id: CLIENTE }, error: null },
      users: { data: { id: 'usuario-existente' }, error: null },
    });

    const r = await criarConvite(EMPRESA, REP, CLIENTE);
    expect(r).toEqual({ ok: false, motivo: 'ja_tem_login' });
  });

  it('recusa quando já existe convite pendente — evita dois links circulando', async () => {
    const { criarConvite } = await carregar({
      customers: { data: { id: CLIENTE }, error: null },
      users: { data: null, error: null },
      store_invites: { data: { id: 'ja-existe' }, error: null },
    });

    const r = await criarConvite(EMPRESA, REP, CLIENTE);
    expect(r).toEqual({ ok: false, motivo: 'convite_pendente' });
  });

  it('guarda só o hash do token', async () => {
    const { criarConvite, fake } = await carregar({
      customers: { data: { id: CLIENTE }, error: null },
      users: { data: null, error: null },
      store_invites: [
        { data: null, error: null },
        { data: { id: 'convite-novo', expires_at: daquiADias(7) }, error: null },
      ],
    });

    const r = await criarConvite(EMPRESA, REP, CLIENTE);
    expect(r.ok).toBe(true);

    const gravado = fake.ultimaGravacao('store_invites', 'insert')!.valores as { token_hash: string };
    const token = (r as { ok: true; convite: { token: string } }).convite.token;
    expect(gravado.token_hash).toBe(hashToken(token));
  });

  it('gerente convida qualquer cliente da empresa, sem filtro de carteira', async () => {
    const { criarConvite, fake } = await carregar({
      customers: { data: { id: CLIENTE }, error: null },
      users: { data: null, error: null },
      store_invites: [
        { data: null, error: null },
        { data: { id: 'x', expires_at: daquiADias(7) }, error: null },
      ],
    });

    await criarConvite(EMPRESA, REP, CLIENTE, { irrestrito: true });

    const filtros = fake.filtrosDe('customers', 'eq').map((f) => f.args[0]);
    expect(filtros).not.toContain('rep_id');
  });
});

describe('abrir o convite', () => {
  it('mostra o nome da loja quando o convite está válido', async () => {
    const { abrirConvite } = await carregar({ store_invites: { data: convitePendente, error: null } });

    const r = await abrirConvite('token');
    expect(r.ok).toBe(true);
    expect((r as { ok: true; customer_name: string }).customer_name).toBe('Loja da Ana');
  });

  it('recusa convite já usado', async () => {
    const { abrirConvite } = await carregar({
      store_invites: { data: { ...convitePendente, used_at: ontem() }, error: null },
    });

    expect(await abrirConvite('token')).toEqual({ ok: false, motivo: 'usado' });
  });

  it('recusa convite vencido', async () => {
    const { abrirConvite } = await carregar({
      store_invites: { data: { ...convitePendente, expires_at: ontem() }, error: null },
    });

    expect(await abrirConvite('token')).toEqual({ ok: false, motivo: 'expirado' });
  });

  it('recusa convite revogado', async () => {
    const { abrirConvite } = await carregar({
      store_invites: { data: { ...convitePendente, revoked_at: ontem() }, error: null },
    });

    expect(await abrirConvite('token')).toEqual({ ok: false, motivo: 'revogado' });
  });
});

describe('usar o convite', () => {
  it('cria a conta como loja, amarrada ao cliente do convite', async () => {
    const { usarConvite, fake } = await carregar({
      store_invites: [
        { data: convitePendente, error: null },
        { data: { id: 'convite-1' }, error: null },
      ],
      users: [
        { data: null, error: null },
        { data: { id: 'usuario-novo' }, error: null },
      ],
    });

    const r = await usarConvite('token', 'Loja@Email.com', 'senha123');
    expect(r).toEqual({ ok: true, user_id: 'usuario-novo' });

    const criado = fake.ultimaGravacao('users', 'insert')!.valores as Record<string, unknown>;
    expect(criado['role']).toBe('store');
    expect(criado['customer_id']).toBe(CLIENTE);
    expect(criado['company_id']).toBe(EMPRESA);
    expect(criado['email']).toBe('loja@email.com'); // normalizado
    expect(criado['password_hash']).not.toBe('senha123'); // nunca em claro
  });

  it('queima o convite: a marcação exige que ele ainda esteja sem uso', async () => {
    const { usarConvite, fake } = await carregar({
      store_invites: [
        { data: convitePendente, error: null },
        { data: { id: 'convite-1' }, error: null },
      ],
      users: [
        { data: null, error: null },
        { data: { id: 'usuario-novo' }, error: null },
      ],
    });

    await usarConvite('token', 'a@b.com', 'senha123');

    // A condição `used_at IS NULL` no update é o que impede duas requisições
    // simultâneas com o mesmo token criarem duas contas.
    const usados = fake.filtrosDe('store_invites', 'is').map((f) => f.args[0]);
    expect(usados).toContain('used_at');
  });

  it('segunda tentativa com o mesmo link não cria outra conta', async () => {
    const { usarConvite } = await carregar({
      store_invites: { data: { ...convitePendente, used_at: ontem() }, error: null },
    });

    expect(await usarConvite('token', 'a@b.com', 'senha123')).toEqual({ ok: false, motivo: 'usado' });
  });

  it('recusa e-mail já cadastrado', async () => {
    const { usarConvite } = await carregar({
      store_invites: { data: convitePendente, error: null },
      users: { data: { id: 'outro-usuario' }, error: null },
    });

    expect(await usarConvite('token', 'existe@csb.com', 'senha123')).toEqual({
      ok: false,
      motivo: 'email_em_uso',
    });
  });

  it('devolve o convite se a criação da conta falhar', async () => {
    const { usarConvite, fake } = await carregar({
      store_invites: [
        { data: convitePendente, error: null },
        { data: { id: 'convite-1' }, error: null },
      ],
      users: [
        { data: null, error: null },
        { data: null, error: { message: 'falhou' } },
      ],
    });

    const r = await usarConvite('token', 'a@b.com', 'senha123');
    expect(r).toEqual({ ok: false, motivo: 'erro' });

    // Sem esta devolução, a loja ficaria sem conta E sem convite.
    const ultima = fake.ultimaGravacao('store_invites', 'update')!.valores as { used_at: null };
    expect(ultima.used_at).toBeNull();
  });
});
