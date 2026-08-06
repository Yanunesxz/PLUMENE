# 🗂️ Estrutura do projeto — Corpo Sensual B2B

Mapa de onde fica cada parte do código. É um **monorepo pnpm** com 3 pacotes
(`apps/web`, `apps/api`, `packages/shared`) + ferramentas (`_tools`).

```
SetorxWeb/
├── apps/
│   ├── web/      → Frontend (React PWA)  → deploy Vercel
│   └── api/      → Backend (Fastify)     → deploy Railway
├── packages/
│   └── shared/   → Tipos e regras usados por web E api
├── _tools/       → Scripts utilitários (rodam local, acesso ao ERP)
├── tests/        → Testes automatizados (vitest) — cobrem web, api e shared
└── (raiz)        → Configuração do monorepo e deploy
```

---

## 📦 Raiz do monorepo

| Arquivo | Função |
|---|---|
| `package.json` | Scripts raiz (`dev:web`, `dev:api`, `seed`) e workspaces |
| `pnpm-workspace.yaml` | Define os pacotes do monorepo |
| `tsconfig.base.json` | Config TypeScript compartilhada |
| `Dockerfile` + `railway.toml` | Build/deploy da **API** no Railway |
| `.claude/launch.json` | Servidor de preview (porta 5173) |
| `vitest.config.ts` | Configuração dos testes (`pnpm test`) |
| `README.md` | Visão geral |

---

## 🔗 packages/shared — contrato comum (web ↔ api)

Tipos e regras que os dois lados importam (`@csb/shared`). **Mudou um tipo aqui? Afeta web e api.**

```
packages/shared/src/
├── index.ts              → barrel: re-exporta tudo
├── types/                → interfaces de dados (o "formato" de cada coisa)
│   ├── api.ts            → ApiResponse (envelope { data })
│   ├── user.ts           → User, AuthPayload, Login*, RepListItem, Create/UpdateRepRequest, commission_rate
│   ├── customer.ts       → Customer, CustomerWithPriceTable, PriceTable, CreateCustomerRequest
│   ├── product.ts        → Product, ProductVariant (tamanho), ProductWithPrice, CatalogProduct
│   └── order.ts          → Order, OrderItem, OrderWithItems, CreateOrderRequest, tipos de sync
├── constants/            → uniões + rótulos PT
│   ├── userRole.ts       → 'admin' | 'manager' | 'rep' + labels
│   └── orderStatus.ts    → status do pedido + labels + fluxo permitido
└── pricing/
    └── priceTier.ts      → (LEGADO/abandonado) regra de preço por total do pedido
```

---

## 🖥️ apps/api — Backend (Fastify + Supabase)

