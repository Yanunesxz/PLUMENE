# Controle de logins do admin

**Data:** 2026-08-06
**Base:** `main` @ `7387371` (em dia com `origin/main`, árvore limpa)

## O problema

O admin não controla ninguém além de representante.

Hoje só existe uma tela de cadastro de pessoas — `/representantes` — e ela cria, edita
e bloqueia **apenas** o papel `rep`. Gerente e admin nascem por seed ou SQL direto no
Supabase: não há como criar, bloquear, trocar a senha ou excluir um gerente pelo app.
Login de loja nasce por convite do representante e também não tem visão central.

E o gerente é justamente quem decide o pedido do representante: ele aprova, recusa e
marca faturado. É o papel com mais poder no sistema depois do admin, e é o único que o
admin não consegue tocar.

Duas coisas faltam, então, e são distintas:

1. **Existir o login** — criar, bloquear, trocar senha, excluir. Vale para todo mundo.
2. **O que o login pode fazer** — hoje "gerente" é um bloco só: quem é gerente aprova,
   fatura, mexe em representante e vê comissão. Não dá para dar um pedaço.

## O que muda

### 1. Teclas do gerente

`permissions` é conceito **exclusivo do papel `manager`**. Admin tem tudo, sempre —
teclas nem são consultadas para ele. Rep e loja não têm teclas: o papel deles já
define o alcance por inteiro.

| Tecla | Libera |
|---|---|
| `aprovar_pedidos` | decidir pedido (aprovar/recusar) e excluir pedido |
| `faturar_pedidos` | marcar/desmarcar faturado |
| `gerenciar_representantes` | criar/editar/excluir rep e cadastrar meta de bônus |
| `ver_comissoes` | tela Comissões |
| `importar_produtos` | tela Importar produtos (hoje exclusiva do admin) |

**Coluna nula = padrão do papel.** Um gerente que já existe tem `permissions` nulo e
continua com as quatro primeiras teclas ligadas e `importar_produtos` desligada — que é
exatamente o que ele faz hoje. O array só passa a existir quando o admin salva. Isso é
o que garante que ninguém perde poder no dia do deploy.

