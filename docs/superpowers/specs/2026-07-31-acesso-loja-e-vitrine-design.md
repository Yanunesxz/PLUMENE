# Acesso da loja e vitrine temporária

**Data:** 2026-07-31
**Estado:** aprovado pelo Yan em conversa; pronto para plano de implementação

---

## O problema

Hoje só quem entra no sistema é gente da fábrica: `admin` cuida do gerente,
`manager` cuida dos representantes, `rep` vende. A loja — quem efetivamente
compra — não tem acesso a nada. Todo pedido passa pelo representante digitando.

Duas necessidades diferentes saíram disso:

1. **Lojas de confiança** querem comprar a qualquer hora, sem depender do
   representante estar disponível. Precisam de conta durável, com histórico.
2. **Curiosos** pedem para "ver o catálogo". Hoje não há como mostrar sem dar
   acesso permanente, e o representante não quer abrir a tabela de preço para
   qualquer um que pergunta.

O que une os dois: **nenhum deles aprova nada**. Todo pedido que sai daí cai
como `pending_approval` para o representante analisar — exatamente o fluxo que
já existe.

---

## Os dois acessos

### 1. Loja (`store`) — conta durável

Papel novo, com acesso reduzido.

**Como nasce:** o representante escolhe um cliente **já cadastrado na carteira
dele** e gera um convite. O link vai para a loja (WhatsApp), a loja abre e
**define a própria senha**. O convite é de **uso único** — depois de usado, morre.

Não existe convite para loja não cadastrada. O cliente precisa existir antes,
porque é dele que vêm a tabela de preço, o CNPJ e o dono.

**O que a loja vê:**

| Tela | Acesso |
|---|---|
| Catálogo | Sim — preços da tabela dela |
| Novo pedido | Sim — cai como `pending_approval` |
| Meus pedidos | Sim — só os dela |
| Minha conta | Sim — nome, CNPJ, WhatsApp, e-mail (leitura) |
| Clientes, Representantes, Comissões, Painel, Importar | Não |

**O que ela nunca recebe:** quantidade em estoque (só disponível/esgotado, igual
ao representante), tabela de preço de terceiros, pedido de outra loja.

**Preço:** `customer.price_table_id`, com queda para a tabela do representante
dono quando o cliente não tem uma. Isso não é detalhe: **809 dos 1.353 clientes
estão sem tabela**, então sem a queda a maioria das lojas veria catálogo vazio.

### 2. Vitrine (`guest`) — link temporário e anônimo

Não é usuário, não tem senha, não tem conta.

O representante gera um link escolhendo a validade: **1h, 6h, 12h ou 24h**.
Manda para o curioso. O link mostra **só o catálogo**, precificado pela tabela do
próprio representante.

Ao fechar o pedido, um formulário curto pede **nome e WhatsApp** — é o que
permite o representante saber com quem falar, já que não há cadastro. O pedido
cai para ele analisar como qualquer outro.

Expirado o prazo, o link para de funcionar. O representante também pode revogar
antes da hora.

---

## Banco (migração 014)

```
users
  + customer_id UUID REFERENCES customers(id) ON DELETE CASCADE
  + role passa a aceitar 'store'
  + índice único parcial (company_id, customer_id) -> um login por loja

orders
  ~ customer_id passa a aceitar NULL          -- pedido de vitrine não tem cliente
  + guest_name TEXT                            -- nome informado no formulário
  + guest_whatsapp TEXT
  + source TEXT DEFAULT 'rep'                  -- 'rep' | 'store' | 'showcase'
  + CHECK: customer_id IS NOT NULL OR source = 'showcase'

store_invites                                  -- convite de conta (uso único)
  id, company_id, customer_id, rep_id,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at, used_at, created_at

showcase_links                                 -- vitrine temporária
  id, company_id, rep_id, price_table_id,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at, revoked_at, created_at,
  opened_count INT DEFAULT 0, last_opened_at
```

**Por que `customer_id` nulo em vez de criar um cliente "lead":** criar cadastro
para cada curioso enche a carteira do representante de gente que nunca comprou.
O pedido de vitrine é um pedido sem cliente, e o banco passa a dizer isso.

**Tokens:** 32 bytes aleatórios em base64url, guardados **só como SHA-256**. O
valor original existe uma vez, no link entregue. Vazamento do banco não vira
acesso.

---

## API

### Rotas novas