```
apps/api/src/
├── index.ts              → ENTRADA: cria o servidor, registra cors/helmet/jwt e os routers
│
├── config/
│   ├── env.ts            → lê variáveis de ambiente (validação zod)
│   ├── supabase.ts       → cliente Supabase (service role — ignora RLS)
│   └── migrations/       → SQL versionado (rodar no Supabase SQL Editor, em ordem)
│       ├── 001_base_schema.sql        → tabelas núcleo
│       ├── 002_erp_schema.sql         → colunas/tabelas do ERP (variantes, etc.)
│       ├── 003_fix_sync_columns.sql   → ajustes
│       ├── 004_reps_price_table.sql   → cpf/legal_name/phone/price_table_id em users
│       ├── 005_rep_commission.sql     → commission_rate em users
│       ├── 006_order_invoiced.sql     → invoiced/invoiced_at em orders
│       ├── 007_customer_owner.sql     → rep_id em customers (dono)
│       ├── 008_sync_unique_keys.sql   → índices únicos p/ re-sync
│       ├── 009_order_number.sql       → nº sequencial (substituída pela 012)
│       ├── 010_company_cascade.sql    → ON DELETE CASCADE nas FKs de empresa
│       ├── 011_product_colors.sql     → variações de cor por produto
│       ├── 012_rep_carteira_e_numero.sql → código ERP do rep + nº do pedido
│       ├── 013_protecoes.sql          → travas contra dado impossível + auditoria
│       ├── 014_acesso_loja.sql        → papel 'store', convites e vitrine
│       ├── 015_triagem_do_representante.sql → status 'pending_rep' + users.rep_id
│       ├── 016_backfill_dono_da_loja.sql → preenche o rep dono das lojas antigas
│       ├── 017_pedido_offline_unico.sql → trava o pedido duplicado vindo do offline
│       ├── 018_tabelas_por_representante.sql → rep_price_tables (conjunto por rep)
│       ├── 019_cores_do_catalogo.sql  → nome da cor por produto
│       ├── 020_cor_par_do_catalogo.sql → a bolinha é o PAR (blusa + calça)
│       ├── 021_meta_de_bonus_por_representante.sql → faixas de bônus por mês
│       └── 022_controle_de_logins.sql → permissions do gerente + last_login_at
│
├── middleware/
│   └── auth.ts           → authenticate (valida JWT) + requireRole(['manager','admin'])
│                           + requirePermission('faturar_pedidos') — teclas do gerente
│
├── lib/
│   └── password.ts       → hashPassword (bcrypt) + verifyPassword (aceita sha256 legado)
│
├── modules/              → FEATURES — cada uma tem o trio router → controller → service
│   ├── access/           → convite da loja, vitrine temporária e a área da loja
│   │                       (invites, showcase, loja.service = GET /minha-area)
│   ├── auth/             → login, refresh (auth.service tem findUserByEmail, buildAuthPayload)
│   ├── catalog/          → GET /products (com variantes + preço pela tabela do rep)
│   ├── customers/        → GET/POST /customers (rep vê só os dele; gerente vê todos)
│   ├── orders/           → GET/POST /orders, /orders/:id, /status, /invoice
│   ├── users/            → /usuarios — o admin controla TODOS os logins e as
│   │                       teclas do gerente (só admin entra)
│   ├── reps/             → GET/POST/PATCH /reps + GET /price-tables (gerente/admin)
│   └── sync/             → POST /sync (fila offline) + controle de sync do ERP
│
├── erp/                  → integração com o ERP (Firebird)
│   ├── adapter.ts        → abstração (troca mock ↔ real sem mexer no resto)
│   └── firebird/         → connection, queries, types, erpSyncService
│
└── jobs/
    ├── seed.ts           → popula dados de teste (pnpm seed)
    └── erpSyncScheduler.ts → agenda o sync periódico
```

**Padrão de cada módulo (siga sempre este trio):**
- `X.router.ts` → define as rotas e os guards (authenticate/requireRole)
- `X.controller.ts` → lê request, valida, chama o service, devolve a resposta
- `X.service.ts` → a lógica de negócio + acesso ao Supabase

> **Fluxo de uma requisição:** `index.ts` → router (guard) → controller → service → Supabase.

---

## 📱 apps/web — Frontend (React + Vite + Tailwind, PWA)

