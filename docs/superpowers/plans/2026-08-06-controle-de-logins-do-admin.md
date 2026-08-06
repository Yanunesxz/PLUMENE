# Controle de logins do admin — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao admin uma tela onde ele cria, bloqueia, troca senha e exclui qualquer login da empresa — e, para o gerente, liga e desliga cinco teclas de permissão que hoje vêm todas juntas no papel.

**Architecture:** Módulo `users` novo e isolado na API (nunca toca `reps/`), coluna `permissions TEXT[]` em `users` cujo valor nulo significa "padrão do papel", e um `requirePermission` que só morde o papel `manager` — `admin` passa sempre e os outros papéis já foram filtrados pelo `requireRole` da rota. No web, uma tela nova em `/logins` e um `usePermissao` que esconde botão em vez de deixar a pessoa tomar 403 no toque.

**Tech Stack:** Fastify + @fastify/jwt + Supabase (service_role) na API; React 18 + react-router-dom + zustand + Tailwind no web; Vitest com `app.inject` e o dublê `tests/supabaseFake.ts`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-06-controle-de-logins-do-admin-design.md`. Base: `main` @ `7de5dbc`.
- **Nada do que já funciona pode mudar de comportamento.** Gerente com `permissions` nulo mantém exatamente os poderes de hoje: `aprovar_pedidos`, `faturar_pedidos`, `gerenciar_representantes` e `ver_comissoes` ligadas; `importar_produtos` desligada.
- **O código roda sem a migração 022 aplicada.** As migrações são executadas à mão no Supabase. Leitura usa `select('*')` (nunca nomeia coluna nova); escrita usa o padrão de detecção de `reps.service.ts` (`detectarErpRepId`) e devolve `aviso` quando ignora as teclas.
- **Isolamento entre fábricas é da camada de aplicação** (o `service_role` ignora RLS): toda consulta e toda escrita filtram por `company_id` vindo do token.
- **`password_hash` nunca sai numa resposta.** `select('*')` na tabela `users` traz a coluna — o mapeamento para `UsuarioListItem` é explícito, campo a campo.
- Comentários e textos de tela em português, no tom do repositório: explicam *por que*, não *o que*.
- Comandos: `pnpm test` (Vitest), `pnpm typecheck`, `pnpm build`, `pnpm verify` (os três em sequência).
- Commits em português, no formato do repositório: `feat(logins): ...`, `fix(...)`. Rodapé `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Vocabulário das permissões no pacote compartilhado

O tipo, as cinco teclas, o padrão do papel e a única função que decide se alguém tem uma tecla. API e web importam daqui — duas implementações da mesma regra é como uma delas fica para trás.

**Files:**
- Create: `packages/shared/src/constants/permissoes.ts`
- Modify: `packages/shared/src/index.ts` (acrescentar o export)
- Modify: `packages/shared/src/types/user.ts` (campos novos em `User` e `AuthPayload`, tipos de `/usuarios`)
- Create: `apps/api/src/config/migrations/022_controle_de_logins.sql`
- Test: `tests/permissoes.test.ts`

**Interfaces:**
- Consumes: `AuthRole`, `UserRole` de `packages/shared/src/constants/userRole.js`
- Produces:
  - `PERMISSOES_GERENTE`, `type PermissaoGerente`, `TODAS_PERMISSOES: readonly PermissaoGerente[]`, `PERMISSOES_PADRAO_GERENTE: readonly PermissaoGerente[]`, `PERMISSAO_LABELS: Record<PermissaoGerente, { titulo: string; descricao: string }>`
  - `temPermissao(role: AuthRole, permissions: readonly string[] | null | undefined, tecla: PermissaoGerente): boolean`
  - `interface UsuarioListItem`, `interface CriarUsuarioRequest`, `interface AtualizarUsuarioRequest`
  - `User.permissions?: PermissaoGerente[] | null`, `User.last_login_at?: string | null`, `AuthPayload.permissions?: PermissaoGerente[] | null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/permissoes.test.ts`:

```ts
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
    expect(temPermissao('manager', null, 'ver_comissoes')).toBe(true);
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
      ['aprovar_pedidos', 'faturar_pedidos', 'gerenciar_representantes', 'ver_comissoes'].sort(),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/permissoes.test.ts`
Expected: FAIL — `Cannot find module '../packages/shared/src/constants/permissoes.js'`

- [ ] **Step 3: Criar `packages/shared/src/constants/permissoes.ts`**

```ts
import type { AuthRole } from './userRole.js';

/**
 * Teclas do gerente.
 *
 * "Gerente" era um bloco só: quem entrava como gerente aprovava pedido, faturava,
 * mexia em representante e via comissão. Não dava para entregar um pedaço. Estas
 * teclas quebram esse bloco — e existem SÓ para o papel `manager`: o admin tem
 * tudo por definição, e rep e loja são delimitados pelo próprio papel.
 */
export const PERMISSOES_GERENTE = {
  APROVAR_PEDIDOS: 'aprovar_pedidos',
  FATURAR_PEDIDOS: 'faturar_pedidos',
  GERENCIAR_REPRESENTANTES: 'gerenciar_representantes',
  VER_COMISSOES: 'ver_comissoes',
  IMPORTAR_PRODUTOS: 'importar_produtos',
} as const;

export type PermissaoGerente = (typeof PERMISSOES_GERENTE)[keyof typeof PERMISSOES_GERENTE];

export const TODAS_PERMISSOES: readonly PermissaoGerente[] = Object.values(PERMISSOES_GERENTE);

/**
 * O que um gerente sem nada gravado tem.
 *
 * É a lista do que o papel `manager` já fazia antes destas teclas existirem —
 * nem mais, nem menos. `importar_produtos` fica de fora porque a importação era
 * exclusiva do admin: ligar isso no dia do deploy daria poder novo a quem
 * ninguém decidiu dar.
 */
export const PERMISSOES_PADRAO_GERENTE: readonly PermissaoGerente[] = [
  PERMISSOES_GERENTE.APROVAR_PEDIDOS,
  PERMISSOES_GERENTE.FATURAR_PEDIDOS,
  PERMISSOES_GERENTE.GERENCIAR_REPRESENTANTES,
  PERMISSOES_GERENTE.VER_COMISSOES,
];

export const PERMISSAO_LABELS: Record<PermissaoGerente, { titulo: string; descricao: string }> = {
  aprovar_pedidos: {
    titulo: 'Aprovar pedidos',
    descricao: 'Aprovar, recusar e excluir pedido.',
  },
  faturar_pedidos: {
    titulo: 'Faturar',
    descricao: 'Marcar e desmarcar pedido como faturado.',
  },
  gerenciar_representantes: {
    titulo: 'Representantes',
    descricao: 'Cadastrar, editar, excluir e definir meta de bonificação.',
  },
  ver_comissoes: {
    titulo: 'Comissões',
    descricao: 'Abrir a tela de comissões.',
  },
  importar_produtos: {
    titulo: 'Importar produtos',
    descricao: 'Subir planilha de catálogo e fotos.',
  },
};

/**
 * Esta pessoa pode fazer isto?
 *
 * Três regras, e a ordem importa:
 *
 * 1. `admin` passa sempre — teclas nem são consultadas. Um admin que se tranca
 *    fora do próprio sistema é o pior estado possível.
 * 2. Quem não é `manager` passa. A tecla não fala sobre ele: quem decide se um
 *    rep entra na rota é o `requireRole` dela, e essa decisão já foi tomada
 *    antes de chegar aqui. Devolver `false` para rep faria o guard de
 *    `PATCH /orders/:id/status` derrubar a triagem do representante, que divide
 *    a rota com o gerente.
 * 3. `manager` com a coluna nula cai no padrão do papel — é o que garante que
 *    ninguém perde poder no dia em que isto entrou no ar. Array vazio é
 *    diferente de nulo: vazio é o admin dizendo "este não faz nada".
 */
export function temPermissao(
  role: AuthRole,
  permissions: readonly string[] | null | undefined,
  tecla: PermissaoGerente,
): boolean {
  if (role === 'admin') return true;
  if (role !== 'manager') return true;
  if (permissions == null) return PERMISSOES_PADRAO_GERENTE.includes(tecla);
  return permissions.includes(tecla);
}
```

- [ ] **Step 4: Exportar do índice do pacote**

Em `packages/shared/src/index.ts`, acrescentar na lista de constants (mantendo a ordem alfabética existente, logo após `./constants/orderStatus.js`):

```ts
export * from './constants/permissoes.js';
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm vitest run tests/permissoes.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 6: Acrescentar os campos e tipos em `packages/shared/src/types/user.ts`**

No topo do arquivo, estender o import:

```ts
import type { AuthRole, UserRole } from '../constants/userRole.js';
import type { PermissaoGerente } from '../constants/permissoes.js';
```

Na interface `User`, logo depois de `rep_id?: string | null;`:

```ts
  /**
   * Teclas do gerente. Nulo = padrão do papel (ver `temPermissao`). Só o papel
   * `manager` usa isto: admin tem tudo, rep e loja são delimitados pelo papel.
   */
  permissions?: PermissaoGerente[] | null;
  /** Último login bem-sucedido. Nulo em quem nunca entrou. */
  last_login_at?: string | null;
```

Na interface `AuthPayload`, logo depois de `rep_id?: string | null;`:

```ts
  /** Teclas do gerente, para o guard não precisar ir ao banco a cada requisição. */
  permissions?: PermissaoGerente[] | null;
```

No fim do arquivo, os tipos da tela de logins:

```ts
// ─── Controle de logins (admin) ───────────────────────────────────────────────
// Papéis que o admin cria por aqui. Representante nasce em `/reps` (precisa de
// CPF, tabela, comissão e código ERP) e loja nasce por convite — ter dois
// lugares criando a mesma coisa é como um deles fica esquecido.
export type PapelGerenciavel = Extract<UserRole, 'admin' | 'manager'>;

/** Um login na tela do admin. Nunca carrega hash de senha. */
export interface UsuarioListItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  last_login_at: string | null;
  /** Só faz sentido em gerente. Nulo = padrão do papel. */
  permissions: PermissaoGerente[] | null;
  created_at: string;
}

export interface CriarUsuarioRequest {
  name: string;
  email: string;
  password: string;
  role: PapelGerenciavel;
  /** Omitido em gerente = padrão do papel. Ignorado quando o papel é admin. */
  permissions?: PermissaoGerente[];
}

/** Edição — só o que veio no corpo muda. */
export interface AtualizarUsuarioRequest {
  name?: string;
  email?: string;
  /** Preenchida, redefine a senha. Ausente ou vazia, mantém a atual. */
  password?: string;
  active?: boolean;
  /** Troca de papel só entre admin e gerente. */
  role?: PapelGerenciavel;
  permissions?: PermissaoGerente[] | null;
}
```

- [ ] **Step 7: Escrever a migração 022**

Criar `apps/api/src/config/migrations/022_controle_de_logins.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 022 — Controle de logins pelo admin
-- Executar no Supabase SQL Editor. Idempotente e aditiva.
--
-- Duas colunas, dois problemas.
--
-- `permissions` quebra o bloco "gerente". Até aqui, quem entrava como gerente
-- aprovava pedido, faturava, mexia em representante e via comissão — tudo junto,
-- sem meio-termo. O admin não tinha como entregar um pedaço.
--
-- NULO é significativo: quer dizer "padrão do papel", que é exatamente o que o
-- gerente já fazia. Todo gerente que existe hoje continua nulo e não perde nada.
-- O array só passa a existir quando o admin salva as teclas dele. Array VAZIO é
-- diferente de nulo: é o admin dizendo "este gerente não faz nada".
--
-- `last_login_at` responde "quem de fato usa isto?". Sem ela, a única forma de
-- saber se um login ainda serve é perguntar para a pessoa.
--
-- Sem esta migração o sistema roda: a leitura usa `select('*')` e a escrita
-- detecta a coluna antes de gravar, avisando na tela quando ignorou as teclas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions   TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