### 2. Banco — migração 022, aditiva

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions   TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
```

`last_login_at` responde "quem de fato usa isto?" — é gravado no login sem segurar a
resposta (o usuário não espera esse UPDATE).

Ambas as colunas seguem o padrão `detectarErpRepId` que já existe em `reps.service.ts`:
detecta a existência uma vez e guarda. O código roda **antes** da migração ser aplicada
no Supabase, porque as migrações aqui são rodadas à mão e o deploy não pode depender da
ordem. Sem a 022, a tela funciona e o gerente fica no padrão do papel.

### 3. API — módulo novo `users`, só admin

Módulo próprio em `apps/api/src/modules/users/`. Não encosta em `reps/`. Todas as rotas
com `requireRole(['admin'])` e tudo filtrado pelo `company_id` do token — o isolamento
entre fábricas continua sendo o da camada de aplicação.

| Rota | O que faz |
|---|---|
| `GET /usuarios` | todos os logins da empresa: papel, ativo, último acesso, teclas |
| `POST /usuarios` | cria **admin ou gerente** |
| `PATCH /usuarios/:id` | nome, e-mail, senha nova, ativo, teclas, papel (admin ⇄ gerente) |
| `DELETE /usuarios/:id` | exclui o login |

Rep continua nascendo em `POST /reps` — o cadastro dele exige CPF, tabela, comissão e
código ERP, e ter dois lugares criando representante é como um deles fica esquecido.
Loja continua nascendo por convite. O que `/usuarios` acrescenta para esses dois é o
controle do login em si: bloquear, trocar senha, excluir.

**Trancas, todas no servidor:**

- O admin não pode se bloquear, se excluir, nem se rebaixar a gerente. Sem isso, um
  clique tranca a pessoa para fora do próprio sistema.
- A empresa não pode ficar **sem nenhum admin ativo**. Bloquear, excluir ou rebaixar o
  último admin é recusado com mensagem que diz o motivo.
- Excluir rep delega para o `deleteRep` que já existe, preservando a regra de "rep com
  pedido não é excluído" e a contagem de clientes que ficam sem representante.
- Para os demais papéis, `orders.created_by` e `orders.approved_by` são `NOT NULL`
  **sem `ON DELETE`**: quem tem pedido no histórico não pode ser apagado. A rota
  devolve 409 e a tela oferece **bloquear**, que é o mesmo caminho que a tela de
  representantes já usa hoje.
- Senha é apenas **definida**, nunca exibida. Mesmo `hashPassword` (bcrypt) do resto.

### 4. Onde as teclas passam a valer

`requirePermission(tecla)` novo em `middleware/auth.ts`, aplicado depois do
`requireRole`:

- `admin` passa sempre;
- quem não é `manager` passa — a tecla é conceito de gerente, e o `requireRole` da rota
  já decidiu quem entra;
- `manager` precisa da tecla, lida do token (nulo = padrão do papel = tem).

| Rota | Tecla |
|---|---|
| `PATCH /orders/:id/status` | `aprovar_pedidos` |
| `DELETE /orders/:id` | `aprovar_pedidos` |
| `PATCH /orders/:id/invoice` | `faturar_pedidos` |
| `POST /reps`, `PATCH /reps/:id`, `DELETE /reps/:id`, `PUT /reps/:id/meta` | `gerenciar_representantes` |
| `POST /products/import`, `POST /products/fotos` | `importar_produtos` |

**Fora do guard de propósito:** `GET /reps` e `GET /price-tables`. A tela de Comissões
consome as duas, e guardá-las quebraria uma tela que funciona. `PATCH /orders/:id/status`
é a mesma rota da triagem do representante — por isso o guard só morde o gerente.

As teclas entram no `AuthPayload`, preenchidas no login e no refresh. Mudança de tecla
vale em até 1h, a mesma regra do bloqueio.

### 5. Web — tela nova `/logins`, só admin

Item "Logins" no menu do admin (`adminItems`), rota com `PrivateRoute roles={['admin']}`
e `lazy`, igual às outras telas de gestão — o representante, que usa o app no celular em
campo, não baixa nada disto.

Lista agrupada por papel: Administradores → Gerentes → Representantes → Lojas. Cada
cartão traz nome, e-mail, papel, selo "Inativo" quando for o caso e o **último acesso**
em linguagem de gente ("há 3 dias", "nunca entrou"). Ações: bloquear/desbloquear,
editar, excluir.

No cartão do gerente, as cinco teclas aparecem como chips liga/desliga, salvas no mesmo
formulário da edição. No cartão do representante, um atalho "cadastro completo →" leva
para `/representantes`, onde moram comissão, tabelas, meta e código ERP — esta tela não
duplica esses campos, para não existirem dois donos do mesmo dado.

Aviso fixo na tela: *"Bloquear tira o acesso. Quem estiver com o app aberto cai em até
1 hora."* O admin precisa saber disso antes de bloquear alguém achando que é imediato.

## Limite conhecido

`ver_comissoes` esconde a tela e o item do menu, mas um gerente sem a tecla ainda
alcança `/orders` e `/reps` pela API e poderia recompor os números. É tecla de tela, não
cofre. Blindar de verdade significaria mudar o formato de resposta do `/reps`, que é a
fonte da tela de Representantes — risco que não se paga agora. Está escrito aqui para
que a decisão seja consciente e não uma surpresa depois.

## O que não muda

Esta é a parte que importa tanto quanto o recurso: o que já está pronto continua como
está.

- `reps/`, `orders/` e `catalog/` só ganham o guard nas rotas de escrita. Nenhuma lógica
  de negócio alterada.
- Login e refresh só ganham `last_login_at` e as teclas no token. A autenticação em si
  não é tocada — foi decisão explícita manter o bloqueio valendo em até 1h em vez de
  mexer no miolo do login de rep em campo, loja e vitrine.
- Telas existentes só escondem botão quando a tecla está desligada. Nenhuma mudança de
  layout.
- Migração 022 é aditiva, com duas colunas nulas. O código roda com ou sem ela.

## Testes

Novos:

- `tests/logins-admin.test.ts` — admin não se bloqueia, não se exclui, não se rebaixa;
  o último admin ativo é protegido; gerente e rep tomam 403 em `/usuarios`; login com
  pedido devolve 409 em vez de apagar; usuário de outra fábrica não aparece nem é
  editável.
- `tests/permissoes-gerente.test.ts` — gerente sem `faturar_pedidos` toma 403 no
  invoice e com a tecla passa; gerente legado (`permissions` nulo) mantém tudo; admin
  ignora teclas; rep não é afetado pelo guard na rota que ele divide com o gerente.

A suíte inteira roda no fim: a garantia de que nada do que já existia quebrou.
