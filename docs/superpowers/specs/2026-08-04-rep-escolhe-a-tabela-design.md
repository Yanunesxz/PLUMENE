# O representante escolhe a tabela

**Data:** 2026-08-04
**Estado:** aprovado pelo Yan em conversa
**Continua:** [2026-08-03-tabelas-por-representante-design.md](2026-08-03-tabelas-por-representante-design.md)

---

## Onde paramos

A migração 018 está aplicada em produção e a tela do gerente já atribui várias
tabelas a um representante. A SIMONE está com as três tabelas de 2027 e a 02
como principal.

Falta o outro lado: ela ainda não escolhe nada. O conjunto existe no banco e não
aparece em lugar nenhum do app dela.

## O defeito que torna tudo isso urgente

`orders.controller.ts:43` precifica o pedido do representante com
`request.user.price_table_id` — a tabela **dele**. Só o caminho da loja usa
`tabelaDaLoja()`, que prefere a do cliente.

Enquanto isso não mudar, a SIMONE pode marcar TABELA 03 no cliente e o pedido
dela continua saindo na TABELA 02. O seletor não seria só inútil: seria
mentiroso — mostraria uma escolha que o servidor ignora.

**A correção entra no escopo.** Pedido do representante passa a usar a tabela do
cliente, caindo para a do rep quando o cliente não tem uma.

Consequência necessária: `GET /products?price_table_id=` hoje devolve 403 para
rep. Passa a aceitar quando a tabela pedida está no conjunto dele — senão ela
lê um preço na tela e recebe outro no total.

---

## Os dois avisos

Mandar a tabela errada custa dinheiro e é invisível até a fatura. Então a
escolha aparece duas vezes antes de gravar, e nunca por omissão.

**Aviso 1 — o bloco amarelo.** Separado dos campos comuns, com os tokens `warn`
do design system:

```
┌─ ⚠ Tabela de preço ────────────────────────────────┐
│  Isto define o preço de tudo que este cliente      │
│  comprar. Confira antes de salvar.                 │
│   ○ TABELA 01 - 2027                               │
│   ○ TABELA 02 - 2027                               │
│   ○ TABELA 03 - 2027                               │
└────────────────────────────────────────────────────┘
```

Nada vem marcado. O botão de salvar fica bloqueado até escolher. Vir com a
principal marcada seria o cenário perigoso: cadastro no piloto automático e
cliente da região 3 nascendo na tabela 2.

**Aviso 2 — a confirmação.** Nomeia a tabela no título **e** no botão, para o
nome ser lido duas vezes sem ninguém digitar nada:

> **Cadastrar WORKMARKER na TABELA 03 - 2027?**
> O preço de tudo que esta loja comprar vem desta tabela.
> `Cancelar` · `Sim, TABELA 03 - 2027`

Na troca de um cliente que já tem tabela, o texto muda de tom — é mudança, não
começo:

> **Mudar o preço de WORKMARKER para TABELA 03 - 2027?**
> Hoje esta loja compra na TABELA 02 - 2027. A mudança vale para os próximos
> pedidos, inclusive os que ela mesma fizer pelo login dela.

No link temporário, a confirmação nomeia as duas coisas:
*"Gerar link de 6h com a TABELA 03 - 2027?"*.

**Rep com uma tabela só não vê nada disso.** Não é campo desabilitado: o bloco
não existe no DOM, não há confirmação, e o fluxo dele fica idêntico ao de hoje.
O João não pode descobrir que a tabela 2 existe.

---

## As três telas

### Cadastro de cliente novo — `PaginaClientes`

O bloco amarelo entra no formulário, depois do endereço.

### Cliente que já existe — `PaginaClientes`

Os 1.353 clientes vieram do ERP já com tabela. O cartão de cada cliente mostra a
tabela atual; tocar nela abre a troca, com os mesmos dois avisos.

**Sigilo:** se o ERP pôs o cliente numa tabela **fora do conjunto do rep**, o
cartão mostra `outra tabela`, sem o nome. Ver o nome da tabela da região vizinha
é ver informação comercial que não pertence a ele, mesmo de relance.

### Link temporário — `PaginaAcessos`, aba Link temporário

O bloco amarelo entra acima dos quatro botões de duração, que ficam bloqueados
até a escolha. A tabela continua **congelada** em `showcase_links`: se o
conjunto do rep mudar depois, quem recebeu o link continua vendo o preço que foi
mostrado.

---

## Servidor

A tela é conveniência. A trava é o servidor: toda escolha é revalidada contra
`rep_price_tables` com o `company_id` **do token**, nunca com o que vem no corpo.

| Rota | Mudança |
|---|---|
| `POST /customers` | aceita `price_table_id` opcional, validado contra o conjunto |
| `PATCH /customers/:id` | **nova** — só a tabela de preço; valida o conjunto E que o cliente é da carteira de quem pede |
| `POST /showcase-links` | aceita `price_table_id` opcional; sem ele, a principal do rep |
| `GET /products?price_table_id=` | deixa de ser 403 para rep quando a tabela está no conjunto dele |
| `POST /orders` | pedido do rep passa a usar a tabela do **cliente**, caindo para a do rep |

`PATCH /customers/:id` é deliberadamente estreito: só `price_table_id`. Abrir
edição do cadastro inteiro é outro assunto, com outros riscos.

`GET /price-tables/minhas` já existe e já devolve só o conjunto de quem pede.

**Carteira, no PATCH:** o cliente precisa ser `rep_id = sub` **ou**
`rep_erp_id = erp_rep_id` do token — as duas metades da carteira, como
`getCustomers` já faz. Gerente e admin passam por qualquer cliente da empresa.

---

## Front-end

Um componente para os dois avisos, usado nas três telas — a mensagem e o risco
são os mesmos, e duplicar o texto do aviso é como ele acaba divergindo.

- `SeletorDeTabela` — o bloco amarelo. Renderiza `null` com menos de 2 tabelas.
- `ConfirmarTabela` — a confirmação. Recebe o texto do caso (cadastrar / mudar /
  gerar link) e nomeia a tabela no título e no botão.
- `useMinhasTabelas()` — busca `/price-tables/minhas` uma vez e devolve
  `{ tabelas, precisaEscolher }`.

`CustomerListItem` ganha `price_table_id`. São 36 caracteres por cliente em
1.353 — desprezível perto do que a lista já carrega, e é o que permite o cartão
mostrar a tabela sem uma segunda requisição.

---

## Testes

Cobertura pelo risco — o que custa dinheiro ou vaza informação comercial:

- rep com 1 tabela: `/price-tables/minhas` devolve exatamente 1; atribuir outra
  tabela a um cliente devolve 403; `?price_table_id=` de tabela alheia devolve 403;
- rep com 2 tabelas: atribui dentro do conjunto (200), é barrado fora dele (403),
  e `?price_table_id=` de tabela do conjunto passa (200);
- `PATCH /customers/:id` em cliente de outra carteira devolve 403 mesmo com a
  tabela certa;
- pedido do representante sai precificado pela tabela **do cliente**;
- pedido de cliente sem tabela cai para a do representante;
- vitrine congela a tabela escolhida e continua valendo depois que o conjunto muda.

---

## Fora de escopo

- Edição do cadastro do cliente além da tabela.
- Histórico de quem trocou a tabela de qual cliente.
- Tabela automática por região — o Yan foi explícito: o rep escolhe, cliente a cliente.
