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
│   ├── user.ts           → User, AuthPayload, Login*, RepListItem, Create/UpdateRepRequest
│   ├── customer.ts       → Customer, CustomerWithPriceTable, PriceTable, CreateCustomerRequest
│   ├── product.ts        → Product, ProductVariant (tamanho), ProductWithPrice, CatalogProduct
│   └── order.ts          → Order, OrderItem, OrderWithItems, CreateOrderRequest, tipos de sync
├── constants/            → uniões + rótulos PT
│   ├── userRole.ts       → 'admin' | 'manager' | 'rep' + labels
│   └── orderStatus.ts    → status do pedido + labels + fluxo permitido
└── pricing/
    ├── faixaDeTamanho.ts → EG/XG/48-54 custam mais: qual tamanho é "faixa maior"
    │                       e qual preço cobrar. Usado pela API (grava o pedido)
    │                       E pelo app (mostra a tela) — precisa ser o MESMO.
    └── priceTier.ts      → (LEGADO/abandonado) regra de preço por total do pedido
```

---

## 🖥️ apps/api — Backend (Fastify + Supabase)

```
apps/api/src/
├── app.ts                → buildApp(): monta o Fastify (helmet, compress, rate-limit 300/min,
│                           cors, jwt, tratamento de erro → INTERNAL_ERROR) e é QUEM REGISTRA
│                           os routers. Sem listen(): serve às duas entradas abaixo.
├── index.ts              → ENTRADA 1 (local / Docker / Railway): listen() + scheduler do ERP
│   (apps/api/api/index.ts → ENTRADA 2 (Vercel, função serverless): a mesma buildApp(),
│                           sem listen() e sem scheduler; o vercel.json reescreve tudo para cá.
│                           Medido em 15/09/2026: só o Railway responde; as URLs da Vercel dão 500)
│
├── config/
│   ├── env.ts            → lê variáveis de ambiente (requireEnv à mão — NÃO há zod aqui).
│   │                       PARTNER_API_KEYS não passa por ele: partner.auth.ts lê process.env
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
│       ├── 022_controle_de_logins.sql → permissions do gerente + last_login_at
│       ├── 023_grade_plus_size.sql → 48/50/52/54 nas 4 refs que têm plus size
│       ├── 024_remove_comissao.sql → DROP da coluna commission_rate (destrutiva)
│       ├── 025_tabela_do_pedido.sql → orders.price_table_id (a tabela DO pedido)
│       ├── 026_preco_da_faixa_maior.sql → product_prices.price_larger (EG/XG/48-54)
│       ├── 027_valor_faturado.sql → orders.invoiced_total (o valor da NOTA)
│       ├── 028_condicoes_de_pagamento.sql → payment_conditions (146 do Control) + orders.payment_condition_id
│       ├── 029_desconto_do_pedido.sql → orders.discount_percent (vai no DESC % da planilha)
│       ├── 030_perfil_financeiro.sql → role 'financeiro' no CHECK de users
│       ├── 031_venda_interna.sql → users.venda_interna (Simone e Nicoli)
│       ├── 032_desconto_em_valor.sql → desconto digitado em reais vira percentual
│       ├── 033_endereco_do_cliente.sql → customers.address (na CS existia só à mão; a Plumene quebrava sem ela)
│       ├── 034_notificacoes_push.sql → push_subscriptions (avisos no celular, Web Push)
│       ├── 035_vitrine_com_cliente.sql → showcase_links.customer_id (link temporário amarrado)
│       ├── 036_historico_de_compra.sql → customers.last_purchase_at/total_purchased/overdue_amount
│       ├── 037_tarefas_do_representante.sql → rep_tasks (o que o escritório pede ao rep; com local e observacoes)
│       ├── 038_perfil_relacionamento.sql → role 'relacionamento' no CHECK de users (a conta da Bruna)
│       ├── 039_controle_de_inatividade.sql → customers.inactivity_* (motivo + observação do cliente vermelho)
│       ├── 040_pedidos_excluidos.sql → deleted_orders (cópia do pedido antes do DELETE; a aba "Excluídos" do admin)
│       ├── 041_cadastro_real.sql → customers.cep/logradouro/numero/complemento/bairro/cidade/uf, inscricao_estadual, observacoes, erp_linked_by/at, cnpj_digits (gerada)
│       ├── 042_numero_do_control_unico.sql → índice único orders(company_id, erp_order_id): dois pedidos nunca com o mesmo número do Control
│       ├── 043_regua_da_carteira.sql → companies.carteira_atencao_dias/carteira_esfriado_dias (o admin muda os 90/180 no Painel)
│       ├── 044_pedido_original.sql → order_originals (a cópia do pedido antes do primeiro corte de peça; o "veio assim, foi faturado assado")
│       ├── (045 NÃO EXISTE — número pulado. Foi reservado por mensagem entre sessões; não assuma que está livre)
│       ├── 046_pedido_atualizado_no_erp.sql → order_erp_sync (o que o Control CONHECE do pedido; o botão "Atualizar no ERP" quando a venda interna edita depois de lançado)
│       └── 047_cliente_varejo.sql → customers.varejo/varejo_marcado_por/varejo_marcado_em (a venda interna tira o cliente de balcão da cobrança de contato; controle interno, não vai ao ERP). É A ÚLTIMA: o próximo número se combina por mensagem antes do commit
│
├── middleware/
│   └── auth.ts           → authenticate (valida JWT) + requireRole(['manager','admin'])
│                           + requirePermission('faturar_pedidos') — teclas do gerente
│
├── lib/
│   ├── password.ts       → hashPassword (bcrypt) + verifyPassword (aceita sha256 legado)
│   ├── detectarColuna.ts → detectar(tabela, coluna): "esta coluna/tabela já existe?" para
│   │                       código que sobe antes da migração rodar. "sim" vale para sempre,
│   │                       "não" vale 30 s (só 42703/42P01/PGRST204/PGRST205 ou "does not
│   │                       exist"); erro de rede não memoriza. Use ISTO, nunca cache próprio.
│   │                       detectarOuFalhar: igual, mas LANÇA quando o banco não respondeu
│   │                       — para coluna que é FILTRO (o invoiced da fila do parceiro)
│   ├── paginacao.ts      → buscarTudo / buscarTudoOuFalhar / buscarPorIds / emLotes: o
│   │                       PostgREST corta em 1.000 linhas EM SILÊNCIO; listagem que pode
│   │                       passar disso pagina aqui. buscarTudo ENGOLE erro de página (serve
│   │                       às telas); buscarTudoOuFalhar LANÇA — é a das rotas do parceiro,
│   │                       onde lista pela metade vira "o resto não existe" no ERP
│   ├── validation.ts     → parseBody(schema zod, body, reply): o 400 padronizado
│   ├── email.ts          → e-mail de confirmação do pedido (Gmail; sem env vira no-op)
│   └── tokens.ts         → tokens dos links de convite/vitrine (só o SHA-256 vai ao banco)
│
├── modules/              → FEATURES — cada uma tem o trio router → controller → service
│   ├── access/           → convite da loja, vitrine temporária e a área da loja
│   │                       (invites, showcase, loja.service = GET /minha-area)
│   ├── auth/             → login, refresh (auth.service tem findUserByEmail, buildAuthPayload)
│   ├── catalog/          → GET /products (com variantes + preço pela tabela do rep)
│   ├── customers/        → GET/POST /customers (rep vê só os dele; gerente vê todos)
│   ├── orders/           → GET/POST /orders, /:id, /status, /invoice, e as
│   │                       alterações em aberto: /desconto, /items, /pagamento
│   │                       (rep nos próprios; gerente em tudo até virar nota)
│   ├── users/            → /usuarios — o admin controla TODOS os logins e as
│   │                       teclas do gerente (só admin entra)
│   ├── reps/             → GET/POST/PATCH /reps + GET /price-tables (gerente/admin)
│   ├── sync/             → POST /sync (fila offline) + controle de sync do ERP
│   ├── partner/          → API DE PARCEIRO (o ERP do Fábio, o "Control"). Sem JWT: header
│   │                       X-API-Key (partner.auth.ts lê PARTNER_API_KEYS direto de
│   │                       process.env; sem a env → 503 PARTNER_API_DISABLED; chave errada
│   │                       → 401 PARTNER_UNAUTHORIZED). SEIS rotas (partner.router.ts):
│   │                         GET  /partner/v1/status
│   │                         GET  /partner/v1/pedidos                (a fila que o ERP PUXA)
│   │                         POST /partner/v1/pedidos/:id/confirmar  (o ERP devolve o número)
│   │                         POST /partner/v1/faturamento            (partner.faturamento.service)
│   │                         POST /partner/v1/clientes               (partner.sync.service)
│   │                         POST /partner/v1/representantes         (partner.sync.service)
│   │                       É o CANAL OFICIAL com o Control (decisão de 15/09/2026 — ver
│   │                       _tools/erp-sync/README.md). O contrato vive em docs/API-PARCEIRO.md
│   │                       e apps/web/public/api-parceiro.html — a MESMA especificação.
│   ├── company/          → POST /companies/onboard (chave da plataforma) + régua da carteira
│   ├── tarefas/          → /tarefas — o que o escritório pede ao rep (migração 037)
│   ├── push/             → /push/* — Web Push (assinar o aparelho, enviar aviso)
│   └── ia/               → relatório da carteira sob demanda (Anthropic ou OpenAI, por env)
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

> **Fluxo de uma requisição:** `app.ts` → router (guard) → controller → service → Supabase.

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
    │   ├── representantes/PaginaRepresentantes → reps (CRUD, meta) [gerente/admin]
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
    │   ├── pedido.ts     → nome do comprador, origem, cor do status e
    │   │                   `decisaoDoPedido` (que decisão cada papel pode tomar)
    │   ├── exportOrders.ts → gera a planilha do Control (32 linhas por arquivo,
    │   │                   o excedente vai num .zip) e entrega por download ou
    │   │                   pela folha de compartilhamento do iPhone
    │   └── planilha/     → o formulário oficial da fábrica
    │       ├── colunas.ts      → tamanho → coluna, e o SISTEMA de grade que
    │       │                     impede uma linha de misturar "XG" com "48"
    │       ├── linhas.ts       → itens do pedido → linhas (uma por ref × grade)
    │       └── modeloOficial.ts → preenche o .xlsx oficial por dentro do zip,
    │                             sem reescrever nada além das células da grade
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
├── tabelas-2027/
│   ├── extrair.py      → lê os 3 PDFs oficiais → tabelas-2027.json (as 2 faixas)
│   ├── carregar.mjs    → substitui as tabelas de preço pelas do PDF
│   └── carregar-faixa-maior.mjs → preenche price_larger (exige a migração 026)
├── erp-sync/
│   ├── README.md  → LEIA ANTES DE RODAR: o que cada modo faz, linha por linha, e a
│   │                DECISÃO de 15/09/2026 sobre o push-orders
│   ├── sync.py    → Firebird → Supabase. Modos: full, products, prices, customers,
│   │                stock, reconcile (liga/desliga ativo), prices-audit (diagnóstico), test
│   │                e push-orders — o ÚNICO que escreve NO FIREBIRD do Fábio (insere
│   │                PEDIDO + ITENS_PEDIDO, cunha o número por GEN_ID e CRIA o generator
│   │                se faltar). Contradiz o contrato "nada é escrito no seu ERP".
│   │                VETADO em produção até o Yan decidir com o Fábio. prices/full também
│   │                estão vetados (upsert de preço duplicado) — ver o README.
│   ├── photos.py  → fotos da pasta MARKETING → Supabase Storage → products.image_url
│   └── fbembed25_x64/ (não versionada) → as DLLs do Firebird ficam AQUI, ao lado do script
├── SQL-PARA-RODAR-046-047.sql     → 046 e 047 num arquivo só, para os DOIS bancos (o de colar hoje)
├── SQL-PARA-RODAR-046.sql         → a 046 sozinha (substituída pelo 046-047). Em 15/09 a API NÃO enxergava a tabela
│                                    em nenhum dos dois bancos (PGRST205): colar e conferir com
│                                    node _tools/conferir-046.mjs (GET de verdade, nunca HEAD)
├── SQL-PARA-RODAR-042-043-044.sql → medido em 15/09: 043/044 nos dois bancos; a 042 estava na
│                                    PLUMENE e FALTAVA na Corpo Sensual. Meça antes de colar.
├── SQL-PARA-RODAR-041-NA-PLUMENE.sql → JÁ APLICADO. Obsoleto; pode ser removido depois.
├── conferir-*.mjs → medem o ESTADO DO BANCO (o que está aplicado de fato), não o arquivo:
│                    conferir-pendencias (quais migrações rodaram; aceita a raiz da PLUMENE),
│                    conferir-046, conferir-fila-e-tabelas (pedidos parados, tabelas sem
│                    erp_code, reps sem código do ERP) e os demais diagnósticos pontuais
└── backup.mjs, importar-*.mjs, faturar-retroativo.mjs, reprecificar-pedidos-abertos.mjs
                 → cargas e consertos pontuais direto no Supabase (fora do app)
```

> `_tools/firebird-reader/` **não existe no disco** (este mapa a listava). O `sync.py:38-42`
> ainda a procura como segunda opção para as DLLs; a primeira é `_tools/erp-sync/fbembed25_x64/`.

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
| Mexer na **API de Parceiro** (o que o Control puxa/confirma) | `apps/api/src/modules/partner/` — e os DOIS docs juntos: `docs/API-PARCEIRO.md` + `apps/web/public/api-parceiro.html` |
| Mexer no **sync do ERP** (Firebird → Supabase) | `_tools/erp-sync/sync.py` — leia `_tools/erp-sync/README.md` antes |
| Rodar o **push-orders** (app → Firebird) | NÃO. Vetado em produção — `_tools/erp-sync/README.md`, seção "DECISÃO" |
| Mexer no **offline** | `apps/web/src/offline/` |
```
