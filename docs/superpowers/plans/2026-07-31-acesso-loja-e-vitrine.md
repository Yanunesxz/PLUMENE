# Acesso da loja e vitrine temporária — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: `superpowers:executing-plans`.
> Os passos usam caixa (`- [ ]`) para acompanhamento.

**Objetivo:** dar à loja uma conta própria (criada por convite de uso único) e ao
curioso um link de catálogo que expira, com todo pedido caindo para o
representante aprovar.

**Arquitetura:** dois caminhos que desembocam no mesmo `POST /orders`. A loja é
um `users.role = 'store'` amarrado a um `customer_id`. A vitrine não é usuário:
é uma linha em `showcase_links` que, quando aberta, gera um JWT de sessão
(`role = 'guest'`) que expira junto com o link. A autorização continua toda na
camada de aplicação, como já é hoje.

**Stack:** Fastify + Supabase (service role), React + Vite + Zustand + Dexie,
vitest com Supabase dublado (`tests/supabaseFake.ts`).

## Restrições globais

- Papéis do banco: `admin`, `manager`, `rep`, `store`. `guest` **não** é papel de
  banco — existe só dentro do JWT.
- Token de link: 32 bytes aleatórios em base64url; no banco só o **SHA-256**.
- Todo pedido de `store` e `guest` nasce `pending_approval`. Sem exceção.
- `store` e `guest` nunca recebem `available` (quantidade em estoque) nem podem
  passar `?price_table_id=`.
- Migração roda no SQL Editor pelo Yan — o código precisa tolerar a coluna
  ausente até ele rodar (padrão já usado em `reps.service.ts`).
- Textos de interface em português, tom do resto do app.

---

## Mapa de arquivos

**Contrato (`packages/shared/src/`)**
- `constants/userRole.ts` — adiciona `STORE`; cria `AuthRole = UserRole | 'guest'`
- `types/user.ts` — `AuthPayload` ganha `customer_id` e `rep_id`
- `types/order.ts` — `Order.customer_id` vira nulo; ganha `source`, `guest_name`, `guest_whatsapp`
- `types/access.ts` **(novo)** — `StoreInvite`, `ShowcaseLink`, requests

**API (`apps/api/src/`)**
- `config/migrations/014_acesso_loja.sql` **(novo)**
- `lib/tokens.ts` **(novo)** — `generateToken()`, `hashToken()`
- `modules/access/access.router.ts` **(novo)** — rotas privadas do rep + `/public/*`
- `modules/access/access.schema.ts` **(novo)** — zod
- `modules/access/invites.service.ts` **(novo)**
- `modules/access/invites.controller.ts` **(novo)**
- `modules/access/showcase.service.ts` **(novo)**
- `modules/access/showcase.controller.ts` **(novo)**
- `modules/catalog/catalog.controller.ts` — resolve tabela para `store`/`guest`
- `modules/orders/orders.controller.ts` — cria pedido de `store`/`guest`
- `modules/orders/orders.service.ts` — `customer_id` nulo + `source` + convidado
- `modules/orders/orders.schema.ts` — `guest_name`/`guest_whatsapp`
- `modules/orders/orders.router.ts` — nega status/invoice para `store`/`guest`
- `middleware/auth.ts` — `requireRole` já serve; nada a mudar
- `app.ts` — registra `accessRouter`

**Web (`apps/web/src/`)**
- `modules/publico/PaginaConvite.tsx` **(novo)**
- `modules/publico/PaginaVitrine.tsx` **(novo)**
- `modules/loja/PaginaMinhaConta.tsx` **(novo)**
- `modules/acessos/PaginaAcessos.tsx` **(novo)** — rep gera/revoga
- `components/layout/navItems.ts` — menu de `store`
- `router/index.tsx` — rotas públicas e da loja
- `store/authStore.ts` — nada a mudar (já guarda o payload)

**Testes (`tests/`)**
- `acesso-loja.test.ts` **(novo)**
- `vitrine.test.ts` **(novo)**
- `autorizacao.test.ts` — matriz ganha `store` e `guest`

---

## Fatia 1 — Banco e contrato

### Task 1: Migração 014

**Files:** Create `apps/api/src/config/migrations/014_acesso_loja.sql`