```
apps/web/
├── index.html, vite.config.ts (PWA), tailwind.config.ts, vercel.json
└── src/
    ├── main.tsx          → bootstrap do React
    │
    ├── router/
    │   ├── index.tsx     → todas as rotas (qual URL → qual página)
    │   └── PrivateRoute.tsx → exige login (e papel, ex.: roles=['manager','admin'])
    │
    ├── modules/          → UMA PASTA POR TELA (página). Pastas e arquivos em PT.
    │   ├── login/PaginaLogin           → login (online + offline)
    │   ├── catalogo/PaginaCatalogo     → catálogo, busca, ordenar, + (abre tamanho)
    │   ├── pedidos/
    │   │   ├── PaginaPedidos           → lista de pedidos (busca + filtro status)
    │   │   ├── PaginaNovoPedido        → montar pedido (cliente + itens por tamanho)
    │   │   └── PaginaDetalhePedido     → detalhe (itens, decidir, faturar, WhatsApp)
    │   ├── clientes/PaginaClientes     → clientes (lista + cadastrar)
    │   ├── representantes/PaginaRepresentantes → reps (CRUD, comissão) [gerente/admin]
    │   ├── comissoes/PaginaComissoes   → comissões por rep / todos [gerente/admin]
    │   ├── painel/PaginaPainel         → Painel do gerente [gerente/admin]
    │   ├── minha-area/PaginaMinhaArea  → "Minha área" do rep (triagem, faturado, sync)
    │   ├── loja/PaginaMinhaAreaLoja    → "Minha área" da loja (histórico, repetir) [store]
    │   ├── acessos/PaginaAcessos       → gerar convite e vitrine [rep/gerente/admin]
    │   ├── publico/                    → PaginaConvite e PaginaVitrine (sem login)
    │   └── sistema/                    → PaginaNaoEncontrada, PaginaSemAcesso
    │
    ├── components/        → REUTILIZÁVEIS (não são telas)
    │   ├── interface/     → design system (botões/inputs): Button, Input, Select, SearchSelect,
    │   │                    Badge, Card, Toast, Spinner, Skeleton, Textarea, EmptyState,
    │   │                    BotaoTema (claro/escuro/automático)
    │   ├── layout/        → AppLayout (casca), SideNav, BottomNav, navItems (menu por papel)
    │   └── comercial/     → CartaoProduto, SeletorTamanho, CartaoDecisao (aprovar/recusar),
    │                        grade.ts (ordem dos tamanhos)
    │
    ├── store/            → estado global (Zustand)
    │   ├── authStore.ts  → usuário logado + token (persistido)
    │   └── cartStore.ts  → pedido em montagem (linhas por produto+tamanho)
    │
    ├── offline/          → funcionamento sem internet (PWA)
    │   ├── db.ts         → Dexie/IndexedDB (cache de produtos, clientes, pedidos, fila)
    │   ├── sync.ts       → fila de pedidos offline + flush ao reconectar
    │   └── authCache.ts  → login offline (hash da senha guardado local)
    │
    ├── services/api.ts   → cliente HTTP (fetch + Bearer token) — fala com a API
    ├── hooks/            → useOnlineStatus, useSyncOnReconnect, useDecidirPedido
    ├── lib/
    │   ├── utils.ts      → cn (classes) + formatBRL (R$)
    │   └── pedido.ts     → nome do comprador, origem, cor do status e
    │                       `decisaoDoPedido` (que decisão cada papel pode tomar)
    └── styles/globals.css → Tailwind + TOKENS de cor (claro e escuro).
                              Nenhuma tela escreve cor crua: use `primary`,
                              `positive`, `warn`, `danger`, `subtle`, `sunken`.
```

> **Fluxo de um clique:** página (modules) → store/services → `services/api.ts` → API.
> Offline: lê do `offline/db.ts` (Dexie) e enfileira em `offline/sync.ts`.

---

## 🛠️ _tools — utilitários (rodam na sua máquina, com acesso ao ERP/rede)

```
_tools/
├── erp-sync/
│   ├── sync.py    → Firebird → Supabase. Modos: full, products, prices, customers,
│   │                stock, reconcile (liga/desliga ativo), prices-audit (diagnóstico)
│   └── photos.py  → fotos da pasta MARKETING → Supabase Storage → products.image_url
└── firebird-reader/ → leitura/extração do schema do Firebird + DLLs (fbembed)
```

---

## 🧭 "Quero mexer em X — onde vou?"

| Quero… | Vá em |
|---|---|
| Mudar uma **tela** | `apps/web/src/modules/<área>/` |
| Mudar um **botão/input padrão** | `apps/web/src/components/interface/` |
| Mudar o **menu** | `apps/web/src/components/layout/navItems.ts` |
| Mudar **cores/tema** | `apps/web/src/styles/globals.css` + `tailwind.config.ts` |
| Escrever um **teste** | `tests/` na raiz — `pnpm test` (ou `pnpm verify` p/ tudo) |
| Mudar uma **regra de negócio / endpoint** | `apps/api/src/modules/<área>/*.service.ts` |
| Adicionar **rota na API** | `apps/api/src/modules/<área>/*.router.ts` |
| Mudar um **tipo de dado** | `packages/shared/src/types/` |
| Mudar o **banco** (colunas) | nova migration em `apps/api/src/config/migrations/` |
| Mexer no **sync do ERP** | `_tools/erp-sync/sync.py` |
| Mexer no **offline** | `apps/web/src/offline/` |
```
