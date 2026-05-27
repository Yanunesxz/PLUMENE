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
- [pnpm](https://pnpm.io/) 9+
- Conta no [Supabase](https://supabase.com/) com projeto criado

## Instalação

```bash
# Clonar o repositório
git clone <url-do-repo>
cd corpo-sensual-b2b

# Instalar dependências de todos os workspaces
pnpm install

# Configurar variáveis de ambiente
cp apps/api/.env.example apps/api/.env
# Edite apps/api/.env com suas credenciais do Supabase
```

## Desenvolvimento

```bash
# Rodar API e Web em paralelo
pnpm dev

# Rodar apenas a API
pnpm dev:api

# Rodar apenas o frontend
pnpm dev:web
```

A API sobe em `http://localhost:3001` e o frontend em `http://localhost:5173`.

## Build

```bash
pnpm build
```

## Qualidade de código

```bash
# Verificar tipagem TypeScript
pnpm typecheck

# Lint
pnpm lint

# Formatar código
pnpm format
```

## Estrutura do projeto

```
corpo-sensual-b2b/
├── apps/
│   ├── web/          # Frontend React + Vite + PWA
│   └── api/          # Backend Fastify + Node.js
└── packages/
    └── shared/       # Tipos e constantes compartilhados
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

Pedidos criados sem internet são salvos no IndexedDB (Dexie.js).
Ao reconectar, a fila de sincronização processa automaticamente.
Conflitos são resolvidos por _last-write-wins_ via campo `updated_at`.

## Variáveis de ambiente

Veja `apps/api/.env.example` para a lista completa de variáveis necessárias.