COMMENT ON COLUMN users.permissions IS
  'Teclas do gerente. NULO = padrão do papel; array vazio = nenhuma permissão. Ignorada nos demais papéis.';
COMMENT ON COLUMN users.last_login_at IS
  'Último login bem-sucedido. Gravado sem segurar a resposta do login.';
```

- [ ] **Step 8: Verificar tipos e rodar a suíte inteira**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — typecheck limpo e nenhum teste existente quebrado.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/constants/permissoes.ts packages/shared/src/index.ts packages/shared/src/types/user.ts apps/api/src/config/migrations/022_controle_de_logins.sql tests/permissoes.test.ts
git commit -m "feat(logins): as teclas do gerente, e a migracao 022"
```

---

### Task 2: As teclas entram no token, e o login carimba a data

Sem isto o guard da Task 3 não tem o que ler. O `refresh` passa a devolver o usuário junto do token — senão o web fica com teclas velhas na tela até a pessoa deslogar, mesmo com o servidor já negando.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (`buildAuthPayload`, nova `registrarAcesso`)
- Modify: `apps/api/src/modules/auth/auth.controller.ts` (`login`, `refreshToken`)
- Test: `tests/login-e-token.test.ts`

**Interfaces:**
- Consumes: `temPermissao`, `PermissaoGerente` (Task 1); `User`, `AuthPayload` já estendidos (Task 1)
- Produces:
  - `registrarAcesso(userId: string): Promise<void>` em `auth.service.ts`
  - `buildAuthPayload` passa a preencher `permissions`
  - `POST /auth/refresh` responde `{ data: { token, user } }` — `user` no mesmo formato do login

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/login-e-token.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O login precisa carregar as teclas do gerente para dentro do token — é de lá
 * que o guard lê, sem ir ao banco a cada requisição. E precisa carimbar o
 * último acesso sem segurar a resposta.
 */

const EMPRESA = 'empresa-1';
// bcrypt de "senha123", 10 rounds — igual ao que `hashPassword` gera.
const HASH = '$2b$10$T3Hi4WLNCUmwSMy3zwFPHegRhFCJNaMx0kAILuQ0MDdE5CJdImKha';

const GERENTE = {
  id: 'ger-1',
  company_id: EMPRESA,
  name: 'Gerente',
  email: 'gerente@csb.com',
  role: 'manager',
  active: true,
  password_hash: HASH,
  permissions: ['aprovar_pedidos'],
  last_login_at: null,
};

let app: FastifyInstance;
let fake: ReturnType<typeof criarSupabaseFake>;

beforeAll(async () => {
  fake = criarSupabaseFake({
    users: [
      { data: GERENTE, error: null }, // findUserByEmail
      { data: null, error: null },    // registrarAcesso (update)
    ],
  });
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));

  const { buildApp } = await import('../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe('login', () => {
  it('leva as teclas do gerente para dentro do token e para a resposta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'gerente@csb.com', password: 'senha123' },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { token: string; user: { permissions: string[] } } };

    expect(data.user.permissions).toEqual(['aprovar_pedidos']);

    const corpo = JSON.parse(
      Buffer.from(data.token.split('.')[1]!, 'base64url').toString(),
    ) as { permissions: string[]; role: string };
    expect(corpo.role).toBe('manager');
    expect(corpo.permissions).toEqual(['aprovar_pedidos']);
  });

  it('carimba o último acesso', async () => {
    const gravado = fake.ultimaGravacao('users', 'update');
    expect(gravado?.valores).toMatchObject({
      last_login_at: expect.any(String) as unknown as string,
    });
  });

  it('não devolve o hash da senha', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'gerente@csb.com', password: 'senha123' },
    });
    expect(JSON.stringify(res.json())).not.toContain('$2b$');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/login-e-token.test.ts`
Expected: FAIL — `data.user.permissions` é `undefined` e não há `update` gravado em `users`.

- [ ] **Step 3: Preencher as teclas e criar `registrarAcesso`**

Em `apps/api/src/modules/auth/auth.service.ts`, dentro de `buildAuthPayload`, logo depois de `rep_id: user.rep_id ?? null,`:

```ts
    // Teclas do gerente viajam no token para o guard não consultar o banco a
    // cada requisição. Nulo é significativo: quer dizer "padrão do papel".
    // O preço é o mesmo do bloqueio: mudança de tecla vale em até 1h.
    permissions: user.permissions ?? null,
```

E no fim do arquivo:

```ts
/**
 * Carimba o último acesso.
 *
 * Nunca segura o login e nunca o derruba: se a coluna ainda não existe (migração
 * 022 não aplicada) o supabase-js devolve erro em vez de lançar, e aqui isso é
 * exatamente o comportamento desejado — quem está entrando não tem nada a ver
 * com o estado do schema.
 */
export async function registrarAcesso(userId: string): Promise<void> {
  try {
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userId);
  } catch {
    /* silêncio proposital: ver comentário acima */
  }
}
```

- [ ] **Step 4: Chamar no login e devolver as teclas**

Em `apps/api/src/modules/auth/auth.controller.ts`, estender o import da linha 3:

```ts
import {
  findUserByEmail,
  buildAuthPayload,
  getTokenConfig,
  upgradePasswordHash,
  registrarAcesso,
} from './auth.service.js';
```

Em `login`, logo antes de `const payload = buildAuthPayload(user);`:

```ts
  // Sem `await`: o carimbo não pode atrasar a entrada de ninguém.
  void registrarAcesso(user.id);
```

E no objeto `user` da resposta, depois de `rep_id: user.rep_id ?? null,`:

```ts
        // O web esconde botão pelas teclas; sem elas na resposta, o gerente veria
        // botão que a API recusa.
        permissions: user.permissions ?? null,
        last_login_at: user.last_login_at ?? null,
```

- [ ] **Step 5: Fazer o refresh devolver o usuário junto**

Ainda em `auth.controller.ts`, em `refreshToken`, trocar a linha `await reply.send({ data: { token } });` por:

```ts
    // O usuário volta junto do token: quando o admin mexe nas teclas de alguém,
    // o servidor passa a negar na hora do refresh, mas a tela continuaria
    // mostrando os botões antigos até a pessoa deslogar. Campo novo — cliente
    // antigo que só lê `token` continua funcionando.
    const u = userData as User;
    await reply.send({
      data: {
        token,
        user: {
          id: u.id,
          company_id: u.company_id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          price_table_id: u.price_table_id ?? null,
          commission_rate: u.commission_rate ?? null,
          customer_id: u.customer_id ?? null,
          rep_id: u.rep_id ?? null,
          permissions: u.permissions ?? null,
          last_login_at: u.last_login_at ?? null,
        },
      },
    });
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `pnpm vitest run tests/login-e-token.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 7: Rodar a suíte inteira — o login é usado por vários testes**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, sem regressão em `autorizacao.test.ts`, `acesso-loja.test.ts` e `vitrine.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/auth tests/login-e-token.test.ts
git commit -m "feat(logins): as teclas viajam no token, e o login carimba o acesso"
```

---

### Task 3: O guard `requirePermission` e as rotas que ele protege

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/modules/orders/orders.router.ts`
- Modify: `apps/api/src/modules/reps/reps.router.ts`
- Modify: `apps/api/src/modules/catalog/catalog.router.ts`
- Test: `tests/permissoes-gerente.test.ts`

**Interfaces:**
- Consumes: `temPermissao`, `PermissaoGerente` (Task 1); `AuthPayload.permissions` (Task 2)
- Produces: `requirePermission(tecla: PermissaoGerente)` em `middleware/auth.ts` — mesma forma de `requireRole`, usável em `preHandler`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/permissoes-gerente.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * As teclas do gerente valendo nas rotas de verdade.
 *
 * O teste que importa é o do gerente LEGADO: quem já existia tem `permissions`
 * nulo e não pode perder nada no dia em que isto entrou no ar.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const PEDIDO = '00000000-0000-0000-0000-000000000000';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto
    .createHmac('sha256', SEGREDO)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'x@csb.com', company_id: EMPRESA, name: 'Teste', price_table_id: null };

const TOKEN = {
  /** Gerente de antes das teclas: coluna nula. */
  legado: assinar({ ...base, sub: 'ger-0', role: 'manager', permissions: null }),
  /** Só aprova. Não fatura, não mexe em rep, não importa. */
  soAprova: assinar({ ...base, sub: 'ger-1', role: 'manager', permissions: ['aprovar_pedidos'] }),
  /** Só fatura. */
  soFatura: assinar({ ...base, sub: 'ger-2', role: 'manager', permissions: ['faturar_pedidos'] }),
  /** Sem tecla nenhuma — o admin desligou tudo. */
  semNada: assinar({ ...base, sub: 'ger-3', role: 'manager', permissions: [] }),
  /** Gerente com a tecla que era exclusiva do admin. */
  importador: assinar({ ...base, sub: 'ger-4', role: 'manager', permissions: ['importar_produtos'] }),
  admin: assinar({ ...base, sub: 'adm-1', role: 'admin', permissions: [] }),
  rep: assinar({ ...base, sub: 'rep-1', role: 'rep', permissions: [] }),
};

let app: FastifyInstance;

