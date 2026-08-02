# Triagem do representante e "Minha área" da loja

**Data:** 2026-08-02
**Estado:** implementado
**Continua:** [acesso da loja e vitrine temporária](./2026-07-31-acesso-loja-e-vitrine-design.md)

---

## O problema

O acesso da loja (014) entregou o caminho de entrada — conta própria por convite
e link de vitrine — mas parou antes de responder duas perguntas:

1. **Quem decide se aquilo vira pedido de fábrica?** O pedido da loja caía direto
   na fila do gerente. O representante, que é quem conhece a loja, não via nada
   e não decidia nada.
2. **O que a loja tem para voltar?** Ela tinha catálogo e uma tela de cadastro em
   leitura. Nada que responda "faz quanto tempo que eu não compro" ou "o que eu
   costumo comprar" — que é o que faz ela voltar sozinha.

E havia um terceiro problema, que só apareceu ao testar de ponta a ponta: **o
acesso da loja não funcionava**. O token saía sem `customer_id`, então nada do
que a 014 construiu chegava a rodar.

---

## As decisões

### 1. Um portão a mais, não um portão diferente

Status novo `pending_rep`. Pedido de `store` e `showcase` nasce nele.

```
loja / vitrine  →  pending_rep  →  pending_approval  →  approved  →  sent_erp
                   (representante)   (gerente)
representante   →  pending_approval  →  …
```

O representante que monta o pedido **pula** a triagem: ele já é o filtro. Quem
compra nunca escolhe o próprio status.

**O que cada papel pode:**

| | `pending_rep` → `pending_approval` | `pending_rep` → `rejected` | `pending_approval` → `approved` |
|---|---|---|---|
| representante | sim | sim | **não** |
| gerente/admin | sim (destrava rep ausente) | sim | sim |
| loja/vitrine | não | não | não |

Recusar **fora** da triagem é negado ao representante: seria derrubar um pedido
que o gerente já tem na mesa. E `pending_rep` não entra no schema da rota de
status — ninguém empurra um pedido para a triagem por fora, ele só nasce assim.

### 2. "Minha conta" vira "Minha área"

Mesmo endereço (`/minha-area`) para papéis diferentes, porque é assim que as
duas pessoas falam disso. O representante vê desempenho e a fila de triagem; a
loja vê o histórico dela.

O que a loja vê, nesta ordem: **há quantos dias não compra** (com "Repetir
última compra" do lado), pedidos em análise, números, o que mais compra, os
últimos pedidos e — por último — o cadastro.

Passando de 60 dias o cartão do topo muda de cor. É o lembrete que o
representante daria por telefone, aparecendo sozinho.

**Repetir a compra** usa o preço do catálogo de hoje, não o do pedido antigo, e
deixa de fora peça que saiu de linha — ela derrubaria o pedido inteiro no envio.

### 3. Um endpoint só para a tela da loja

`GET /minha-area` devolve conta + resumo + peças + pedidos + itens para repetir.
O agrupamento é no servidor porque montar o histórico de peças exige juntar
`order_items` de todos os pedidos: no celular seria uma requisição por pedido, e
a tela abre em campo, com sinal ruim.

`GET /minha-conta` continua de pé: quem tem o app instalado tem a versão antiga
em cache até o PWA atualizar.

---

## Falhas encontradas no caminho

Nenhuma delas era hipótese — todas impediam o uso real.

- **Token da loja sem vínculo.** `buildAuthPayload` nunca copiou `customer_id`
  nem `rep_id`. Catálogo sem tabela de preço, `/orders` filtrando por
  `customer_id` vazio e `POST /orders` respondendo "acesso sem loja vinculada".
  Nada do acesso da loja funcionava.
- **O convite não gravava o dono.** O convite sabia qual representante o gerou e
  jogava isso fora. Agora vai para `users.rep_id`.
- **A loja não conseguia montar pedido.** A tela exigia escolher um cliente numa
  lista que, para ela, nunca carregava (`/customers` é negada). Travava em
  "selecione o cliente", sem saída.
- **`POST /sync` sem guarda de papel.** Um token de vitrine criava pedido por
  ali, escapando da exigência de nome e WhatsApp. E o pedido offline da loja
  entrava com ela mesma como representante, sem tabela de preço.

---

## Banco (migração 015)

```
orders
  ~ CHECK de status passa a aceitar 'pending_rep'
  + índice parcial (company_id, rep_id, status) WHERE status = 'pending_rep'

users
  + rep_id UUID REFERENCES users(id)   -- loja: o representante dono
```

**Deploy fora de ordem:** CHECK não dá para detectar com um `SELECT`. A API
descobre gravando: se o banco recusar `pending_rep`, o pedido cai em
`pending_approval` (comportamento da 014) e não tenta de novo. A loja compra
igual enquanto o SQL não roda — muda só onde o pedido para.

---

## Fora de escopo

- Notificar a loja quando o pedido é decidido (hoje ela vê ao abrir o app).
- Representante editar o pedido que a loja montou antes de mandar adiante.
- Meta de recompra por loja / régua de relacionamento automática.
