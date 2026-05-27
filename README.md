# Corpo Sensual B2B

Plataforma web comercial para representantes de vendas — catálogo, pedidos e painel gerencial com suporte offline-first.

## Visão Geral

Este sistema é uma camada moderna integrada ao ERP existente. **Não substitui o ERP** — ele continua responsável por estoque real, faturamento, financeiro e emissão fiscal.

### Responsabilidades deste sistema

- Catálogo de produtos com preços por tabela
- Criação e acompanhamento de pedidos
- Experiência mobile otimizada
- Funcionamento offline com sincronização automática
- Painel comercial para gerentes

## Pré-requisitos

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+ — `npm install -g pnpm`
- Conta no [Supabase](https://supabase.com/) com projeto criado

## Instalação

```bash
# 1. Instalar dependências de todos os workspaces
pnpm install

# 2. Configurar variáveis de ambiente da API
cp apps/api/.env.example apps/api/.env
# Edite apps/api/.env com suas credenciais do Supabase

# 3. Configurar variáveis do frontend (opcional — padrão aponta para localhost)
cp apps/web/.env.example apps/web/.env

# 4. Criar as tabelas no Supabase
# Execute o SQL do schema (./docs/schema.sql) no SQL Editor do Supabase

# 5. Popular dados de exemplo
pnpm seed
```

## Desenvolvimento

```bash
# API + Web em paralelo
pnpm dev

# Apenas a API (http://localhost:3001)
pnpm dev:api

# Apenas o frontend (http://localhost:5173)
pnpm dev:web
```

## Build de produção

```bash
pnpm build
```

## Qualidade de código

```bash
pnpm typecheck   # Verificação TypeScript em todos os workspaces
pnpm lint        # ESLint
pnpm format      # Prettier
```

## Estrutura do projeto

```
corpo-sensual-b2b/
├── apps/
│   ├── web/                    # Frontend React + Vite + PWA
│   │   └── src/
│   │       ├── modules/        # auth, catalog, orders, customers, dashboard
│   │       ├── offline/        # Dexie.js schema + sync queue
│   │       ├── hooks/          # useOnlineStatus, useSyncOnReconnect
│   │       ├── store/          # Zustand (auth)
│   │       ├── services/       # api.ts (fetch wrapper)
│   │       ├── components/     # ui/ (Badge, Toast) e layout/ (AppLayout, BottomNav)
│   │       └── router/         # PrivateRoute + createBrowserRouter
│   └── api/                    # Backend Fastify + Node.js
│       └── src/
│           ├── modules/        # auth, catalog, customers, orders, sync
│           ├── erp/            # ErpAdapter interface + MockErpAdapter
│           ├── jobs/           # seed.ts
│           ├── middleware/     # auth JWT + requireRole
│           └── config/         # env.ts + supabase.ts
└── packages/
    └── shared/                 # Tipos e constantes compartilhados
        └── src/
            ├── types/          # User, Customer, Product, Order, api
            └── constants/      # orderStatus, userRole
```

## Papéis de usuário

| Papel     | Permissões                                                    |
|-----------|---------------------------------------------------------------|
| `rep`     | Ver catálogo, criar pedidos, ver seus clientes                |
| `manager` | Aprovar/recusar pedidos, painel geral, todos os clientes      |
| `admin`   | Configurações, usuários, tabelas de preço                     |

## Fluxo de pedido

```
draft → pending_approval → approved / rejected → sent_erp → error_erp
```

## Offline First

Pedidos criados sem internet são salvos no IndexedDB (Dexie.js) via `sync_queue`.
Ao reconectar, o hook `useSyncOnReconnect` processa a fila automaticamente via `POST /sync`.
O toast informa quantos pedidos foram sincronizados. Itens com erro permanecem na fila com contador de tentativas.
Conflitos são resolvidos por _last-write-wins_ via campo `updated_at`.

## Variáveis de ambiente

### `apps/api/.env`

| Variável                   | Descrição                           | Obrigatória |
|----------------------------|-------------------------------------|-------------|
| `PORT`                     | Porta do servidor (padrão: 3001)    | Não         |
| `NODE_ENV`                 | `development` / `production`        | Não         |
| `JWT_SECRET`               | Secret longo e aleatório            | **Sim**     |
| `JWT_EXPIRES_IN`           | Expiração do token (padrão: `1h`)   | Não         |
| `JWT_REFRESH_EXPIRES_IN`   | Expiração do refresh (padrão: `7d`) | Não         |
| `SUPABASE_URL`             | URL do projeto Supabase             | **Sim**     |
| `SUPABASE_SERVICE_ROLE_KEY`| Chave service role do Supabase      | **Sim**     |
| `CORS_ORIGIN`              | Origem permitida pelo CORS          | Não         |

### `apps/web/.env`

| Variável       | Descrição                              | Padrão                  |
|----------------|----------------------------------------|-------------------------|
| `VITE_API_URL` | URL da API backend                     | `http://localhost:3001` |

## Credenciais de seed

Após `pnpm seed`:

| E-mail              | Senha        | Papel     |
|---------------------|--------------|-----------|
| admin@csb.com       | admin123     | admin     |
| gerente@csb.com     | gerente123   | manager   |
| joao@csb.com        | rep123       | rep       |

> **Atenção:** O MVP usa SHA-256 para hash de senha. Substituir por bcrypt antes de produção.

## ERP Adapter

A interface `ErpAdapter` em `apps/api/src/erp/adapter.ts` abstrai a comunicação com o ERP.
O MVP usa `MockErpAdapter` que retorna dados fixos. Para integrar o ERP real, implemente a interface
e substitua a instância exportada `erpAdapter`.