beforeAll(async () => {
  const fake = criarSupabaseFake({
    users: { data: [], error: null },
    orders: { data: null, error: null },
    products: { data: [], error: null },
    price_tables: { data: [], error: null },
  });
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));

  const { buildApp } = await import('../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

const chamar = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

/** 403 é a recusa da tecla. Qualquer outra coisa significa que ele passou pelo guard. */
const passou = (status: number) => status !== 403;

describe('gerente legado (permissions nulo) mantém o que já fazia', () => {
  it('aprova pedido', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.legado, { status: 'approved' });
    expect(passou(res.statusCode)).toBe(true);
  });

  it('fatura', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/invoice`, TOKEN.legado, { invoiced: true });
    expect(passou(res.statusCode)).toBe(true);
  });

  it('mexe em representante', async () => {
    const res = await chamar('PATCH', '/reps/rep-1', TOKEN.legado, { name: 'Novo nome' });
    expect(passou(res.statusCode)).toBe(true);
  });

  it('não importa produto — isso sempre foi só do admin', async () => {
    const res = await chamar('POST', '/products/import', TOKEN.legado, { produtos: [] });
    expect(res.statusCode).toBe(403);
  });
});

describe('tecla aprovar_pedidos', () => {
  it('sem a tecla, não aprova', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.soFatura, { status: 'approved' });
    expect(res.statusCode).toBe(403);
  });

  it('sem a tecla, não exclui pedido', async () => {
    const res = await chamar('DELETE', `/orders/${PEDIDO}`, TOKEN.soFatura);
    expect(res.statusCode).toBe(403);
  });

  it('com a tecla, passa', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.soAprova, { status: 'approved' });
    expect(passou(res.statusCode)).toBe(true);
  });
});

describe('tecla faturar_pedidos', () => {
  it('sem a tecla, não fatura', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/invoice`, TOKEN.soAprova, { invoiced: true });
    expect(res.statusCode).toBe(403);
  });

  it('com a tecla, passa', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/invoice`, TOKEN.soFatura, { invoiced: true });
    expect(passou(res.statusCode)).toBe(true);
  });
});

describe('tecla gerenciar_representantes', () => {
  it.each([
    ['POST', '/reps'],
    ['PATCH', '/reps/rep-1'],
    ['DELETE', '/reps/rep-1'],
    ['PUT', '/reps/rep-1/meta'],
  ])('sem a tecla, %s %s é negado', async (metodo, url) => {
    const res = await chamar(metodo as 'POST', url, TOKEN.semNada, {});
    expect(res.statusCode).toBe(403);
  });

  it('a LISTA continua aberta ao gerente sem a tecla — a tela de comissões vive dela', async () => {
    expect((await chamar('GET', '/reps', TOKEN.semNada)).statusCode).toBe(200);
    expect((await chamar('GET', '/price-tables', TOKEN.semNada)).statusCode).toBe(200);
  });
});

describe('tecla importar_produtos', () => {
  it('gerente com a tecla passa a importar — poder novo, dado pelo admin', async () => {
    const res = await chamar('POST', '/products/import', TOKEN.importador, { produtos: [] });
    expect(passou(res.statusCode)).toBe(true);
  });
});

describe('quem não é gerente não é afetado', () => {
  it('admin com array vazio continua podendo tudo', async () => {
    for (const [metodo, url, corpo] of [
      ['PATCH', `/orders/${PEDIDO}/status`, { status: 'approved' }],
      ['PATCH', `/orders/${PEDIDO}/invoice`, { invoiced: true }],
      ['PATCH', '/reps/rep-1', { name: 'x' }],
      ['POST', '/products/import', { produtos: [] }],
    ] as const) {
      const res = await chamar(metodo, url, TOKEN.admin, corpo);
      expect(passou(res.statusCode)).toBe(true);
    }
  });

  it('a triagem do representante não é atingida pelo guard da rota que ele divide com o gerente', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.rep, { status: 'pending_approval' });
    expect(passou(res.statusCode)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/permissoes-gerente.test.ts`
Expected: FAIL — hoje nenhuma tecla existe nas rotas; os casos "sem a tecla é negado" recebem outro status em vez de 403.

- [ ] **Step 3: Criar o guard em `apps/api/src/middleware/auth.ts`**

Estender o import do topo:

```ts
import type { AuthPayload, AuthRole, PermissaoGerente } from '@csb/shared';
import { temPermissao } from '@csb/shared';
```

E no fim do arquivo:

```ts
/**
 * Exige uma tecla do gerente. Vai DEPOIS do `requireRole` da rota, nunca no
 * lugar dele: quem entra é decisão do papel, e a tecla só estreita isso para o
 * gerente.
 *
 * `temPermissao` deixa passar quem não é gerente de propósito — é o que mantém a
 * triagem do representante viva em `PATCH /orders/:id/status`, que é a mesma
 * rota que o gerente usa para aprovar.
 */
export function requirePermission(tecla: PermissaoGerente) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const usuario = request.user;
    if (!usuario || !temPermissao(usuario.role, usuario.permissions ?? null, tecla)) {
      await reply.status(403).send({
        error: 'Seu acesso não inclui esta ação. Fale com o administrador.',
        code: 'PERMISSAO_NEGADA',
        statusCode: 403,
      });
    }
  };
}
```

- [ ] **Step 4: Aplicar nas rotas de pedido**

Em `apps/api/src/modules/orders/orders.router.ts`, trocar o import da linha 2 por:

```ts
import { authenticate, requireRole, requirePermission } from '../../middleware/auth.js';
```

E as três rotas guardadas:

```ts
  // Decidir e excluir pedido andam juntos: são as duas formas de tirar um pedido
  // do caminho de alguém.
  const decideOPedido = {
    preHandler: [
      authenticate,
      requireRole(['rep', 'manager', 'admin']),
      requirePermission('aprovar_pedidos'),
    ],
  };

  fastify.get('/orders', daFabricaOuLoja, listOrders);
  fastify.get('/orders/:id', daFabricaOuLoja, getOrder);
  fastify.post('/orders', { preHandler: authenticate }, createOrderHandler);
  fastify.delete('/orders/:id', decideOPedido, deleteOrderHandler);
  fastify.patch('/orders/:id/status', decideOPedido, updateStatusHandler);
  fastify.patch(
    '/orders/:id/invoice',
    {
      preHandler: [
        authenticate,
        requireRole(['manager', 'admin']),
        requirePermission('faturar_pedidos'),
      ],
    },
    setInvoicedHandler,
  );
```

A constante `daFabrica` fica sem uso depois disso — remover a declaração e o comentário dela, para não deixar código morto.

- [ ] **Step 5: Aplicar nas rotas de representante**

Em `apps/api/src/modules/reps/reps.router.ts`, trocar o import da linha 2 por:

```ts
import { authenticate, requireRole, requirePermission } from '../../middleware/auth.js';
```

E, logo depois da constante `guard` existente:

```ts
  // Escrever no cadastro de representante (e na meta dele) exige a tecla. LER
  // não exige, e isso é deliberado: a tela de Comissões consome `GET /reps` e
  // `GET /price-tables`, e guardá-las quebraria uma tela que funciona.
  const podeGerenciar = {
    preHandler: [
      authenticate,
      requireRole(['manager', 'admin']),
      requirePermission('gerenciar_representantes'),
    ],
  };
```

Trocar os métodos de escrita para `podeGerenciar` (mantendo `GET /reps`, `GET /price-tables` e `GET /reps/:id/meta` em `guard`):

```ts
  fastify.get('/reps', guard, listRepsHandler);
  fastify.post('/reps', podeGerenciar, createRepHandler);
  fastify.patch('/reps/:id', podeGerenciar, updateRepHandler);
  fastify.delete('/reps/:id', podeGerenciar, deleteRepHandler);
  fastify.get('/price-tables', guard, listPriceTablesHandler);

  // Meta de bonificação: quem cadastra é o gerente, por representante e por mês.
  fastify.get('/reps/:id/meta', guard, listarMetasHandler);
  fastify.put('/reps/:id/meta', podeGerenciar, salvarMetaHandler);
```

- [ ] **Step 6: Abrir a importação para o gerente com a tecla**

Em `apps/api/src/modules/catalog/catalog.router.ts`, trocar o import da linha 2 por:

```ts
import { authenticate, requireRole, requirePermission } from '../../middleware/auth.js';
```

E as duas rotas de importação:

```ts
  // Importação e foto eram exclusivas do admin. Continuam assim por padrão — o
  // gerente só chega aqui se o admin ligar a tecla para ele, que é o ponto.
  const podeImportar = {
    preHandler: [
      authenticate,
      requireRole(['manager', 'admin']),
      requirePermission('importar_produtos'),
    ],
  };

  fastify.post('/products/import', podeImportar, importProductsHandler);
  fastify.post('/products/fotos', podeImportar, uploadPhotoHandler);
```

- [ ] **Step 7: Rodar o teste e ver passar**

Run: `pnpm vitest run tests/permissoes-gerente.test.ts`
Expected: PASS

- [ ] **Step 8: Rodar a suíte inteira — este passo mexeu em rotas que já funcionavam**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. Atenção especial a `autorizacao.test.ts`, `pedidos.test.ts` e `triagem.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/modules/orders/orders.router.ts apps/api/src/modules/reps/reps.router.ts apps/api/src/modules/catalog/catalog.router.ts tests/permissoes-gerente.test.ts
git commit -m "feat(logins): as teclas do gerente valendo nas rotas"
```

---

### Task 4: A API de logins — módulo `users`, só admin

Módulo novo e isolado. Não altera uma linha de `reps/` — só o *chama* para excluir representante, preservando a regra de "rep com pedido não é excluído".

**Files:**
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/users.controller.ts`
- Create: `apps/api/src/modules/users/users.router.ts`
- Modify: `apps/api/src/app.ts` (import + register)
- Test: `tests/logins-admin.test.ts`

**Interfaces:**
- Consumes: `hashPassword` de `apps/api/src/lib/password.js`; `deleteRep` de `apps/api/src/modules/reps/reps.service.js`; `UsuarioListItem`, `CriarUsuarioRequest`, `AtualizarUsuarioRequest`, `PapelGerenciavel`, `TODAS_PERMISSOES` (Task 1)
- Produces:
  - `listUsuarios(company_id: string): Promise<UsuarioListItem[]>`
  - `criarUsuario(company_id: string, body: CriarUsuarioRequest): Promise<ResultadoUsuario>`
  - `atualizarUsuario(company_id: string, quemPede: string, id: string, body: AtualizarUsuarioRequest): Promise<ResultadoUsuario>`
  - `excluirUsuario(company_id: string, quemPede: string, id: string): Promise<ResultadoExclusao>`
  - `type MotivoUsuario = 'nao_encontrado' | 'email_em_uso' | 'proprio_login' | 'ultimo_admin' | 'tem_pedidos' | 'papel_invalido' | 'erro'`
  - Rotas: `GET /usuarios`, `POST /usuarios`, `PATCH /usuarios/:id`, `DELETE /usuarios/:id`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/logins-admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O controle de logins pelo admin, com foco nas trancas.
 *
 * A pior falha possível aqui não é um 500: é o admin conseguir se bloquear, ou
 * bloquear o último admin da fábrica. Nesse estado ninguém mais entra para
 * desfazer, e não existe tela para consertar — só SQL no Supabase.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto
    .createHmac('sha256', SEGREDO)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'x@csb.com', company_id: EMPRESA, name: 'Teste', price_table_id: null };
const TOKEN = {
  admin: assinar({ ...base, sub: 'adm-1', role: 'admin' }),
  gerente: assinar({ ...base, sub: 'ger-1', role: 'manager' }),
  rep: assinar({ ...base, sub: 'rep-1', role: 'rep' }),
  loja: assinar({ ...base, sub: 'loja-1', role: 'store', customer_id: 'c-1', rep_id: 'rep-1' }),
};

const ADMIN_LOGADO = {
  id: 'adm-1',
  company_id: EMPRESA,
  name: 'Admin Sistema',
  email: 'admin@csb.com',
  role: 'admin',
  active: true,
  password_hash: '$2b$10$naoDeveVazarNunca',
  permissions: null,
  last_login_at: '2026-08-05T12:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
};

const OUTRO_ADMIN = { ...ADMIN_LOGADO, id: 'adm-2', email: 'admin2@csb.com', name: 'Segundo Admin' };
const GERENTE = {
  ...ADMIN_LOGADO,
  id: 'ger-1',
  email: 'gerente@csb.com',
  name: 'Gerente',
  role: 'manager',
  permissions: null,
};

/** Monta o app com as respostas que o teste precisa naquele caso. */
async function comBanco(respostas: Parameters<typeof criarSupabaseFake>[0]) {
  vi.resetModules();
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const instancia = await instanciar(buildApp);
  return { app: instancia, fake };
}

async function instanciar(buildApp: () => Promise<FastifyInstance>) {
  const a = await buildApp();
  await a.ready();
  abertos.push(a);
  return a;
}

const abertos: FastifyInstance[] = [];
afterAll(async () => {
  await Promise.all(abertos.map((a) => a.close()));
});

const chamar = (
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

describe('só o admin entra', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    ({ app } = await comBanco({ users: { data: [], error: null } }));
  });

  it.each([
    ['gerente', TOKEN.gerente],
    ['representante', TOKEN.rep],
    ['loja', TOKEN.loja],
  ])('%s recebe 403 em GET /usuarios', async (_papel, token) => {
    expect((await chamar(app, 'GET', '/usuarios', token)).statusCode).toBe(403);
  });

  it('sem token, 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/usuarios' })).statusCode).toBe(401);
  });

  it('gerente não cria login', async () => {
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.gerente, {
      name: 'Novo', email: 'n@csb.com', password: 'x', role: 'admin',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('listagem', () => {
  it('nunca devolve o hash da senha', async () => {
    const { app } = await comBanco({
      users: { data: [ADMIN_LOGADO, GERENTE], error: null },
    });
    const res = await chamar(app, 'GET', '/usuarios', TOKEN.admin);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('password_hash');
    expect(res.body).not.toContain('$2b$');

    const { data } = res.json() as { data: Array<{ email: string; last_login_at: string | null }> };
    expect(data).toHaveLength(2);
    expect(data[0]).toHaveProperty('last_login_at');
  });

  it('filtra pela empresa do token', async () => {
    const { app, fake } = await comBanco({ users: { data: [ADMIN_LOGADO], error: null } });
    await chamar(app, 'GET', '/usuarios', TOKEN.admin);

    const porEmpresa = fake.filtrosDe('users', 'eq').filter((f) => f.args[0] === 'company_id');
    expect(porEmpresa.length).toBeGreaterThan(0);
    expect(porEmpresa[0]!.args[1]).toBe(EMPRESA);
  });
});

describe('o admin não se tranca fora', () => {
  it('não se bloqueia', async () => {
    const { app } = await comBanco({ users: { data: ADMIN_LOGADO, error: null } });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-1', TOKEN.admin, { active: false });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PROPRIO_LOGIN');
  });

  it('não se exclui', async () => {
    const { app } = await comBanco({ users: { data: ADMIN_LOGADO, error: null } });
    const res = await chamar(app, 'DELETE', '/usuarios/adm-1', TOKEN.admin);

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PROPRIO_LOGIN');
  });

  it('não se rebaixa a gerente', async () => {
    const { app } = await comBanco({ users: { data: ADMIN_LOGADO, error: null } });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-1', TOKEN.admin, { role: 'manager' });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PROPRIO_LOGIN');
  });
});

describe('a fábrica nunca fica sem admin', () => {
  it('bloquear o último admin ativo é recusado', async () => {
    const { app } = await comBanco({
      users: [
        { data: OUTRO_ADMIN, error: null }, // o alvo
        { data: [], error: null, count: 0 }, // nenhum outro admin ativo sobraria
      ],
    });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-2', TOKEN.admin, { active: false });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('ULTIMO_ADMIN');
  });

  it('com outro admin ativo sobrando, bloquear passa', async () => {
    const { app } = await comBanco({
      users: [
        { data: OUTRO_ADMIN, error: null },
        { data: [], error: null, count: 1 },
        { data: { ...OUTRO_ADMIN, active: false }, error: null },
      ],
    });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-2', TOKEN.admin, { active: false });
    expect(res.statusCode).toBe(200);
  });
});

describe('criação', () => {
  it('cria gerente com as teclas escolhidas e grava a senha em hash', async () => {
    const { app, fake } = await comBanco({
      users: [
        { data: null, error: null }, // e-mail livre
        { data: { ...GERENTE, id: 'ger-9', permissions: ['aprovar_pedidos'] }, error: null },
      ],
    });
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
      name: 'Novo Gerente',
      email: 'NOVO@CSB.com',
      password: 'senha123',
      role: 'manager',
      permissions: ['aprovar_pedidos'],
    });

    expect(res.statusCode).toBe(201);
    const gravado = fake.ultimaGravacao('users', 'insert')?.valores as Record<string, unknown>;
    expect(gravado['email']).toBe('novo@csb.com'); // normalizado
    expect(gravado['company_id']).toBe(EMPRESA);
    expect(gravado['role']).toBe('manager');
    expect(gravado['password_hash']).toMatch(/^\$2[aby]\$/);
    expect(gravado).not.toHaveProperty('password');
  });

  it('recusa papel que não se cria por aqui', async () => {
    const { app } = await comBanco({ users: { data: null, error: null } });
    for (const role of ['rep', 'store', 'guest', 'root']) {
      const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
        name: 'X', email: `${role}@csb.com`, password: 'senha123', role,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('recusa e-mail já usado', async () => {
    const { app } = await comBanco({ users: { data: { id: 'ja-existe' }, error: null } });
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
      name: 'X', email: 'admin@csb.com', password: 'senha123', role: 'manager',
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('EMAIL_TAKEN');
  });

  it('recusa tecla inventada', async () => {
    const { app } = await comBanco({ users: { data: null, error: null } });
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
      name: 'X', email: 'x@csb.com', password: 'senha123', role: 'manager',
      permissions: ['apagar_tudo'],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('exclusão', () => {
  it('login com pedido no histórico não é apagado — oferece bloquear', async () => {
    const { app } = await comBanco({
      users: { data: GERENTE, error: null },
      orders: { data: [], error: null, count: 3 },
    });
    const res = await chamar(app, 'DELETE', '/usuarios/ger-1', TOKEN.admin);

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('HAS_ORDERS');
  });

  it('login sem pedido é apagado', async () => {
    const { app, fake } = await comBanco({
      users: { data: GERENTE, error: null },
      orders: { data: [], error: null, count: 0 },
    });
    const res = await chamar(app, 'DELETE', '/usuarios/ger-1', TOKEN.admin);

    expect(res.statusCode).toBe(200);
    expect(fake.ultimaGravacao('users', 'delete')).toBeDefined();
  });

  it('usuário de outra empresa não é encontrado', async () => {
    const { app } = await comBanco({ users: { data: null, error: null } });
    const res = await chamar(app, 'DELETE', '/usuarios/de-outra-fabrica', TOKEN.admin);
    expect(res.statusCode).toBe(404);
  });
});

describe('troca de senha', () => {
  it('grava hash, nunca texto puro, e não devolve nada disso', async () => {
    const { app, fake } = await comBanco({
      users: [
        { data: GERENTE, error: null },
        { data: GERENTE, error: null },
      ],
    });
    const res = await chamar(app, 'PATCH', '/usuarios/ger-1', TOKEN.admin, { password: 'nova-senha' });

    expect(res.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('users', 'update')?.valores as Record<string, unknown>;
    expect(gravado['password_hash']).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(gravado)).not.toContain('nova-senha');
    expect(res.body).not.toContain('password');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/logins-admin.test.ts`
Expected: FAIL — todas as chamadas a `/usuarios` respondem 404, a rota não existe.

- [ ] **Step 3: Escrever `apps/api/src/modules/users/users.service.ts`**

```ts
import { supabase } from '../../config/supabase.js';
import { hashPassword } from '../../lib/password.js';
import { deleteRep } from '../reps/reps.service.js';
import { TODAS_PERMISSOES } from '@csb/shared';
import type {
  UsuarioListItem,
  CriarUsuarioRequest,
  AtualizarUsuarioRequest,
  PermissaoGerente,
  UserRole,
} from '@csb/shared';

export type MotivoUsuario =
  | 'nao_encontrado'
  | 'email_em_uso'
  | 'proprio_login'
  | 'ultimo_admin'
  | 'tem_pedidos'
  | 'papel_invalido'
  | 'erro';

export type ResultadoUsuario =
  | { ok: true; usuario: UsuarioListItem; teclas_ignoradas?: boolean }
  | { ok: false; motivo: MotivoUsuario; pedidos?: number };

export type ResultadoExclusao =
  | { ok: true; clientes_sem_representante: number }
  | { ok: false; motivo: MotivoUsuario; pedidos?: number };

/** Ordem da tela: quem tem mais poder primeiro. */
const ORDEM_PAPEL: Record<UserRole, number> = { admin: 0, manager: 1, rep: 2, store: 3 };

/**
 * `permissions` e `last_login_at` vêm da 022, que pode não estar aplicada.
 * Nomear coluna inexistente faz o PostgREST recusar a query INTEIRA — a tela
 * ficaria vazia até alguém rodar o SQL. Por isso a LEITURA usa `select('*')`,
 * que traz o que existir, e só a ESCRITA precisa saber. Mesmo padrão do
 * `detectarErpRepId` em reps.service.
 */
let temColunasDeControle: boolean | null = null;

async function detectarColunasDeControle(): Promise<boolean> {
  if (temColunasDeControle !== null) return temColunasDeControle;
  const { error } = await supabase.from('users').select('permissions, last_login_at').limit(1);
  temColunasDeControle = !error;
  return temColunasDeControle;
}

interface LinhaUsuario {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  permissions?: string[] | null;
  last_login_at?: string | null;
}

/**
 * Linha do banco → item da tela, campo a campo.
 *
 * Explícito de propósito: `select('*')` na tabela `users` traz `password_hash`
 * junto, e espalhar a linha com spread seria o suficiente para publicar o hash
 * de todo mundo numa resposta HTTP.
 */
function paraItem(linha: LinhaUsuario): UsuarioListItem {
  return {
    id: linha.id,
    name: linha.name,
    email: linha.email,
    role: linha.role,
    active: linha.active,
    created_at: linha.created_at,
    last_login_at: linha.last_login_at ?? null,
    permissions: (linha.permissions as PermissaoGerente[] | null | undefined) ?? null,
  };
}

/** Tecla que não existe é recusada: array com lixo vira permissão que nunca liga. */
export function teclasValidas(teclas: readonly string[]): teclas is PermissaoGerente[] {
  return teclas.every((t) => (TODAS_PERMISSOES as readonly string[]).includes(t));
}

export async function listUsuarios(company_id: string): Promise<UsuarioListItem[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('company_id', company_id)
    .order('name');

  if (error || !data) return [];
  return (data as LinhaUsuario[])
    .map(paraItem)
    .sort((a, b) => ORDEM_PAPEL[a.role] - ORDEM_PAPEL[b.role] || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Sobraria algum admin ativo na empresa sem contar este? */
async function sobraOutroAdmin(company_id: string, excetoId: string): Promise<boolean> {
  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('role', 'admin')
    .eq('active', true)
    .neq('id', excetoId);
  return (count ?? 0) > 0;
}

async function buscar(company_id: string, id: string): Promise<LinhaUsuario | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  return (data as LinhaUsuario | null) ?? null;
}

export async function criarUsuario(
  company_id: string,
  body: CriarUsuarioRequest,
): Promise<ResultadoUsuario> {
  if (body.role !== 'admin' && body.role !== 'manager') {
    return { ok: false, motivo: 'papel_invalido' };
  }
  if (body.permissions && !teclasValidas(body.permissions)) {
    return { ok: false, motivo: 'papel_invalido' };
  }

  const email = body.email.trim().toLowerCase();
  const { data: existe } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (existe) return { ok: false, motivo: 'email_em_uso' };

  // Teclas só têm sentido em gerente. Gravar num admin seria um campo que
  // ninguém lê e que confunde quem for depurar isto depois.
  const guardarTeclas = body.role === 'manager' && body.permissions !== undefined;
  const colunas = await detectarColunasDeControle();

  const { data, error } = await supabase
    .from('users')
    .insert({
      company_id,
      name: body.name.trim(),
      email,
      password_hash: await hashPassword(body.password),
      role: body.role,
      active: true,
      ...(guardarTeclas && colunas ? { permissions: body.permissions } : {}),
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[users] falha ao criar login:', error?.code, error?.message);
    return { ok: false, motivo: 'erro' };
  }

  return {
    ok: true,
    usuario: paraItem(data as LinhaUsuario),
    ...(guardarTeclas && !colunas ? { teclas_ignoradas: true } : {}),
  };
}

export async function atualizarUsuario(
  company_id: string,
  quemPede: string,
  id: string,
  body: AtualizarUsuarioRequest,
): Promise<ResultadoUsuario> {
  // O admin logado mexendo no próprio login: bloquear, excluir ou virar gerente
  // são os três caminhos para ele se trancar fora sem tela para desfazer.
  const seMutila =
    id === quemPede && (body.active === false || (body.role !== undefined && body.role !== 'admin'));
  if (seMutila) return { ok: false, motivo: 'proprio_login' };

  const alvo = await buscar(company_id, id);
  if (!alvo) return { ok: false, motivo: 'nao_encontrado' };

  if (body.role !== undefined && body.role !== 'admin' && body.role !== 'manager') {
    return { ok: false, motivo: 'papel_invalido' };
  }
  if (body.permissions != null && !teclasValidas(body.permissions)) {
    return { ok: false, motivo: 'papel_invalido' };
  }

  // Tirar o último admin ativo deixa a fábrica sem ninguém que possa criar
  // outro — só SQL no banco resolveria.
  const perdeAdmin =
    alvo.role === 'admin' &&
    (body.active === false || (body.role !== undefined && body.role !== 'admin'));
  if (perdeAdmin && !(await sobraOutroAdmin(company_id, id))) {
    return { ok: false, motivo: 'ultimo_admin' };
  }

  const update: Record<string, unknown> = {};

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    const { data: existe } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .neq('id', id)
      .maybeSingle();
    if (existe) return { ok: false, motivo: 'email_em_uso' };
    update['email'] = email;
  }
  if (body.name !== undefined) update['name'] = body.name.trim();
  if (body.active !== undefined) update['active'] = body.active;
  if (body.role !== undefined) update['role'] = body.role;
  if (body.password) update['password_hash'] = await hashPassword(body.password);

  const colunas = await detectarColunasDeControle();
  const querTeclas = body.permissions !== undefined;
  if (querTeclas && colunas) update['permissions'] = body.permissions;

  if (Object.keys(update).length === 0) {
    return { ok: true, usuario: paraItem(alvo), ...(querTeclas && !colunas ? { teclas_ignoradas: true } : {}) };
  }

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .eq('company_id', company_id)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[users] falha ao atualizar login:', error.code, error.message);
    return { ok: false, motivo: 'erro' };
  }
  if (!data) return { ok: false, motivo: 'nao_encontrado' };

  return {
    ok: true,
    usuario: paraItem(data as LinhaUsuario),
    ...(querTeclas && !colunas ? { teclas_ignoradas: true } : {}),
  };
}

export async function excluirUsuario(
  company_id: string,
  quemPede: string,
  id: string,
): Promise<ResultadoExclusao> {
  if (id === quemPede) return { ok: false, motivo: 'proprio_login' };

  const alvo = await buscar(company_id, id);
  if (!alvo) return { ok: false, motivo: 'nao_encontrado' };

  if (alvo.role === 'admin' && !(await sobraOutroAdmin(company_id, id))) {
    return { ok: false, motivo: 'ultimo_admin' };
  }

  // Representante tem regra própria — carteira que fica sem dono, pedido que
  // segura a exclusão. Chamar o que já existe em vez de reescrever aqui.
  if (alvo.role === 'rep') {
    const r = await deleteRep(company_id, id);
    if (r.ok) return { ok: true, clientes_sem_representante: r.unassigned_customers };
    if (r.reason === 'has_orders') return { ok: false, motivo: 'tem_pedidos', pedidos: r.orders ?? 0 };
    if (r.reason === 'not_found') return { ok: false, motivo: 'nao_encontrado' };
    return { ok: false, motivo: 'erro' };
  }

  // `orders.created_by` e `orders.approved_by` são NOT NULL sem ON DELETE: o
  // banco recusaria a exclusão com erro de FK. Melhor perguntar antes e devolver
  // uma frase que diz o que fazer do que traduzir violação de chave estrangeira.
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .or(`created_by.eq.${id},approved_by.eq.${id},rep_id.eq.${id}`);
  if ((count ?? 0) > 0) return { ok: false, motivo: 'tem_pedidos', pedidos: count ?? 0 };

  const { error } = await supabase.from('users').delete().eq('id', id).eq('company_id', company_id);
  if (error) {
    console.error('[users] falha ao excluir login:', error.code, error.message);
    return { ok: false, motivo: 'erro' };
  }
  return { ok: true, clientes_sem_representante: 0 };
}
```

- [ ] **Step 4: Escrever `apps/api/src/modules/users/users.controller.ts`**

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CriarUsuarioRequest, AtualizarUsuarioRequest } from '@csb/shared';
import {
  listUsuarios,
  criarUsuario,
  atualizarUsuario,
  excluirUsuario,
  type MotivoUsuario,
} from './users.service.js';

