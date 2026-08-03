# Tabelas de preço por representante

**Data:** 2026-08-03
**Estado:** aprovado pelo Yan em conversa; pronto para plano de implementação

---

## O problema

Hoje cada representante tem **uma** tabela de preço, em `users.price_table_id`
(migração 004). Ela decide o preço de tudo que ele faz: o catálogo que ele
navega, o pedido que ele digita e a vitrine que ele gera.

Na prática a fábrica não trabalha assim. A tabela é atribuída por região, e
alguns representantes atendem mais de uma. O caso real:

- João atende só a tabela 1
- Maria atende só a tabela 2
- Wesley atende as duas, e é ele quem decide qual tabela cada cliente dele usa

Com uma coluna só, não há como representar o Wesley. E há uma segunda exigência
que não é conveniência, é regra de negócio: **o João não pode descobrir que a
tabela 2 existe.** Saber o preço da região vizinha é informação comercial que
não pertence a ele.

### O defeito que isso desenterra

Investigando o desenho, apareceu um problema que já existe hoje, independente
desta feature.

`orders.controller.ts:43` precifica o pedido do representante com
`request.user.price_table_id` — a tabela **do rep**. Só o caminho da loja
(linha 54) usa `tabelaDaLoja()`, que prefere a tabela **do cliente**.

Resultado: o mesmo cliente sai com dois preços diferentes dependendo de quem
digita o pedido. Se a loja monta pelo login dela, vale a tabela do cadastro; se
o representante monta pelo app, vale a tabela dele.

Sem corrigir isso, esta feature seria decorativa: o Wesley marcaria tabela 2 no
cliente e o pedido dele continuaria saindo na tabela 1. **A correção entra no
escopo.**

---

## A regra que organiza o resto

> O preço de um cliente é `customers.price_table_id`.
> O conjunto de tabelas do representante não define preço — define apenas
> **o que ele pode atribuir**.

Isso separa duas coisas que hoje estão coladas na mesma coluna: *qual preço vale
para este cliente* e *o que este vendedor tem permissão de escolher*.

---

## Modelo de dados

**Nova tabela** `rep_price_tables`:

| coluna | |
|---|---|
| `company_id` | FK `companies`, ON DELETE CASCADE |
| `user_id` | FK `users`, ON DELETE CASCADE |
| `price_table_id` | FK `price_tables`, ON DELETE CASCADE |

Chave primária composta `(user_id, price_table_id)`. Índice por
`(company_id, user_id)`. RLS ligado, como todas as outras.

**Semeada na própria migração** a partir do `users.price_table_id` de cada rep
existente. Ninguém perde acesso ao rodar o SQL, e o estado depois da migração é
idêntico ao de antes: cada rep com exatamente a tabela que já tinha.

**`users.price_table_id` continua existindo** e passa a ter um significado só:
a tabela que o representante vê no catálogo quando não há cliente em jogo. O
gerente define. Invariante: ela sempre pertence ao conjunto do rep.

Manter a coluna evita reescrever `auth.service`, `sync.service`, `orders` e a
queda de preço da loja — todos leem dela hoje.

---

## Invisibilidade

Representante com **uma** tabela:

- nenhuma rota devolve lista de tabelas para ele;
- nenhum seletor é renderizado — não é campo desabilitado, não existe no DOM;
- tentar atribuir outra tabela pela API devolve 403.

O seletor sumir da tela **não é a proteção**. Toda escolha é revalidada no
servidor contra o conjunto do rep. A tela é conveniência; a trava é o servidor.

---

## O que muda, nas quatro pontas

### 1. Gerente — tela de Representantes

Multi-seleção das tabelas do representante, mais a marcação de qual delas é a
do catálogo dele (`users.price_table_id`). O gerente escolhe quantas quiser.

Ao salvar, se a tabela do catálogo não estiver entre as selecionadas, ela passa
a ser a primeira selecionada — o formulário não deixa gravar um rep cuja tabela
padrão ele não pode usar.

### 2. Representante — cadastro e edição de cliente

Só aparece para quem tem **2 ou mais** tabelas.

Este é o ponto sensível do recurso: trocar a tabela de um cliente muda o preço
de tudo que aquele cliente compra dali para frente, inclusive pelo login próprio
da loja. Então a tela trata como tal:

- o seletor tem destaque visual, separado dos campos comuns de cadastro;
- ao trocar, aparece confirmação **nomeando a tabela** antes de gravar
  ("Mudar o preço de *Workmarker* para **TABELA 02 - 2026**?");
- o cliente que já tem tabela mostra qual é, não um campo vazio.

### 3. Representante — geração da vitrine

Só aparece para quem tem 2 ou mais tabelas. Ele escolhe com qual tabela o link
temporário vai abrir. A tabela continua **congelada** no `showcase_links` no
momento da criação, como já é hoje: se o conjunto do rep mudar depois, quem
recebeu o link continua vendo o preço que foi mostrado.

Rep com uma tabela: nada muda, o link usa a dele.

### 4. Servidor — precificação do pedido

`createOrderHandler` passa a resolver a tabela do pedido do representante pela
mesma regra que a loja já usa: **tabela do cliente**, caindo para a do rep
quando o cliente não tem uma. Isso corrige a divergência descrita acima.

Consequência necessária: enquanto monta o pedido, o representante precisa ver o
preço da tabela do cliente, senão lê um valor na tela e outro no total. Então
`GET /products?price_table_id=` — hoje 403 para rep — passa a ser aceito quando
a tabela pedida está no conjunto dele.

---

## API

| Rota | Mudança |
|---|---|
| `GET /price-tables/minhas` | **nova** — devolve só o conjunto do rep. Gerente/admin recebem todas |
| `POST /reps`, `PATCH /reps/:id` | aceitam `price_table_ids: string[]` |
| `PATCH /customers/:id` | aceita `price_table_id`, validado contra o conjunto do rep |
| `POST /showcase-links` | aceita `price_table_id` opcional, validado contra o conjunto |
| `GET /products?price_table_id=` | deixa de ser 403 para rep quando a tabela está no conjunto dele |

Todas as validações de pertencimento acontecem no servidor, contra
`rep_price_tables`, com o `company_id` do token — nunca com o que vem no corpo.

---

## Testes

Cobertura pelo risco, não por porcentagem. O que custa dinheiro ou vaza
informação comercial:

- rep com 1 tabela: `GET /price-tables/minhas` devolve exatamente 1; atribuir
  outra tabela a um cliente devolve 403; `?price_table_id=` de tabela alheia
  devolve 403;
- rep com 2 tabelas: atribui dentro do conjunto (200) e é barrado fora dele (403);
- gerente: atribui N tabelas; salvar sem a tabela padrão entre elas corrige a
  padrão em vez de gravar estado inválido;
- pedido do representante sai precificado pela tabela **do cliente**;
- pedido de cliente sem tabela cai para a do representante;
- vitrine congela a tabela escolhida, e continua valendo depois que o conjunto
  do rep muda;
- migração é idempotente e preserva o acesso de cada rep existente.

---

## Fora de escopo (decidido)

- **Tabela automática por região.** O Yan foi explícito: o representante
  escolhe, cliente por cliente.
- **Histórico de quem trocou a tabela de qual cliente.** Útil um dia, não hoje.
- **Loja escolher a própria tabela.** Continua sendo leitura, definida no
  cadastro.
