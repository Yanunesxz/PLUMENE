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
| `Dockerfile` + `railway.toml` | Build/deploy da **API** no Railway. Uma instalação por marca: Corpo Sensual em `setorxweb-production.up.railway.app`, PLUMENE em `csbapi-production.up.railway.app` — as duas URLs (e a regra de uma chave de parceiro por marca) estão em `docs/API-PARCEIRO.md` |
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
│   ├── control.ts        → SolicitacaoErp (o pedido solicitado ao Control, esperando o número) e
│   │                       NotaSubstituida (a nota nova por cima da anterior) — migração 049
│   ├── user.ts           → User, AuthPayload, Login*, RepListItem, Create/UpdateRepRequest
│   ├── customer.ts       → Customer, CustomerWithPriceTable, PriceTable, CreateCustomerRequest
│   ├── product.ts        → Product, ProductVariant (tamanho), ProductWithPrice, CatalogProduct
│   └── order.ts          → Order, OrderItem, OrderWithItems, CreateOrderRequest, tipos de sync
├── constants/            → uniões + rótulos PT
│   ├── userRole.ts       → 'admin' | 'manager' | 'rep' + labels
│   └── orderStatus.ts    → status do pedido + labels + fluxo permitido
├── pedidos/              → regras do pedido que a API e a tela precisam contar IGUAL
│   ├── numeroErp.ts      → o número do Control ("SX14627"): normaliza, valida, sugere o próximo
│   ├── observacaoCores.ts → as cores escolhidas dentro das observações (o item sai sortido)
│   ├── sincroniaErp.ts   → o que o Control conhece do pedido x o pedido de hoje (046)
│   └── pedidoOriginal.ts → o pedido original x o faturado (044): usa os itens das notas ativas
│                           (048) quando eles chegam e, sem eles, NÃO diz "nenhuma peça cortada"
├── cadastro/
│   └── codigoErp.ts      → codigoMiolo (para CASAR: "#02225" = "2225") e codigoCanonico (para
│                           GRAVAR: "779" → "00779"). A mesma regra de public.codigo_miolo (048);
│                           tests/codigo-miolo.test.ts confere a paridade
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
│       ├── 047_cliente_varejo.sql → customers.varejo/varejo_marcado_por/varejo_marcado_em (a venda interna tira o cliente de balcão da cobrança de contato; controle interno, não vai ao ERP)
│       ├── 048_integracao_control_fase_0.sql → base da integração com o Control: erp_sync_log registra as
│       │                           chamadas do parceiro; companies.canal_* (canal oficial de cada fluxo, por
│       │                           empresa; padrão = hoje); orders.erp_order_source/set_at/set_by; order_erp_events
│       │                           (rastro do pedido, sem FK: sobrevive à exclusão); public.codigo_miolo() + trava
│       │                           price_tables.price_column 1-6 + erp_code único pelo miolo; users.updated_at;
│       │                           order_invoices e order_invoice_items (notas e itens faturados). SQL para os dois
│       │                           bancos em _tools/SQL-PARA-RODAR-048.sql. NÃO rerodar depois da 049 (o bloco D
│       │                           recolocaria a lista antiga no CHECK de tipo)
│       └── 049_integracao_control_respostas.sql → as respostas do Control (decisões de 16/09/2026): orders.erp_requested_at/by
│                                   (pedido SOLICITADO ao Control com canal 'api'; índice parcial da fila) + users.erp_email
│                                   + order_invoices.substituida_por/em (nota nova por cima da anterior) +
│                                   companies.sync_solicitado_em/por ("Sincronizar agora") + customers.erp_updated_at/
│                                   retrato_referencia_em/pendencia_financeira/pendencia_financeira_em/titulos_vencidos +
│                                   price_tables.erp_description/erp_updated_at/active + payment_conditions.erp_description/
│                                   erp_updated_at/valor_minimo + products.erp_updated_at + product_variants.stock_updated_at
│                                   + product_prices.erp_updated_at/preco_original/desconto_percentual + CHECK de
│                                   order_erp_events.tipo com solicitado_ao_erp/nota_substituida/excluido_pelo_erp. Exige a
│                                   048 (para com mensagem se ela faltar). SQL para os dois bancos em
│                                   _tools/SQL-PARA-RODAR-049.sql. É A ÚLTIMA: o próximo número se combina por mensagem
│                                   antes do commit
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
│   ├── canais.ts         → lerCanais(company_id) / exigirCanal / corpoCanalFechado: o canal oficial
│   │                       de cada fluxo com o Control (companies.canal_*, 048). Sem a 048 = padrões
│   │                       de hoje (manual/carga); banco sem resposta LANÇA; memória de 30 s
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
│   │                       (rep nos próprios; gerente em tudo até virar nota).
│   │                       eventosErp.service.ts → registrarEventoErp (order_erp_events) e
│   │                       gravarOrigemDoNumero (erp_order_source no update do número), 048;
│   │                       TIPOS_DE_EVENTO_ERP é a lista do CHECK da 049 (a da 048 + 3)
│   │                       notasDoPedido.service.ts → notas fiscais e peças faturadas (048):
│   │                       lerNotasDoPedido (GET /orders/:id → `notas`, com a ativa e o
│   │                       histórico), detectarNotas, cancelarNotasAtivas (desfazer o
│   │                       faturado pela tela) e lerSubstituicoesDoPedido (049: "a 1234
│   │                       foi substituída pela 1260")
│   │                       exclusaoPeloControl.service.ts → o Control excluiu o pedido e
│   │                       avisou (POST /partner/v1/pedidos/:id/excluir): cópia em
│   │                       deleted_orders no formato do deleteOrder, evento
│   │                       'excluido_pelo_erp'; pedido faturado é recusado
│   │                       orders.service.ts: solicitarLancamentoNoErp (049) — com
│   │                       canal_pedido_erp='api' o "Lançar" SOLICITA (erp_requested_at)
│   │                       e a tela espera a confirmação do Control; cliente bloqueado
│   │                       NÃO trava o pedido (decisão 8 de 16/09/2026)
│   ├── users/            → /usuarios — o admin controla TODOS os logins e as
│   │                       teclas do gerente (só admin entra)
│   ├── reps/             → GET/POST/PATCH /reps + GET /price-tables (gerente/admin)
│   ├── sync/             → POST /sync (fila offline) + controle de sync do ERP
│   ├── partner/          → API DE PARCEIRO (o ERP do Fábio, o "Control"). Sem JWT: header
│   │                       X-API-Key (partner.auth.ts lê PARTNER_API_KEYS direto de
│   │                       process.env; sem a env → 503 PARTNER_API_DISABLED; chave errada
│   │                       → 401 PARTNER_UNAUTHORIZED). DEZENOVE rotas (partner.router.ts):
│   │                         GET  /partner/v1/status                 (+ `canais`, sincronizar_agora, solicitado_em)
│   │                         GET  /partner/v1/pedidos                (a fila: aprovado + SOLICITADO ao Control)
│   │                         GET  /partner/v1/pedidos/excluidos      (excluídos com número; livre)
│   │                         POST /partner/v1/pedidos/:id/confirmar  (o ERP devolve o número)
│   │                         POST /partner/v1/pedidos/:id/conciliar  (sent_erp sem número)
│   │                         POST /partner/v1/pedidos/:id/excluir    (o Control excluiu; partner.cadastros.controller)
│   │                         GET  /partner/v1/conciliacao            (só contagens; livre)
│   │                         POST /partner/v1/faturamento            (partner.faturamento.service; UMA nota por pedido)
│   │                         POST /partner/v1/clientes               (partner.sync.service; casa por CNPJ, depois código)
│   │                         POST /partner/v1/representantes         (partner.sync.service; email → users.erp_email)
│   │                         GET  /partner/v1/clientes?desde=        (o Control PUXA o que mudou no app)
│   │                         GET  /partner/v1/representantes?desde=  (idem; partner.cadastros.controller)
│   │                         POST /partner/v1/tabelas-preco          (partner.catalogo.service)
│   │                         POST /partner/v1/condicoes-pagamento    (idem)
│   │                         POST /partner/v1/produtos               (idem; produtos e tamanhos)
│   │                         POST /partner/v1/precos                 (idem; sobrescreve o preço por tabela)
│   │                         POST /partner/v1/estoque                (idem)
│   │                         POST /partner/v1/retrato                (partner.retrato.service; 1x/dia)
│   │                         POST /partner/v1/sincronizacao          (partner.sincronizacao.controller; livre)
│   │                       Canal por empresa (048, lib/canais.ts): pedidos/confirmar/conciliar/excluir
│   │                       exigem canal_pedido_erp='api'; faturamento, canal_faturamento='api';
│   │                       clientes/representantes (POST e GET), canal_cadastro='api'; as cinco do
│   │                       catálogo, canal_catalogo='api'; retrato, canal_retrato='api'. Senão
│   │                       409 CANAL_FECHADO. status/conciliacao/excluidos/sincronizacao são livres.
│   │                       É o CANAL OFICIAL com o Control (decisão de 15/09/2026 — ver
│   │                       _tools/erp-sync/README.md). O contrato vive em docs/API-PARCEIRO.md
│   │                       e apps/web/public/api-parceiro.html — a MESMA especificação.
│   │                       partner.porta.ts → a porta de TODO handler: autenticar, recusouPorCanal,
│   │                       lerLote (INVALID_BODY / BATCH_TOO_LARGE), responder, anotarLote, lerDesde
│   │                       partner.log.ts → registrarChamada: cada chamada em erp_sync_log (048);
│   │                       nunca derruba a resposta; `detalhe` sem dado de cliente.
│   │                       partner.chamada.ts → o resumo que o handler anota em request.partnerLog
│   │                       e o hook onResponse do router grava (401/503 com company_id nulo)
│   │                       partner.controller.ts / partner.service.ts → status, fila, confirmar,
│   │                       conciliar, conciliação (+ aprovados_solicitados_ao_control), excluídos
│   │                       partner.cadastros.controller.ts → GET clientes/representantes ?desde= e
│   │                       a exclusão avisada pelo Control
│   │                       partner.catalogo.{controller,service}.ts → decisão 6: o Control manda
│   │                       tabelas, condições, produtos/tamanhos, preços e estoque e sobrescreve;
│   │                       name/description do CRM NUNCA regravados (descrição vai em erp_description)
│   │                       partner.retrato.{controller,service}.ts → retrato do cliente (última
│   │                       compra só para frente, total, vencido, pendência, títulos vencidos)
│   │                       partner.sincronizacao.controller.ts → o Control avisa que rodou a passada
│   │                       pedida pelo botão da tela (limpa companies.sync_solicitado_em)
│   ├── integracao/       → A TELA DA INTEGRAÇÃO (decisão 7): GET /erp/integracao/status (canais,
│   │                       pedido de sync, última chamada por rota, contagens da fila; financeiro/
│   │                       gerente/admin) e PATCH /erp/integracao/sincronizar (o botão "Pedir
│   │                       sincronização agora", financeiro/admin; grava companies.sync_solicitado_em).
│   │                       lerSolicitacaoDeSync é o que o GET /partner/v1/status usa.
│   ├── company/          → POST /companies/onboard (chave da plataforma) + régua da carteira
│   ├── tarefas/          → /tarefas — o que o escritório pede ao rep (migração 037)
│   ├── push/             → /push/* — Web Push (assinar o aparelho, enviar aviso)
│   └── ia/               → relatório da carteira sob demanda (Anthropic ou OpenAI, por env)
│
├── erp/                  → integração com o ERP (Firebird)
│   ├── adapter.ts        → abstração (troca mock ↔ real sem mexer no resto). sendOrder
│   │                       LANÇA (EnvioAoErpDesligadoError): o número vem do Control
│   └── firebird/         → connection, queries, types, erpSyncService. Além de
│                           ERP_SYNC_ENABLED, cada parte exige o canal da empresa:
│                           catálogo/preço/estoque só com canal_catalogo='firebird',
│                           clientes só com canal_cadastro='firebird' (senão pula; as
│                           rotas /erp/sync respondem 409 CANAL_FECHADO)
│
└── jobs/
    ├── seed.ts           → popula dados de teste (pnpm seed)
    ├── liberacaoDoAmbiente.ts → copia process.env ANTES do dotenv: o "sim" de quem roda
    │                            não pode vir do .env (que aponta para produção)
    ├── seedDemoOrders.ts → pedidos de demonstração: exige --empresa=<uuid> e
    │                       SEED_DEMO_LIBERADO=sim no ambiente, recusa produção, e o
    │                       DELETE de pedido vazio nunca pega pedido com número do Control
    └── erpSyncScheduler.ts → agenda o sync periódico (só empresas com canal 'firebird')
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
    │   │   └── PaginaDetalhePedido     → detalhe (itens, decidir, faturar, WhatsApp; com
    │   │                                 canal api o "Lançar" SOLICITA ao Control e espera o número)
    │   ├── integracao/PaginaIntegracao → estado da integração com o Control e o botão
    │   │                                 "Pedir sincronização agora" [financeiro/gerente/admin]
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
    │                        LancarNoErp, AtualizarNoErp, ConfirmarFaturamento, SeletorDeTabela,
    │                        PedidoOriginal (o original x o faturado, peça por peça),
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
│   │                Trava no código (fase 0): os modos que gravam recusam sem a env
│   │                ERP_SYNC_PY_LIBERADO=sim NA JANELA do terminal (no .env não vale); o
│   │                push-orders exige ainda companies.canal_pedido_erp='sync_py'.
│   ├── photos.py  → fotos da pasta MARKETING → Supabase Storage → products.image_url.
│   │                Também grava no catálogo: mesmas travas do sync.py
│   │                (ERP_SYNC_PY_LIBERADO=sim + canal_catalogo='firebird'); --dry-run é livre
│   └── fbembed25_x64/ (não versionada) → as DLLs do Firebird ficam AQUI, ao lado do script
├── SQL-PARA-RODAR-049.sql         → a 049 para colar nos DOIS bancos, DEPOIS da 048 (termina com o NOTIFY).
│                                    Conferir depois com node _tools/conferir-049.mjs [raiz da PLUMENE]
├── SQL-PARA-RODAR-048.sql         → a 048 para colar nos DOIS bancos (termina com o NOTIFY). Conferir
│                                    depois com node _tools/conferir-048.mjs [raiz da PLUMENE]
├── SQL-PARA-RODAR-013-042-NA-CS.sql → SÓ NA CORPO SENSUAL: a 013 inteira + o índice único da 042.
│                                    Rodar antes a consulta de repetidos que está no cabeçalho
├── SQL-PARA-RODAR-046-047.sql     → 046 e 047 num arquivo só — JÁ APLICADO nos dois bancos (15/09)
├── SQL-PARA-RODAR-046.sql         → a 046 sozinha (substituída pelo 046-047). Medido em 15/09 09:5x com
│                                    node _tools/conferir-046-047.mjs: 046 e 047 visíveis nos DOIS bancos
├── SQL-PARA-RODAR-042-043-044.sql → medido em 15/09: 043/044 nos dois bancos; a 042 estava na
│                                    PLUMENE e FALTAVA na Corpo Sensual. Meça antes de colar.
├── SQL-PARA-RODAR-041-NA-PLUMENE.sql → JÁ APLICADO. Obsoleto; pode ser removido depois.
├── conferir-*.mjs → medem o ESTADO DO BANCO (o que está aplicado de fato), não o arquivo:
│                    conferir-pendencias (quais migrações rodaram; aceita a raiz da PLUMENE),
│                    conferir-046, conferir-048 e conferir-049 (GET com limit=0, nunca HEAD), conferir-fila-e-tabelas (pedidos parados, tabelas sem
│                    erp_code, reps sem código do ERP) e os demais diagnósticos pontuais
└── backup.mjs, importar-*.mjs, faturar-retroativo.mjs, reprecificar-pedidos-abertos.mjs
                 → cargas e consertos pontuais direto no Supabase (fora do app).
                   faturar-retroativo.mjs exige --empresa=<uuid>, é ensaio por padrão
                   (--aplicar grava) e recusa empresa com canal_faturamento='api'.
                   apps/api/src/jobs/seedDemoOrders.ts também exige --empresa=<uuid>
                   e SEED_DEMO_LIBERADO=sim no ambiente da execução.
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
| Mexer na **API de Parceiro** (o que o Control puxa/confirma/manda) | `apps/api/src/modules/partner/` — e os DOIS docs juntos: `docs/API-PARCEIRO.md` + `apps/web/public/api-parceiro.html`. Rota nova entra também em `ROTAS_DO_PARCEIRO` (`modules/integracao/integracao.service.ts`) para a tela dar o título |
| Mexer no **sync do ERP** (Firebird → Supabase) | `_tools/erp-sync/sync.py` — leia `_tools/erp-sync/README.md` antes |
| Rodar o **push-orders** (app → Firebird) | NÃO. Vetado em produção — `_tools/erp-sync/README.md`, seção "DECISÃO" |
| Mexer no **offline** | `apps/web/src/offline/` |
```