/**
 * Sem a 022 aplicada, as teclas não têm onde ser gravadas. Dizer "salvo" sem
 * avisar faria o admin sair da tela achando que limitou um gerente que continua
 * com tudo — exatamente o engano que este recurso existe para evitar.
 */
const AVISO_MIGRACAO =
  'Salvo, mas as permissões NÃO foram gravadas: a migração 022 ainda não foi aplicada no banco.';

const RESPOSTA: Record<MotivoUsuario, { status: number; code: string; error: string }> = {
  nao_encontrado: { status: 404, code: 'NOT_FOUND', error: 'Login não encontrado.' },
  email_em_uso: { status: 409, code: 'EMAIL_TAKEN', error: 'Já existe um usuário com esse e-mail.' },
  proprio_login: {
    status: 409,
    code: 'PROPRIO_LOGIN',
    error:
      'Você não pode bloquear, excluir nem rebaixar o seu próprio login — ficaria sem ninguém para desfazer. Peça a outro administrador.',
  },
  ultimo_admin: {
    status: 409,
    code: 'ULTIMO_ADMIN',
    error:
      'Este é o único administrador ativo da empresa. Promova outro antes de bloquear ou excluir este.',
  },
  tem_pedidos: { status: 409, code: 'HAS_ORDERS', error: 'Login com pedidos no histórico.' },
  papel_invalido: {
    status: 400,
    code: 'VALIDATION_ERROR',
    error: 'Papel ou permissão inválidos. Por aqui criam-se apenas administradores e gerentes.',
  },
  erro: { status: 500, code: 'ERRO', error: 'Não foi possível concluir a operação.' },
};