| Rota | Quem | O quê |
|---|---|---|
| `POST /invites` | rep | Gera convite para um cliente da carteira |
| `GET /invites` | rep | Lista convites dele (pendente/usado/expirado) |
| `DELETE /invites/:id` | rep | Revoga convite não usado |
| `GET /public/invite/:token` | público | Valida e devolve nome da loja para a tela |
| `POST /public/invite/:token` | público | Define senha e cria a conta `store` |
| `POST /showcase-links` | rep | Gera vitrine (`hours`: 1, 6, 12 ou 24) |
| `GET /showcase-links` | rep | Lista as dele |
| `DELETE /showcase-links/:id` | rep | Revoga |
| `POST /public/showcase/:token` | público | Valida e devolve JWT de convidado |

Rotas `/public/*` sem autenticação, com rate-limit apertado (10/min por IP) —
são as únicas superfícies abertas do sistema.

### Rotas existentes que mudam

- **`GET /products`** — `store` usa a tabela do cliente (com queda para a do rep);
  `guest` usa a do link. Nenhum dos dois recebe `available`, nem pode passar
  `?price_table_id=`. `onlyPriced` ligado para os dois.
- **`GET /orders`** — `store` vê só onde `customer_id` = o dela. `guest` não acessa.
- **`POST /orders`** — `store` força `customer_id` dela e `rep_id` do dono;
  `guest` exige `guest_name` + `guest_whatsapp` e grava `customer_id = NULL`.
  Os dois entram como `pending_approval`, sempre.
- **`PATCH /orders/:id/status` e `/invoice`** — negados para `store` e `guest`.
- **`/customers`, `/reps`, `/price-tables`, `/catalog/price-tables`** — negados.

### Token

`AuthPayload` ganha `customer_id` e o papel passa a incluir `store` e `guest`.
O JWT de convidado expira junto com o link (`exp` = `expires_at` da vitrine),
então link vencido não sobrevive num token já emitido.

---

## Web

**Telas novas**

- `/convite/:token` — pública. Mostra o nome da loja, pede senha e confirmação,
  cria a conta e já entra.
- `/vitrine/:token` — pública. Catálogo em modo convidado, com aviso de validade.
  No fechamento, formulário de nome + WhatsApp.
- `/minha-conta` — da loja. Nome, CNPJ, WhatsApp, e-mail, tabela de preço, em
  leitura. Alteração de cadastro continua sendo da fábrica.
- Na área do representante: gerar convite (a partir de um cliente) e gerar
  vitrine (escolhendo 1h/6h/12h/24h), com lista e botão de revogar.

**Menu por papel** — `navItemsForRole` ganha o caso `store`: Catálogo, Pedidos,
Minha conta. Nada mais.

**Pedido do representante** — a lista passa a mostrar a origem do pedido e, nos
de vitrine, o nome e WhatsApp informados no lugar do cliente.

---

## Testes

Seguindo a suíte que já existe (`tests/`, vitest, Supabase dublado):

- **Autorização** (`app.inject`): a matriz de papéis ganha `store` e `guest`.
  Cada rota negada acima vira um teste. Especialmente: loja não vê pedido de
  outra loja, convidado não lista pedidos, nenhum dos dois recebe `available`.
- **Convite**: uso único (segundo uso falha), expirado falha, token errado falha,
  senha curta falha, conta criada com o `customer_id` certo.
- **Vitrine**: link expirado recusa, revogado recusa, JWT emitido expira junto
  com o link, pedido sem nome/WhatsApp é recusado.
- **Pedido**: pedido de loja nasce `pending_approval` com o `rep_id` do dono;
  pedido de vitrine grava `customer_id` nulo com os dados do convidado.

---

## Fatias de entrega

1. **Banco e contrato** — migração 014, papéis novos em `@csb/shared`, `AuthPayload`.
2. **API — vitrine** — links, rota pública, autorização de convidado, pedido anônimo.
3. **API — convite e loja** — convites, criação de conta, autorização da loja.
4. **Web — públicas** — `/vitrine/:token` e `/convite/:token`.
5. **Web — loja e representante** — menu da loja, minha conta, telas de gerar link.

Cada fatia entra com os testes dela.

---

## Fora de escopo

- Loja alterar o próprio cadastro (continua com a fábrica).
- Converter pedido de vitrine em cliente cadastrado com um clique.
- Recuperação de senha da loja — segue a regra atual: **só a fábrica redefine**.
- Pagamento, boleto, frete.