- [ ] **Passo 1:** escrever o SQL (idempotente, `IF NOT EXISTS` em tudo):
  `users.customer_id`, `users.role` aceitando `'store'`, índice único parcial
  `(company_id, customer_id)`; `orders.customer_id` nulo, `source`,
  `guest_name`, `guest_whatsapp`, CHECK de coerência; tabelas `store_invites` e
  `showcase_links` com RLS ligado e índices por token e por rep.
- [ ] **Passo 2:** commit.

### Task 2: Contrato compartilhado

**Files:** Modify `packages/shared/src/constants/userRole.ts`,
`types/user.ts`, `types/order.ts`; Create `types/access.ts`; Modify `index.ts`

**Produces:** `AuthRole`, `USER_ROLE.STORE`, `AuthPayload.customer_id`,
`AuthPayload.rep_id`, `OrderSource`, `StoreInvite`, `ShowcaseLink`,
`CreateInviteRequest`, `CreateShowcaseLinkRequest`, `SHOWCASE_DURATIONS`.

- [ ] **Passo 1:** escrever `AuthRole` e `USER_ROLE.STORE` com rótulo "Loja".
- [ ] **Passo 2:** `SHOWCASE_DURATIONS = [1, 6, 12, 24] as const`.
- [ ] **Passo 3:** `pnpm typecheck` — vai quebrar onde `UserRole` é exaustivo
      (`USER_ROLE_LABELS`, `navItemsForRole`). Corrigir cada um.
- [ ] **Passo 4:** commit.

---

## Fatia 2 — API da vitrine

### Task 3: Geração e verificação de token

**Files:** Create `apps/api/src/lib/tokens.ts`; Test `tests/vitrine.test.ts`

**Produces:** `generateToken(): string`, `hashToken(t: string): string`

- [ ] **Passo 1:** teste falhando — token tem ≥32 chars, dois tokens diferem,
      `hashToken` é estável e diferente do original.
- [ ] **Passo 2:** rodar, ver falhar.
- [ ] **Passo 3:** implementar com `crypto.randomBytes(32).toString('base64url')`
      e `crypto.createHash('sha256')`.
- [ ] **Passo 4:** rodar, ver passar.
- [ ] **Passo 5:** commit.

### Task 4: Serviço da vitrine

**Files:** Create `modules/access/showcase.service.ts`; Test `tests/vitrine.test.ts`

**Consumes:** `generateToken`, `hashToken`
**Produces:** `criarVitrine(company_id, rep_id, price_table_id, horas)`,
`abrirVitrine(token)` → `{ ok, link } | { ok:false, motivo }`,
`listarVitrines(company_id, rep_id)`, `revogarVitrine(id, company_id, rep_id)`

- [ ] **Passo 1:** testes falhando — link válido abre; expirado recusa com
      `'expirado'`; revogado recusa com `'revogado'`; token inexistente recusa
      com `'invalido'`; abrir incrementa `opened_count`.
- [ ] **Passo 2..5:** implementar, rodar, commitar.

### Task 5: Rotas da vitrine + JWT de convidado

**Files:** Create `modules/access/showcase.controller.ts`, `access.router.ts`,
`access.schema.ts`; Modify `app.ts`; Test `tests/vitrine.test.ts`

- [ ] **Passo 1:** testes falhando via `app.inject` — `POST /public/showcase/:token`
      devolve JWT cujo `exp` é o `expires_at` do link; `POST /showcase-links`
      exige rep; `hours` fora de [1,6,12,24] dá 400.
- [ ] **Passo 2..5:** implementar, rodar, commitar.

### Task 6: Catálogo e pedido para o convidado

**Files:** Modify `catalog.controller.ts`, `orders.controller.ts`,
`orders.service.ts`, `orders.schema.ts`, `orders.router.ts`;
Test `tests/vitrine.test.ts`, `tests/autorizacao.test.ts`

- [ ] **Passo 1:** testes falhando — convidado recebe catálogo sem `available`;
      convidado não lista pedidos (403); pedido sem `guest_name` dá 400; pedido
      válido grava `customer_id` nulo, `source='showcase'` e `pending_approval`.
- [ ] **Passo 2..5:** implementar, rodar, commitar.

---

## Fatia 3 — API do convite e da loja

### Task 7: Serviço de convites

**Files:** Create `modules/access/invites.service.ts`; Test `tests/acesso-loja.test.ts`

**Produces:** `criarConvite(company_id, rep_id, customer_id)`,
`abrirConvite(token)`, `usarConvite(token, email, senha)`,
`listarConvites(company_id, rep_id)`, `revogarConvite(id, company_id, rep_id)`