async function recusar(reply: FastifyReply, motivo: MotivoUsuario, detalhe?: string): Promise<void> {
  const r = RESPOSTA[motivo];
  await reply.status(r.status).send({
    error: detalhe ?? r.error,
    code: r.code,
    statusCode: r.status,
  });
}

export async function listarUsuariosHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await reply.send({ data: await listUsuarios(request.user.company_id) });
}

export async function criarUsuarioHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body as CriarUsuarioRequest;

  if (!body?.name?.trim() || !body?.email?.trim() || !body?.password || !body?.role) {
    await reply.status(400).send({
      error: 'Campos obrigatórios: nome, e-mail, senha e papel.',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }

  const r = await criarUsuario(request.user.company_id, body);
  if (!r.ok) {
    await recusar(reply, r.motivo);
    return;
  }
  await reply.status(201).send({
    data: r.usuario,
    ...(r.teclas_ignoradas ? { aviso: AVISO_MIGRACAO } : {}),
  });
}

export async function atualizarUsuarioHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };

  const r = await atualizarUsuario(company_id, sub, id, request.body as AtualizarUsuarioRequest);
  if (!r.ok) {
    await recusar(reply, r.motivo);
    return;
  }
  await reply.send({
    data: r.usuario,
    ...(r.teclas_ignoradas ? { aviso: AVISO_MIGRACAO } : {}),
  });
}

export async function excluirUsuarioHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };

  const r = await excluirUsuario(company_id, sub, id);
  if (!r.ok) {
    await recusar(
      reply,
      r.motivo,
      r.motivo === 'tem_pedidos'
        ? `Este login tem ${r.pedidos} pedido(s) no histórico e não pode ser excluído — o histórico de vendas depende dele. Bloqueie o acesso em vez de excluir.`
        : undefined,
    );
    return;
  }
  await reply.send({ data: { ok: true, clientes_sem_representante: r.clientes_sem_representante } });
}
```

- [ ] **Step 5: Escrever `apps/api/src/modules/users/users.router.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listarUsuariosHandler,
  criarUsuarioHandler,
  atualizarUsuarioHandler,
  excluirUsuarioHandler,
} from './users.controller.js';

/**
 * Controle de logins — só admin, sem exceção e sem tecla.
 *
 * Não existe permissão de gerente que abra esta porta: quem pode criar logins
 * pode criar um admin, e aí a distinção entre os papéis deixa de significar
 * alguma coisa.
 */
export async function usersRouter(fastify: FastifyInstance): Promise<void> {
  const soAdmin = { preHandler: [authenticate, requireRole(['admin'])] };

  fastify.get('/usuarios', soAdmin, listarUsuariosHandler);
  fastify.post('/usuarios', soAdmin, criarUsuarioHandler);
  fastify.patch('/usuarios/:id', soAdmin, atualizarUsuarioHandler);
  fastify.delete('/usuarios/:id', soAdmin, excluirUsuarioHandler);
}
```

- [ ] **Step 6: Registrar no `apps/api/src/app.ts`**

Junto dos outros imports de router (depois de `accessRouter`):

```ts
import { usersRouter } from './modules/users/users.router.js';
```

E junto dos outros `register` (depois de `await server.register(accessRouter);`):

```ts
  await server.register(usersRouter);
```

- [ ] **Step 7: Rodar o teste e ver passar**

Run: `pnpm vitest run tests/logins-admin.test.ts`
Expected: PASS

- [ ] **Step 8: Rodar a suíte inteira**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/users apps/api/src/app.ts tests/logins-admin.test.ts
git commit -m "feat(logins): a API de logins, com as trancas que impedem o admin de se trancar fora"
```

---

### Task 5: A ligação das teclas no web

Encanamento antes da tela: guardar as teclas na sessão, um hook para lê-las, `PrivateRoute` sabendo recusar por tecla e o menu escondendo o que a pessoa não pode abrir.

**Files:**
- Modify: `apps/web/src/store/authStore.ts` (`setToken` aceita o usuário)
- Modify: `apps/web/src/services/api.ts` (refresh guarda o usuário devolvido)
- Create: `apps/web/src/hooks/usePermissao.ts`
- Modify: `apps/web/src/router/PrivateRoute.tsx`
- Modify: `apps/web/src/components/layout/navItems.ts`
- Modify: `apps/web/src/components/layout/SideNav.tsx`
- Modify: `apps/web/src/components/layout/BottomNav.tsx`
- Modify: `apps/web/src/router/index.tsx`

**Interfaces:**
- Consumes: `temPermissao`, `PermissaoGerente` (Task 1); resposta de `/auth/refresh` com `user` (Task 2)
- Produces:
  - `usePermissao(tecla: PermissaoGerente): boolean`
  - `NavItem.permissao?: PermissaoGerente`
  - `navItemsForRole(role: UserRole | undefined, permissions?: PermissaoGerente[] | null): NavItem[]`
  - `PrivateRouteProps.permissao?: PermissaoGerente`

- [ ] **Step 1: `setToken` passa a guardar o usuário**

Em `apps/web/src/store/authStore.ts`, na interface `AuthState`:

```ts
  /** O usuário é opcional: só o refresh manda um, e quando manda ele é mais novo. */
  setToken: (token: string, user?: Omit<User, 'created_at'>) => void;
```

E a implementação:

```ts
      setToken: (token, user) => set((estado) => ({ token, user: user ?? estado.user })),
```

- [ ] **Step 2: O refresh guarda o usuário devolvido**

Em `apps/web/src/services/api.ts`, acrescentar o import de tipo no topo:

```ts
import type { User } from '@csb/shared';
```

E, dentro de `refreshAccessToken`, trocar as duas linhas do corpo da resposta por:

```ts
    // O refresh devolve o usuário junto: é assim que uma tecla mexida pelo admin
    // chega na tela sem obrigar a pessoa a deslogar. Opcional porque o app
    // instalado no celular pode estar numa versão anterior a este campo.
    const body = (await res.json()) as {
      data: { token: string; user?: Omit<User, 'created_at'> };
    };
    setToken(body.data.token, body.data.user);
    return body.data.token;
```

- [ ] **Step 3: Criar `apps/web/src/hooks/usePermissao.ts`**

```ts
import { useAuthStore } from '../store/authStore.js';
import { temPermissao, type PermissaoGerente } from '@csb/shared';

/**
 * Esta pessoa pode isto?
 *
 * Serve para ESCONDER botão, não para proteger: quem protege é a API. Um botão
 * que aparece e responde "acesso negado" no toque é pior do que botão nenhum.
 */
export function usePermissao(tecla: PermissaoGerente): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  return temPermissao(user.role, user.permissions ?? null, tecla);
}
```

- [ ] **Step 4: `PrivateRoute` recusa por tecla**

Substituir `apps/web/src/router/PrivateRoute.tsx` por:

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { temPermissao } from '@csb/shared';
import type { AuthRole, PermissaoGerente } from '@csb/shared';

interface PrivateRouteProps {
  roles?: AuthRole[];
  /** Tecla do gerente exigida pela tela. Admin passa sempre. */
  permissao?: PermissaoGerente;
}