- [ ] **Passo 1:** testes falhando — convite só para cliente da carteira do rep;
      **uso único** (segundo uso recusa com `'usado'`); expirado recusa; conta
      criada com `role='store'` e o `customer_id` do convite; senha < 6 recusa.
- [ ] **Passo 2..5:** implementar, rodar, commitar.

### Task 8: Autorização da loja

**Files:** Modify `catalog.controller.ts`, `orders.controller.ts`,
`orders.service.ts`, `auth.service.ts`; Test `tests/acesso-loja.test.ts`,
`tests/autorizacao.test.ts`

- [ ] **Passo 1:** testes falhando — loja vê só os próprios pedidos; loja não
      acessa `/customers`, `/reps`, `/price-tables`, `/catalog/price-tables`;
      loja não aprova nem fatura; catálogo da loja usa a tabela do cliente e cai
      para a do rep quando nula; pedido da loja grava `rep_id` do dono.
- [ ] **Passo 2..5:** implementar, rodar, commitar.

---

## Fatia 4 — Telas públicas

### Task 9: `/vitrine/:token`

**Files:** Create `modules/publico/PaginaVitrine.tsx`; Modify `router/index.tsx`

- [ ] **Passo 1:** tela troca o token por JWT, guarda em memória (não no
      `authStore`, para não misturar com sessão de usuário), mostra o catálogo
      em modo leitura com aviso de validade.
- [ ] **Passo 2:** fechamento pede nome + WhatsApp antes de enviar.
- [ ] **Passo 3:** `pnpm typecheck && pnpm lint`, verificar no navegador, commit.

### Task 10: `/convite/:token`

**Files:** Create `modules/publico/PaginaConvite.tsx`; Modify `router/index.tsx`

- [ ] **Passo 1:** valida o token, mostra o nome da loja, pede e-mail + senha +
      confirmação, cria a conta e já entra.
- [ ] **Passo 2:** estados de erro — expirado, já usado, inválido — cada um com
      texto próprio dizendo o que fazer (falar com o representante).
- [ ] **Passo 3:** verificar, commit.

---

## Fatia 5 — Telas da loja e do representante

### Task 11: Menu e "Minha conta" da loja

**Files:** Modify `navItems.ts`, `router/index.tsx`;
Create `modules/loja/PaginaMinhaConta.tsx`

- [ ] **Passo 1:** `navItemsForRole('store')` → Catálogo, Pedidos, Minha conta.
- [ ] **Passo 2:** "Minha conta" mostra nome, CNPJ, WhatsApp, e-mail e tabela,
      em leitura, com aviso de que alteração é com o representante.
- [ ] **Passo 3:** verificar, commit.

### Task 12: Tela de acessos do representante

**Files:** Create `modules/acessos/PaginaAcessos.tsx`; Modify `navItems.ts`,
`router/index.tsx`

- [ ] **Passo 1:** aba "Convites" — escolher cliente da carteira, gerar, copiar
      link, ver estado (pendente/usado/expirado), revogar.
- [ ] **Passo 2:** aba "Vitrine" — escolher 1h/6h/12h/24h, gerar, copiar link,
      ver quantas vezes foi aberto e quanto falta expirar, revogar.
- [ ] **Passo 3:** verificar, commit.

### Task 13: Origem do pedido na lista do representante

**Files:** Modify `modules/pedidos/PaginaPedidos.tsx`, `PaginaDetalhePedido.tsx`

- [ ] **Passo 1:** pedido de vitrine mostra `guest_name` e o WhatsApp no lugar do
      cliente, com selo de origem.
- [ ] **Passo 2:** verificar, commit.

---

## Autorrevisão

- **Cobertura do spec:** cada linha da tabela "Rotas novas" tem task (3–8); cada
  tela tem task (9–13); banco em 1; contrato em 2; testes distribuídos.
- **Lacuna encontrada e coberta:** o spec cita `GET /invites` e
  `DELETE /invites/:id` — entram na Task 7 (serviço) e Task 12 (tela).
- **Consistência de tipos:** `AuthRole` é o tipo usado em `AuthPayload.role` e em
  `requireRole`; `UserRole` continua sendo só os papéis de banco. Toda checagem
  de papel no servidor usa `AuthRole`.
- **Sem placeholder:** nenhum passo diz "tratar erros" sem dizer qual.