export function PrivateRoute({ roles, permissao }: PrivateRouteProps) {
  const { isAuthenticated, hasRole, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !hasRole(...roles)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // O menu já esconde a tela; isto é para quem chega pelo endereço direto ou
  // por um link salvo de quando ainda tinha a tecla.
  if (permissao && user && !temPermissao(user.role, user.permissions ?? null, permissao)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
```

- [ ] **Step 5: Menu filtrado pelas teclas**

Em `apps/web/src/components/layout/navItems.ts`:

Trocar a linha 1 e o import de tipos por:

```ts
import { ShoppingBag, ClipboardList, Users, LayoutDashboard, Contact, Wallet, Gauge, UploadCloud, KeyRound, Store, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { temPermissao } from '@csb/shared';
import type { UserRole, PermissaoGerente } from '@csb/shared';
```

Acrescentar o campo na interface `NavItem`, depois de `fila?`:

```ts
  /** Tecla do gerente que abre esta tela. Sem isto, todo gerente vê o item. */
  permissao?: PermissaoGerente;
```

Substituir `managerItems`, `adminItems` e `navItemsForRole` por:

```ts
const managerItems: NavItem[] = [
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard, fila: 'aprovacao' },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/representantes', label: 'Representantes', short: 'Reps', icon: Contact, permissao: 'gerenciar_representantes' },
  { to: '/comissoes', label: 'Comissões', icon: Wallet, permissao: 'ver_comissoes' },
  { to: '/acessos', label: 'Acessos', icon: KeyRound },
  // Importar era exclusiva do admin — que continua vendo sempre, porque tecla
  // não se aplica a ele. O gerente só vê se o admin ligar.
  { to: '/importar', label: 'Importar produtos', short: 'Importar', icon: UploadCloud, permissao: 'importar_produtos' },
];

// Controle de logins não tem tecla: é do admin e ponto.
const adminItems: NavItem[] = [
  ...managerItems,
  { to: '/logins', label: 'Logins', icon: ShieldCheck },
];

export function navItemsForRole(
  role: UserRole | undefined,
  permissions?: PermissaoGerente[] | null,
): NavItem[] {
  const itens = role === 'admin' ? adminItems : role === 'manager' ? managerItems : null;
  if (itens) {
    return itens.filter((i) => !i.permissao || temPermissao(role!, permissions ?? null, i.permissao));
  }
  if (role === 'store') return storeItems;
  return repItems;
}
```

- [ ] **Step 6: Os dois menus passam as teclas**

Em `apps/web/src/components/layout/SideNav.tsx`, linha 15:

```ts
  const items = navItemsForRole(user?.role, user?.permissions ?? null);
```

Em `apps/web/src/components/layout/BottomNav.tsx`, a linha equivalente:

```ts
  const items = navItemsForRole(user?.role, user?.permissions ?? null);
```

- [ ] **Step 7: As rotas exigem as teclas**

Em `apps/web/src/router/index.tsx`, trocar os três blocos de rota e acrescentar o quarto:

```tsx
          {
            path: 'representantes',
            element: <PrivateRoute roles={['manager', 'admin']} permissao="gerenciar_representantes" />,
            children: [{ index: true, element: <AoCarregar><PaginaRepresentantes /></AoCarregar> }],
          },
          {
            path: 'comissoes',
            element: <PrivateRoute roles={['manager', 'admin']} permissao="ver_comissoes" />,
            children: [{ index: true, element: <AoCarregar><PaginaComissoes /></AoCarregar> }],
          },
          // Era `roles={['admin']}`: o admin continua entrando sempre (tecla não
          // se aplica a ele) e o gerente só entra se o admin ligar a dele.
          {
            path: 'importar',
            element: <PrivateRoute roles={['manager', 'admin']} permissao="importar_produtos" />,
            children: [{ index: true, element: <AoCarregar><PaginaImportar /></AoCarregar> }],
          },
          {
            path: 'logins',
            element: <PrivateRoute roles={['admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaLogins /></AoCarregar> }],
          },
```

E o import preguiçoso, junto dos outros:

```tsx
const PaginaLogins = lazy(() => import('../modules/logins/PaginaLogins.js').then((m) => ({ default: m.PaginaLogins })));
```

(A tela em si é a Task 6 — este passo só compila depois dela; deixar os dois na mesma verificação.)

- [ ] **Step 8: Commit (junto da Task 6, que é o que faz compilar)**

Sem commit aqui: `PaginaLogins` ainda não existe. Seguir direto para a Task 6.

---

### Task 6: A tela `/logins`

**Files:**
- Create: `apps/web/src/modules/logins/PaginaLogins.tsx`
- Create: `apps/web/src/modules/logins/CartaoDeLogin.tsx`
- Create: `apps/web/src/modules/logins/FormularioDeLogin.tsx`
- Create: `apps/web/src/lib/ultimoAcesso.ts`
- Test: `tests/ultimo-acesso.test.ts`

Três arquivos em vez de um: a página de 550 linhas de `PaginaRepresentantes.tsx` é o exemplo de onde isso chega quando cartão e formulário moram junto da lista.

**Interfaces:**
- Consumes: `UsuarioListItem`, `CriarUsuarioRequest`, `AtualizarUsuarioRequest`, `PERMISSAO_LABELS`, `TODAS_PERMISSOES`, `PERMISSOES_PADRAO_GERENTE`, `USER_ROLE_LABELS` (Task 1); rotas `/usuarios` (Task 4); componentes existentes `Input`, `Button`, `Badge`, `Skeleton`, `Spinner`, `Toast` de `apps/web/src/components/interface/`
- Produces:
  - `descreverUltimoAcesso(iso: string | null): string` em `apps/web/src/lib/ultimoAcesso.ts`
  - `PaginaLogins`, `CartaoDeLogin`, `FormularioDeLogin`

- [ ] **Step 1: Escrever o teste do texto de último acesso**

Criar `tests/ultimo-acesso.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { descreverUltimoAcesso } from '../apps/web/src/lib/ultimoAcesso.js';

const AGORA = new Date('2026-08-06T15:00:00.000Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});
afterAll(() => {
  vi.useRealTimers();
});

const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

describe('descreverUltimoAcesso', () => {
  it('quem nunca entrou é dito com todas as letras', () => {
    expect(descreverUltimoAcesso(null)).toBe('nunca entrou');
  });

  it('há poucos minutos vira "agora há pouco"', () => {
    expect(descreverUltimoAcesso(new Date(AGORA.getTime() - 5 * 60_000).toISOString())).toBe(
      'agora há pouco',
    );
  });

  it('conta horas no mesmo dia', () => {
    expect(descreverUltimoAcesso(horasAtras(3))).toBe('há 3 horas');
    expect(descreverUltimoAcesso(horasAtras(1))).toBe('há 1 hora');
  });

  it('conta dias', () => {
    expect(descreverUltimoAcesso(horasAtras(24))).toBe('ontem');
    expect(descreverUltimoAcesso(horasAtras(24 * 3))).toBe('há 3 dias');
  });

  it('acima de um mês vira data, que é mais útil que "há 47 dias"', () => {
    expect(descreverUltimoAcesso('2026-05-02T10:00:00.000Z')).toBe('em 02/05/2026');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/ultimo-acesso.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Criar `apps/web/src/lib/ultimoAcesso.ts`**

```ts
/**
 * "Último acesso" em linguagem de gente.
 *
 * A pergunta que essa linha responde é "este login ainda serve?". Para isso,
 * "há 3 dias" vale mais que um carimbo com hora e minuto — e passado um mês a
 * data volta a ser mais útil, porque "há 47 dias" ninguém consegue situar.
 */
export function descreverUltimoAcesso(iso: string | null): string {
  if (!iso) return 'nunca entrou';

  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return 'nunca entrou';

  const minutos = Math.floor((Date.now() - quando.getTime()) / 60_000);
  if (minutos < 60) return 'agora há pouco';

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${horas} horas`;

  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;

  return `em ${quando.toLocaleDateString('pt-BR')}`;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm vitest run tests/ultimo-acesso.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Criar `apps/web/src/modules/logins/CartaoDeLogin.tsx`**

```tsx
import { Mail, Pencil, Trash2, Lock, LockOpen, ArrowRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/interface/Badge.js';
import { descreverUltimoAcesso } from '../../lib/ultimoAcesso.js';
import { PERMISSAO_LABELS, TODAS_PERMISSOES, temPermissao } from '@csb/shared';
import type { UsuarioListItem } from '@csb/shared';

interface Props {
  usuario: UsuarioListItem;
  /** O login de quem está mexendo — não ganha botão de bloquear nem de excluir. */
  ehVoce: boolean;
  ocupado: boolean;
  onEditar: () => void;
  onAlternarAtivo: () => void;
  onExcluir: () => void;
}

export function CartaoDeLogin({ usuario, ehVoce, ocupado, onEditar, onAlternarAtivo, onExcluir }: Props) {
  const ehGerente = usuario.role === 'manager';

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-soft-foreground">
            {usuario.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {usuario.name}
              {ehVoce && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              {usuario.email}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!usuario.active && <Badge variant="gray">Bloqueado</Badge>}
          <button
            type="button"
            onClick={onEditar}
            aria-label={`Editar ${usuario.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!ehVoce && (
            <>
              <button
                type="button"
                onClick={onAlternarAtivo}
                disabled={ocupado}
                aria-label={usuario.active ? `Bloquear ${usuario.name}` : `Desbloquear ${usuario.name}`}
                title={usuario.active ? 'Bloquear acesso' : 'Desbloquear acesso'}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                {usuario.active ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onExcluir}
                disabled={ocupado}
                aria-label={`Excluir ${usuario.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        Último acesso: {descreverUltimoAcesso(usuario.last_login_at)}
      </p>

      {/* As teclas ficam à vista no cartão: saber o que um gerente pode fazer não
          deveria exigir abrir o formulário dele. */}
      {ehGerente && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {TODAS_PERMISSOES.filter((t) => temPermissao('manager', usuario.permissions, t)).map((t) => (
            <Badge key={t} variant="green">
              {PERMISSAO_LABELS[t].titulo}
            </Badge>
          ))}
          {TODAS_PERMISSOES.every((t) => !temPermissao('manager', usuario.permissions, t)) && (
            <span className="text-xs italic text-muted-foreground">Sem permissões — só consulta.</span>
          )}
        </div>
      )}

      {usuario.role === 'rep' && (
        <Link
          to="/representantes"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Cadastro completo (tabela, comissão, meta)
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Criar `apps/web/src/modules/logins/FormularioDeLogin.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import {
  PERMISSAO_LABELS,
  TODAS_PERMISSOES,
  PERMISSOES_PADRAO_GERENTE,
  USER_ROLE_LABELS,
  temPermissao,
} from '@csb/shared';
import type { UsuarioListItem, PapelGerenciavel, PermissaoGerente } from '@csb/shared';
import { cn } from '../../lib/utils.js';

export interface DadosDoFormulario {
  name: string;
  email: string;
  password: string;
  role: PapelGerenciavel;
  permissions: PermissaoGerente[];
}

interface Props {
  /** Nulo = criando um login novo. */
  editando: UsuarioListItem | null;
  salvando: boolean;
  erro: string;
  onSalvar: (dados: DadosDoFormulario) => void;
  onCancelar: () => void;
}

export function FormularioDeLogin({ editando, salvando, erro, onSalvar, onCancelar }: Props) {
  // Papel que não se cria por aqui (rep, loja) fica travado: o formulário edita
  // nome, e-mail e senha desses logins, mas não os transforma em gerente.
  const papelFixo = editando !== null && editando.role !== 'admin' && editando.role !== 'manager';

  const [form, setForm] = useState<DadosDoFormulario>({
    name: editando?.name ?? '',
    email: editando?.email ?? '',
    password: '',
    role: (editando?.role === 'admin' ? 'admin' : 'manager') as PapelGerenciavel,
    permissions: editando
      ? TODAS_PERMISSOES.filter((t) => temPermissao('manager', editando.permissions, t))
      : [...PERMISSOES_PADRAO_GERENTE],
  });

  const set = (k: 'name' | 'email' | 'password') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const alternarTecla = (t: PermissaoGerente) =>
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(t)
        ? f.permissions.filter((x) => x !== t)
        : [...f.permissions, t],
    }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onSalvar(form);
  };

  return (
    <form onSubmit={enviar} className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        {editando ? `Editar ${USER_ROLE_LABELS[editando.role].toLowerCase()}: ${editando.name}` : 'Novo login'}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Nome" obrigatorio>
          <Input value={form.name} onChange={set('name')} placeholder="Nome de quem vai usar" />
        </Campo>
        <Campo label="E-mail" obrigatorio>
          <Input type="email" value={form.email} onChange={set('email')} placeholder="pessoa@empresa.com" autoComplete="off" />
        </Campo>

        {!papelFixo && (
          <Campo label="Papel" obrigatorio>
            <div className="flex gap-2">
              {(['manager', 'admin'] as const).map((papel) => (
                <button
                  key={papel}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role: papel }))}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    form.role === papel
                      ? 'border-foreground bg-primary-soft text-primary-soft-foreground'
                      : 'border-input text-muted-foreground hover:bg-muted',
                  )}
                >
                  {USER_ROLE_LABELS[papel]}
                </button>
              ))}
            </div>
          </Campo>
        )}

        <Campo label={editando ? 'Nova senha' : 'Senha inicial'} obrigatorio={!editando}>
          <Input
            type="password"
            value={form.password}
            onChange={set('password')}
            placeholder={editando ? 'Deixe em branco para manter' : 'Defina a senha de acesso'}
            autoComplete="new-password"
          />
        </Campo>
      </div>

      {/* Teclas só aparecem para gerente: o admin tem tudo por definição, e
          mostrar caixinhas marcadas e travadas só faria alguém tentar desmarcar. */}
      {form.role === 'manager' && !papelFixo && (
        <div className="mt-4 space-y-1.5">
          <label className="text-sm font-medium text-foreground">O que este gerente pode fazer</label>
          <p className="text-xs text-muted-foreground">
            Desmarcado, o botão some da tela dele e a API recusa a ação. Mudanças valem em até 1 hora.
          </p>
          <div className="mt-1 divide-y divide-border overflow-hidden rounded-lg border border-input">
            {TODAS_PERMISSOES.map((t) => {
              const marcada = form.permissions.includes(t);
              return (
                <div
                  key={t}
                  className={cn('flex items-start gap-3 px-3 py-2.5 transition-colors', marcada ? 'bg-muted/50' : 'bg-card')}
                >
                  <input
                    type="checkbox"
                    id={`tecla-${t}`}
                    checked={marcada}
                    onChange={() => alternarTecla(t)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
                  />
                  <label htmlFor={`tecla-${t}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block text-sm text-foreground">{PERMISSAO_LABELS[t].titulo}</span>
                    <span className="block text-xs text-muted-foreground">{PERMISSAO_LABELS[t].descricao}</span>
                  </label>
                </div>
              );
            })}
          </div>
          {form.permissions.length === 0 && (
            <p className="text-xs text-warn-soft-foreground">
              Sem nenhuma permissão, este gerente entra e só consulta.
            </p>
          )}
        </div>
      )}

      {erro && <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando}>
          {salvando ? (
            <>
              <Spinner />
              Salvando…
            </>
          ) : editando ? (
            'Salvar alterações'
          ) : (
            'Criar login'
          )}
        </Button>
      </div>
    </form>
  );
}

function Campo({ label, obrigatorio, children }: { label: string; obrigatorio?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {obrigatorio && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
```

- [ ] **Step 7: Criar `apps/web/src/modules/logins/PaginaLogins.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { UserPlus, X, Search, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import { CartaoDeLogin } from './CartaoDeLogin.js';
import { FormularioDeLogin, type DadosDoFormulario } from './FormularioDeLogin.js';
import { USER_ROLE_LABELS } from '@csb/shared';
import type {
  UsuarioListItem,
  CriarUsuarioRequest,
  AtualizarUsuarioRequest,
  ApiResponse,
  UserRole,
} from '@csb/shared';

/** Grupos na ordem em que a fábrica pensa: quem manda primeiro. */
const GRUPOS: Array<{ papel: UserRole; titulo: string }> = [
  { papel: 'admin', titulo: 'Administradores' },
  { papel: 'manager', titulo: 'Gerentes' },
  { papel: 'rep', titulo: 'Representantes' },
  { papel: 'store', titulo: 'Lojas' },
];

type Resposta = ApiResponse<UsuarioListItem> & { aviso?: string };

export function PaginaLogins() {
  const { token, user } = useAuthStore();
  const [usuarios, setUsuarios] = useState<UsuarioListItem[] | null>(null);
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState<{ aberto: boolean; editando: UsuarioListItem | null }>({
    aberto: false,
    editando: null,
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const avisar = (message: string, erro = false) =>
    setToast({ message, type: erro ? 'error' : 'success' });

  useEffect(() => {
    if (!token) return;
    void api
      .get<ApiResponse<UsuarioListItem[]>>('/usuarios', token)
      .then((r) => setUsuarios(r.data))
      .catch(() => setUsuarios([]));
  }, [token]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = usuarios ?? [];
    if (!q) return lista;
    return lista.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [usuarios, busca]);

  const trocar = (novo: UsuarioListItem) =>
    setUsuarios((prev) => (prev ?? []).map((u) => (u.id === novo.id ? novo : u)));

  const fechar = () => {
    setForm({ aberto: false, editando: null });
    setErro('');
  };

  const salvar = async (dados: DadosDoFormulario) => {
    if (!token) return;
    setErro('');

    if (!dados.name.trim() || !dados.email.trim()) {
      setErro('Preencha nome e e-mail.');
      return;
    }
    if (!form.editando && !dados.password) {
      setErro('Defina uma senha inicial.');
      return;
    }

    setSalvando(true);
    try {
      if (form.editando) {
        const corpo: AtualizarUsuarioRequest = {
          name: dados.name,
          email: dados.email,
          ...(dados.password ? { password: dados.password } : {}),
          // Papel e teclas só viajam quando o login é de admin/gerente — para um
          // rep, este formulário mexe em nome, e-mail e senha e mais nada.
          ...(form.editando.role === 'admin' || form.editando.role === 'manager'
            ? { role: dados.role, permissions: dados.role === 'manager' ? dados.permissions : null }
            : {}),
        };
        const res = await api.patch<Resposta>(`/usuarios/${form.editando.id}`, corpo, token);
        trocar(res.data);
        avisar(res.aviso ?? 'Login atualizado.', Boolean(res.aviso));
      } else {
        const corpo: CriarUsuarioRequest = {
          name: dados.name,
          email: dados.email,
          password: dados.password,
          role: dados.role,
          ...(dados.role === 'manager' ? { permissions: dados.permissions } : {}),
        };
        const res = await api.post<Resposta>('/usuarios', corpo, token);
        setUsuarios((prev) => [...(prev ?? []), res.data]);
        avisar(res.aviso ?? 'Login criado.', Boolean(res.aviso));
      }
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarAtivo = async (u: UsuarioListItem) => {
    if (!token || ocupado) return;
    if (
      u.active &&
      !window.confirm(
        `Bloquear o acesso de "${u.name}"?\n\n` +
          'Ele não consegue mais entrar. Quem estiver com o app aberto agora cai em até 1 hora. ' +
          'O histórico é preservado e você pode desbloquear quando quiser.',
      )
    ) {
      return;
    }

    setOcupado(u.id);
    try {
      const res = await api.patch<Resposta>(`/usuarios/${u.id}`, { active: !u.active }, token);
      trocar(res.data);
      avisar(u.active ? 'Acesso bloqueado.' : 'Acesso liberado.');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível alterar o acesso.', true);
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async (u: UsuarioListItem) => {
    if (!token || ocupado) return;
    if (
      !window.confirm(
        `Excluir o login de "${u.name}"?\n\nEsta ação não pode ser desfeita. Se a ideia é só tirar o acesso, use o cadeado — o histórico fica preservado.`,
      )
    ) {
      return;
    }

    setOcupado(u.id);
    try {
      await api.del<ApiResponse<{ ok: boolean }>>(`/usuarios/${u.id}`, token);
      setUsuarios((prev) => (prev ?? []).filter((x) => x.id !== u.id));
      avisar('Login excluído.');
    } catch (e) {
      // Login com pedido no histórico não pode sumir — oferece o caminho que existe.
      if ((e as Error & { code?: string }).code === 'HAS_ORDERS' && u.active) {
        if (window.confirm(`${(e as Error).message}\n\nDeseja BLOQUEAR o acesso dele agora?`)) {
          await alternarAtivo(u);
          return;
        }
      }
      avisar(e instanceof Error ? e.message : 'Não foi possível excluir.', true);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Logins</h1>
          {usuarios && <p className="text-sm text-muted-foreground">{usuarios.length} no total</p>}
        </div>
        <Button
          size="md"
          onClick={() => (form.aberto ? fechar() : setForm({ aberto: true, editando: null }))}
        >
          {form.aberto ? <X className="h-4 w-4" strokeWidth={2.5} /> : <UserPlus className="h-4 w-4" strokeWidth={2.5} />}
          {form.aberto ? 'Cancelar' : 'Novo login'}
        </Button>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Bloquear tira o acesso: a pessoa não entra mais e quem já estiver com o app aberto cai em
          até 1 hora. Representante e loja são criados nas telas próprias — aqui você controla o
          login deles.
        </p>
      </div>

      {form.aberto && (
        <FormularioDeLogin
          // Trocar de login com o formulário aberto precisa reiniciar os campos.
          key={form.editando?.id ?? 'novo'}
          editando={form.editando}
          salvando={salvando}
          erro={erro}
          onSalvar={(d) => void salvar(d)}
          onCancelar={fechar}
        />
      )}

      {usuarios === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {usuarios.length > 6 && (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                inputMode="search"
                placeholder="Buscar por nome ou e-mail…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {GRUPOS.map(({ papel, titulo }) => {
            const doGrupo = filtrados.filter((u) => u.role === papel);
            if (doGrupo.length === 0) return null;
            return (
              <section key={papel} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold text-foreground">
                  {titulo}
                  <span className="ml-1.5 font-normal text-muted-foreground">({doGrupo.length})</span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {doGrupo.map((u) => (
                    <CartaoDeLogin
                      key={u.id}
                      usuario={u}
                      ehVoce={u.id === user?.id}
                      ocupado={ocupado === u.id}
                      onEditar={() => {
                        setErro('');
                        setForm({ aberto: true, editando: u });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      onAlternarAtivo={() => void alternarAtivo(u)}
                      onExcluir={() => void excluir(u)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {filtrados.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {busca ? 'Nenhum login encontrado.' : `Nenhum login além do seu (${USER_ROLE_LABELS.admin}).`}
            </p>
          )}
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 8: Verificar tipos e build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS — a rota da Task 5 agora resolve `PaginaLogins`.

Se `Badge` não aceitar `variant="green"`/`"gray"`, conferir as variantes reais em `apps/web/src/components/interface/Badge.tsx` e usar as que existem (a tela de representantes já usa as duas, então devem existir).

- [ ] **Step 9: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/modules/logins apps/web/src/lib/ultimoAcesso.ts apps/web/src/hooks/usePermissao.ts apps/web/src/router apps/web/src/store/authStore.ts apps/web/src/services/api.ts apps/web/src/components/layout tests/ultimo-acesso.test.ts
git commit -m "feat(logins): a tela onde o admin controla todos os logins"
```

---

### Task 7: Os botões somem quando a tecla está desligada

Último passo do recurso. Sem ele, um gerente sem `aprovar_pedidos` vê o botão "Aprovar", toca, e recebe "acesso negado" — pior do que não ver botão nenhum.

**Files:**
- Modify: `apps/web/src/lib/pedido.ts` (`decisaoDoPedido` ganha um terceiro parâmetro)
- Modify: `apps/web/src/modules/pedidos/PaginaDetalhePedido.tsx`
- Modify: `apps/web/src/modules/minha-area/PaginaMinhaArea.tsx` (se chamar `decisaoDoPedido`)
- Test: `tests/decisao-do-pedido.test.ts`

**Interfaces:**
- Consumes: `usePermissao` (Task 5); `temPermissao` (Task 1)
- Produces: `decisaoDoPedido(papel, status, podeAprovar = true)` — terceiro parâmetro opcional, todos os chamadores atuais seguem válidos

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/decisao-do-pedido.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decisaoDoPedido } from '../apps/web/src/lib/pedido.js';

describe('decisaoDoPedido com a tecla de aprovar', () => {
  it('gerente que pode aprovar vê a decisão — o comportamento de sempre', () => {
    expect(decisaoDoPedido('manager', 'pending_approval')).not.toBeNull();
    expect(decisaoDoPedido('manager', 'pending_approval', true)).not.toBeNull();
  });

  it('gerente sem a tecla não vê botão de aprovar', () => {
    expect(decisaoDoPedido('manager', 'pending_approval', false)).toBeNull();
  });

  it('gerente sem a tecla também não empurra pedido da triagem', () => {
    expect(decisaoDoPedido('manager', 'pending_rep', false)).toBeNull();
  });

  it('o representante nunca é atingido: a tecla não fala sobre ele', () => {
    expect(decisaoDoPedido('rep', 'pending_rep')).not.toBeNull();
    expect(decisaoDoPedido('rep', 'pending_rep', true)).not.toBeNull();
  });

  it('a loja continua sem decidir nada', () => {
    expect(decisaoDoPedido('store', 'pending_approval')).toBeNull();
    expect(decisaoDoPedido('store', 'pending_rep')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/decisao-do-pedido.test.ts`
Expected: FAIL — o terceiro argumento é ignorado, então "gerente sem a tecla" recebe a decisão em vez de `null`.

- [ ] **Step 3: Acrescentar o parâmetro em `apps/web/src/lib/pedido.ts`**

Trocar a assinatura e as duas condições:

```ts
/**
 * `podeAprovar` vem da tecla `aprovar_pedidos` do gerente. Padrão `true` para os
 * chamadores que não têm o que perguntar — rep e loja não têm teclas, e quem
 * decide se eles decidem continua sendo o papel.
 */
export function decisaoDoPedido(
  papel: AuthRole | undefined,
  status: OrderStatus,
  podeAprovar = true,
): Decisao | null {
  const daFabrica = papel === 'manager' || papel === 'admin';

  if (status === 'pending_rep' && (papel === 'rep' || daFabrica) && podeAprovar) {
```

e

```ts
  if (status === 'pending_approval' && daFabrica && podeAprovar) {
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm vitest run tests/decisao-do-pedido.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Ligar as teclas na tela de detalhe do pedido**

Em `apps/web/src/modules/pedidos/PaginaDetalhePedido.tsx`, acrescentar o import:

```tsx
import { usePermissao } from '../../hooks/usePermissao.js';
```

Trocar a linha 24 e acrescentar a tecla de aprovar logo abaixo:

```tsx
  const podeFaturar = usePermissao('faturar_pedidos');
  const podeAprovar = usePermissao('aprovar_pedidos');
  const canInvoice = (user?.role === 'manager' || user?.role === 'admin') && podeFaturar;
```

E na linha do `decisao`:

```tsx
  const decisao = order ? decisaoDoPedido(user?.role, order.status, podeAprovar) : null;
```

E na condição do botão de excluir (hoje `!order.invoiced && !ehLoja`):

```tsx
          {!order.invoiced && !ehLoja && podeAprovar && (
```

- [ ] **Step 6: Ligar a tecla nos outros dois chamadores**

São exatamente dois, e nos dois a chamada está dentro de um `.map()` — o hook vai no corpo do componente, nunca dentro do `map`, senão a regra dos hooks quebra:

`apps/web/src/modules/minha-area/PaginaMinhaArea.tsx` — acrescentar o import:

```tsx
import { usePermissao } from '../../hooks/usePermissao.js';
```

No corpo do componente, junto das outras constantes do topo:

```tsx
  const podeAprovar = usePermissao('aprovar_pedidos');
```

E na linha 164, dentro do `map`:

```tsx
              const decisao = decisaoDoPedido(user?.role, order.status, podeAprovar);
```

`apps/web/src/modules/painel/PaginaPainel.tsx` — o mesmo import, a mesma constante no corpo do componente, e na linha 135:

```tsx
              const decisao = decisaoDoPedido(user?.role, order.status, podeAprovar);
```

Confirmar que não sobrou nenhum: `grep -rn "decisaoDoPedido(" apps/web/src` deve mostrar só a definição em `lib/pedido.ts` e três chamadas, todas com o terceiro argumento.

- [ ] **Step 7: Verificar tudo**

Run: `pnpm verify`
Expected: PASS nos três — typecheck, lint e a suíte inteira.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/pedido.ts apps/web/src/modules/pedidos apps/web/src/modules/minha-area tests/decisao-do-pedido.test.ts
git commit -m "feat(logins): o botao some quando a tecla esta desligada"
```

---

### Task 8: Fechamento — provar que nada quebrou e deixar a migração escrita

**Files:**
- Modify: `docs/NOVA-FABRICA.md` (a 022 entra na lista de migrações)
- Test: a suíte inteira

- [ ] **Step 1: Rodar tudo, do zero**

Run: `pnpm verify`
Expected: typecheck limpo, lint limpo, **todos** os testes passando — os novos e os 20 arquivos que já existiam.

Se algo falhar, corrigir antes de seguir. Uma suíte vermelha aqui significa que uma tela que funcionava parou.

- [ ] **Step 2: Conferir que o build de produção fecha**

Run: `pnpm build`
Expected: API e web compilando, sem erro de import faltando na tela nova.

- [ ] **Step 3: Registrar a migração na documentação de nova fábrica**

Em `docs/NOVA-FABRICA.md`, onde as migrações são listadas, acrescentar a 022 na sequência, com uma linha dizendo o que ela faz: `022_controle_de_logins.sql` — permissões do gerente e último acesso. Seguir o formato exato das linhas vizinhas.

- [ ] **Step 4: Commit**

```bash
git add docs/NOVA-FABRICA.md
git commit -m "docs(logins): a migracao 022 na lista da nova fabrica"
```

- [ ] **Step 5: Avisar o que falta fora do código**

Reportar ao Yan, em texto:

1. Rodar `apps/api/src/config/migrations/022_controle_de_logins.sql` no SQL Editor do Supabase. **Antes disso**, a tela `/logins` funciona (cria, bloqueia, troca senha, exclui) mas as teclas do gerente não gravam — a própria tela avisa com a frase da migração.
2. Todo gerente existente continua com os poderes de hoje até que alguém edite as teclas dele.
3. Bloqueio e mudança de tecla valem em até 1 hora para quem já está com o app aberto.
