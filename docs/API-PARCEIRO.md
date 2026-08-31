# API de Parceiro — Integração de Pedidos (v1)

> **Link para enviar ao parceiro:**
> https://setorx-web-web.vercel.app/api-parceiro
>
> Mesma especificação em página navegável, com exemplos em Delphi, C#, Python,
> PHP, Java, Node e cURL.
>
> A página é servida pelo próprio site: o arquivo fica em
> `apps/web/public/api-parceiro.html` e sobe junto com o deploy do front. A URL
> sem `.html` funciona por um rewrite específico em `apps/web/vercel.json`,
> declarado **antes** do catch-all do SPA. Não use `cleanUrls` para isso — a
> opção faz o Vercel devolver 404 em todas as rotas do app.

Integração para o ERP da fábrica **buscar os pedidos** feitos pelos representantes
no aplicativo e gravá-los no próprio sistema. O aplicativo nunca escreve no banco
do ERP — quem grava é o programa da fábrica, usando esta API como fonte.

- **URL base (produção):** `https://setorxweb-production.up.railway.app`
- **Autenticação:** header `X-API-Key: <sua chave>` em todas as chamadas
  (a chave é fornecida pelo responsável do sistema e identifica a sua empresa)
- **Formato:** JSON, UTF-8, datas em ISO 8601 (`2026-07-15T14:30:00Z`)

## Fluxo recomendado

```
a cada X minutos:
  1. GET  /partner/v1/pedidos            → lista de pedidos aguardando importação
  2. para cada pedido:
       grava no ERP (gera o número interno, ex.: SX16680)
  3. POST /partner/v1/pedidos/{id}/confirmar  { "pedido_erp": "SX16680" }
  4. POST /partner/v1/faturamento             { "faturamento": [...] }  ← fecha o ciclo
       → o pedido sai da fila e nunca mais aparece
```

A fila só contém pedidos **aprovados e ainda não confirmados** — depois do
passo 3 o pedido não volta. Assim não há risco de importar duas vezes, mesmo
que o programa rode de novo ou a conexão caia no meio.

Como alternativa/reforço, há o filtro por data (`?desde=`) para controle
próprio de "até onde eu já puxei".

---

## 1. Teste de conexão

```
GET /partner/v1/status
```

**Resposta 200:**
```json
{ "ok": true, "parceiro": "suaempresa", "servidor_hora": "2026-07-15T20:13:15.006Z" }
```

Sem chave ou com chave errada: `401`.

---

## 2. Buscar pedidos

```
GET /partner/v1/pedidos
GET /partner/v1/pedidos?desde=2026-07-15T00:00:00Z
GET /partner/v1/pedidos?incluir=todos
```

| Parâmetro | Opcional | Descrição |
|---|---|---|
| `desde` | sim | Só pedidos alterados a partir desta data/hora (ISO). Use como marcador "data que eu puxei". |
| `incluir=todos` | sim | Inclui também os já confirmados (`sent_erp`). Sem ele, só a fila pendente. |

**Resposta 200:**
```json
{
  "total": 1,
  "servidor_hora": "2026-07-15T20:28:57.163Z",
  "pedidos": [
    {
      "id": "d31b5083-5cd4-400c-863d-f969904c287f",
      "numero": 14535,
      "situacao": "approved",
      "criado_em": "2026-07-15T20:13:48.015394+00:00",
      "atualizado_em": "2026-07-15T20:14:07.049+00:00",
      "valor_total": 238.7,
      "observacoes": "Entregar na loja do centro",
      "pedido_erp": null,
      "cliente": {
        "codigo_erp": "05836",
        "cnpj": "023.209.286-93",
        "razao_social": "VERONICA ANGELICA DIAS FIGUEIREDO",
        "nome_fantasia": null
      },
      "representante_erp": "04518",
      "tabela_preco": { "codigo_erp": "00016", "coluna": 1 },
      "condicao_pagamento": { "codigo": "021", "descricao": "30/60/90" },
      "desconto_percentual": 10,
      "faturado": false,
      "faturado_em": null,
      "valor_faturado": null,
      "itens": [
        { "produto": "0015", "tamanho": "EG", "cor": "00001",
          "quantidade": 3, "preco_unitario": 42.9, "valor_total": 128.7,
          "observacao": "azul" },
        { "produto": "0015", "tamanho": "G", "cor": "00001",
          "quantidade": 2, "preco_unitario": 55.0, "valor_total": 110.0,
          "observacao": null }
      ],
      "importavel": true,
      "pendencias": []
    }
  ]
}
```

### Campos do pedido

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | texto (UUID) | Identificador único do pedido no aplicativo — use na confirmação |
| `numero` | inteiro ou null | Número legível do pedido no aplicativo |
| `situacao` | texto | `approved` (aguardando importação) ou `sent_erp` (já confirmado) |
| `criado_em` / `atualizado_em` | data ISO | Criação / última alteração |
| `valor_total` | número | Total do pedido, **já com o desconto aplicado** |
| `observacoes` | texto ou null | Só o que o representante DIGITOU (a cor escolhida sai por item, em `itens[].observacao`) |
| `pedido_erp` | texto ou null | Número no ERP (preenchido após a confirmação) |
| `cliente.codigo_erp` | texto | **Código do cliente no seu ERP** (campo CLIENTE) |
| `cliente.cnpj` | texto ou null | CNPJ/CPF para conferência |
| `representante_erp` | texto | **Código do representante no seu ERP** (campo REPRESENTANTE) |
| `tabela_preco.codigo_erp` | texto | **Código da tabela de preço no seu ERP** |
| `tabela_preco.coluna` | inteiro | Coluna de preço usada (1 a 6) |
| `condicao_pagamento` | objeto ou null | **Código da condição no seu ERP** (`codigo`, ex.: `"021"`) + `descricao`. O mesmo código da célula C8 da planilha |
| `desconto_percentual` | número | Desconto do representante em **pontos percentuais** (10 = 10%). Os preços dos itens vêm SEM ele; o `valor_total` já o aplica — mesmo contrato da célula AB46 da planilha |
| `faturado` | booleano | O carimbo de faturado (informado pelo passo 4). Na fila pendente vem sempre `false` |
| `faturado_em` | data ISO ou null | Quando a nota saiu |
| `valor_faturado` | número ou null | O valor que a nota fechou |
| `importavel` | booleano | `true` = todos os vínculos com o ERP presentes |
| `pendencias` | lista | O que falta quando `importavel=false` (ex.: cliente sem código) |

### Campos do item

| Campo | Tipo | Descrição |
|---|---|---|
| `produto` | texto | **Referência do produto no seu ERP** (campo PRODUTO) |
| `tamanho` | texto | Tamanho (P, M, G, GG, EG, numeração...) |
| `cor` | texto | Código da cor. `"00001"` = cores sortidas (pedido por tamanho) |
| `quantidade` | inteiro | Quantidade de peças |
| `preco_unitario` | número | Preço unitário de tabela, **sem** o desconto |
| `valor_total` | número | Total do item (quantidade × preço de tabela) |
| `observacao` | texto ou null | **A(s) cor(es) que o cliente escolheu** para a referência (ex.: `"azul"`, `"3M azul / 2G rosa"`). `null` = sortido de verdade. É o mesmo texto da coluna OBSERVAÇÃO da planilha |

**Sobre a cor:** a operação é por *cores sortidas* — o item vai agregado por
(produto × tamanho) e a coluna COR recebe sempre `"00001"`. Quando o cliente
escolhe cor nas bolinhas do catálogo, a escolha **não muda o produto**: ela
viaja em `observacao`, no texto que a separação lê. Se um dia houver venda por
cor com grade própria no ERP, o código real virá em `cor`, sem mudar o formato.

**Sobre `importavel`:** pedidos com cadastro incompleto vêm com
`importavel: false` e a lista `pendencias` explicando o motivo. Recomendação:
importar apenas os `importavel: true` e reportar os demais.

---

## 3. Confirmar importação

Depois de gravar o pedido no ERP, confirme informando o número gerado:

```
POST /partner/v1/pedidos/{id}/confirmar
Content-Type: application/json

{ "pedido_erp": "SX16680" }
```

| Resposta | Significado |
|---|---|
| `200 {"ok":true,"ja_confirmado":false}` | Confirmado — sai da fila |
| `200 {"ok":true,"ja_confirmado":true}` | Já estava confirmado com esse mesmo número (repetição é segura) |
| `404` | Pedido não encontrado |
| `409` | Já confirmado com **outro** número (resposta traz `pedido_erp_atual`) |
| `400` | Falta o campo `pedido_erp` |

---

## 4. Informar o faturamento

Esta é a etapa que **fecha o ciclo**, e é a mais visível para o lojista.

Confirmar a importação (passo 3) só diz que o pedido entrou no ERP. Enquanto ele
não é faturado, continua sendo uma intenção: o financeiro ainda vai cortar o que
faltou no estoque e acertar o preço. Por isso:

- o lojista só vê **"Aprovado"** depois que o faturamento é informado aqui;
- o painel da fábrica só conta como **venda** o que passou por aqui.

```
POST /partner/v1/faturamento
Content-Type: application/json

{
  "faturamento": [
    { "pedido_erp": "SX16680", "faturado_em": "2026-08-13T14:02:00Z", "valor_faturado": 870.50 },
    { "pedido_erp": "SX16681" }
  ]
}
```

| Campo | Obrigatório | Significado |
|---|---|---|
| `pedido_erp` | sim¹ | O número do pedido no seu ERP (o mesmo do passo 3) |
| `id` | sim¹ | Alternativa ao `pedido_erp`: o id que veio na fila |
| `faturado` | não | `false` cancela um faturamento informado antes. Ausente = `true` |
| `faturado_em` | não | ISO da emissão da nota. Ausente = agora |
| `valor_faturado` | não | O valor que a nota fechou. Ausente = mantém o valor do pedido |

¹ Informe **um** dos dois. `pedido_erp` é o preferido.

**Sobre o `valor_faturado`:** é normal ele ser menor que o total do pedido — o
que faltou no estoque não é faturado. Mandando esse campo, a fábrica passa a ver
o número real em vez do valor pedido. Zero ou negativo é recusado: nota
cancelada se diz com `"faturado": false`, não com valor zerado.

```json
{ "ok": true, "recebidos": 2, "atualizados": 2, "ignorados": [] }
```

Repetir o mesmo envio é seguro. Um registro com problema não derruba o lote:
ele volta em `ignorados` com o motivo, e o resto grava.

Máximo de 1000 pedidos por requisição.

---

## Exemplo completo (linha de comando)

```bash
# fila de pedidos
curl -H "X-API-Key: SUA_CHAVE" \
  https://setorxweb-production.up.railway.app/partner/v1/pedidos

# confirmar
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"pedido_erp\":\"SX16680\"}" \
  https://setorxweb-production.up.railway.app/partner/v1/pedidos/ID_DO_PEDIDO/confirmar

# informar o faturamento
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"faturamento\":[{\"pedido_erp\":\"SX16680\",\"valor_faturado\":870.50}]}" \
  https://setorxweb-production.up.railway.app/partner/v1/faturamento
```

## Boas práticas

- Consulte a fila a cada 1–5 minutos (a chamada é leve).
- Grave o pedido no ERP **antes** de confirmar. Se a gravação falhar, não
  confirme — o pedido continua na fila para a próxima tentativa.
- Trate `409` como alerta: significa confirmação duplicada com números
  diferentes (provável falha no controle interno).
- A chave de API é secreta — não coloque em código-fonte compartilhado.

---

# Cadastros — o ERP ALIMENTA o app (v1)

A mão inversa dos pedidos: aqui o **seu ERP envia** clientes e representantes
atualizados, e o app grava. Você lê do seu banco e faz `POST`; o app nunca toca
no seu sistema. Mesma chave `X-API-Key`, mesma URL base.

**Fluxo recomendado:** a cada ~10 minutos, envie os clientes e os representantes
(em lotes de até 500). É upsert por **código do ERP**: quem já existe é
atualizado, quem não existe é criado. Nada é apagado.

## Regras gerais

- **Tolerante:** um registro incompleto é aceito; só é recusado o que não dá para
  usar (sem código ou sem nome). A resposta lista o que foi ignorado e por quê.
- **Máximo 500–1000 por requisição.** Acima de 1000 → `400`. Divida em lotes.
- **Datas e números** no padrão JSON. CNPJ/telefone podem vir com ou sem
  pontuação.
- **Desativar** um cliente é mandar `bloqueado: "S"` (ou `ativo: "N"` no rep). O
  app **nunca apaga** — cliente tem histórico de pedidos preso a ele.

## POST /partner/v1/clientes

Corpo: `{ "clientes": [ ... ] }` (ou a lista pura).

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do cliente no ERP. A chave do upsert |
| `razao_social` | texto | **Sim** | — |
| `nome_fantasia` | texto | Não | — |
| `cnpj_cpf` | texto | Recomendado | 11 (CPF) ou 14 (CNPJ) dígitos |
| `representante` | texto | **Sim, na prática** | Código do rep. Sem ele, o cliente fica sem dono |
| `tabela_preco` | texto | Recomendado | Código da tabela no ERP. Ver nota abaixo |
| `endereco` | objeto | Recomendado | `{ logradouro, numero, complemento, bairro, cidade, uf, cep }` — o app junta numa linha. Pode mandar como texto pronto também |
| `bloqueado` | `"S"`/`"N"` | Não | `S` = cliente não fecha pedido |
| `limite_credito` | número | Não | — |
| `whatsapp` | texto | Não | Com DDD |
| `email` | texto | Não | — |

**Nota da tabela de preço:** o vínculo é pelo **código** do ERP. Hoje as tabelas
no app estão sem esse código preenchido — enquanto isso, o cliente entra sem
tabela e usa a do representante. Para o vínculo funcionar, o código do ERP de
cada tabela precisa ser preenchido no app (uma vez). A resposta avisa quais
códigos de tabela não foram encontrados.

**Exemplo:**

```json
POST /partner/v1/clientes
X-API-Key: SUA_CHAVE
Content-Type: application/json

{
  "clientes": [
    {
      "codigo": "01234",
      "razao_social": "LOJA DA MARIA LTDA",
      "nome_fantasia": "Moda Maria",
      "cnpj_cpf": "12.345.678/0001-90",
      "representante": "00779",
      "tabela_preco": "01",
      "endereco": {
        "logradouro": "Rua das Flores", "numero": "123",
        "bairro": "Centro", "cidade": "Juiz de Fora", "uf": "MG",
        "cep": "36000-000"
      },
      "bloqueado": "N",
      "whatsapp": "32988887777"
    }
  ]
}
```

**Resposta 200:**

```json
{
  "ok": true,
  "recebidos": 1,
  "criados": 1,
  "atualizados": 0,
  "ignorados": [],
  "avisos": [],
  "servidor_hora": "2026-08-11T20:13:15.006Z"
}
```

`ignorados` traz `{ "codigo": "...", "motivo": "..." }` para cada registro
recusado. `avisos` traz o que passou mas merece conferência (tabela não achada).

## POST /partner/v1/representantes

Corpo: `{ "representantes": [ ... ] }`.

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do rep no ERP. É o que liga os clientes a ele |
| `nome` | texto | **Sim** | — |
| `razao_social` | texto | Não | — |
| `email` | texto | Recomendado | Vira o login dele (minúsculo) |
| `ativo` | `"S"`/`"N"` | Não | — |

**Importante — login não nasce por aqui.** Este endpoint **atualiza** os
representantes que já têm login no app (nome, e-mail, ativo). Um rep que existe no
ERP mas ainda não tem acesso no app **não é criado** — ele volta na resposta em
`novos`, para o administrador criar o acesso à mão (conta precisa de senha, e
senha não nasce de um POST). Isso não trava nada: o cliente já liga ao rep pelo
código, mesmo antes de o rep ter login.

**Resposta 200** (além dos campos comuns): `"novos": [ { "codigo": "...",
"nome": "..." } ]`.

## Erros

| Código | Quando |
|---|---|
| `400 INVALID_BODY` | O corpo não é uma lista nem `{ "clientes": [...] }` |
| `400 BATCH_TOO_LARGE` | Mais de 1000 registros num POST |
| `401 PARTNER_UNAUTHORIZED` | Chave ausente ou errada |
| `503 PARTNER_API_DISABLED` | A chave ainda não foi configurada no servidor |

## Boas práticas (cadastros)

- Envie a cada ~10 min. Não precisa mandar tudo sempre — mandar só o que mudou
  (por `DATA_UPDATE`) deixa o lote pequeno.
- Leia a resposta: `ignorados` e `avisos` mostram o que precisa de ajuste no
  cadastro do ERP.
- Preencha o código do ERP das tabelas de preço no app uma vez, senão os clientes
  entram sem tabela.

---

# Dicionário de dados — TODOS os dados da integração

Referência completa, do cadastro do cliente até o carimbo de faturado. É o
inventário de tudo que circula entre o app e o ERP, com o **dono** de cada dado
(quem cria e quem só lê). Vale a regra geral: **cada dado tem um dono único** —
o outro lado recebe cópia, nunca inventa.

## Quem é dono de cada dado

| Dado | Dono (quem cria) | O outro lado |
|---|---|---|
| Código do cliente | **ERP** | O app recebe por `POST /clientes` e guarda como `codigo_erp` |
| Código do representante | **ERP** | O app recebe e usa para ligar carteira e pedidos |
| Tabela de preço (código e coluna) | **ERP** | O app guarda o vínculo e fotografa no pedido |
| Condição de pagamento (código) | **ERP** | O app tem as 146 cadastradas; rep e loja só escolhem |
| Referência do produto | **ERP** | O app vende só o que está no catálogo da coleção |
| Pedido (itens, desconto, condição, observações) | **App** | O ERP importa via `GET /pedidos` |
| **Número do pedido no ERP** (ex.: SX16680) | **ERP** | Nasce na importação e volta pelo `POST /confirmar` — o app nunca inventa esse número |
| Faturamento (nota, valor, data) | **ERP** | Volta pelo `POST /faturamento`; o app carimba sozinho |

## Cliente

O que o app guarda de cada cliente (alimentado pelo ERP via `POST /clientes`):

| Dado | Campo no envio | Para que serve |
|---|---|---|
| Código no ERP | `codigo` | A identidade do cliente na integração — chave do upsert e o que sai no pedido como `cliente.codigo_erp` |
| Razão social | `razao_social` | Nome oficial, sai nas telas e na conferência do pedido |
| Nome fantasia | `nome_fantasia` | O nome que o representante procura |
| CNPJ/CPF | `cnpj_cpf` | Conferência e casamento de cadastro (as cargas casam por CNPJ) |
| Representante dono | `representante` | Código do rep no ERP — define de quem é a carteira |
| Tabela de preço | `tabela_preco` | Código da tabela no ERP; sem ela o cliente usa a tabela do representante |
| Endereço | `endereco` | Entrega e cadastro |
| Bloqueado | `bloqueado` | `"S"` = não fecha pedido no app |
| Limite de crédito | `limite_credito` | Informativo |
| WhatsApp / e-mail | `whatsapp`, `email` | Contato e o botão "Enviar pedido para o cliente" |

## Representante

| Dado | Campo no envio | Para que serve |
|---|---|---|
| Código no ERP | `codigo` | Liga clientes e pedidos ao rep; sai no pedido como `representante_erp` |
| Nome / razão social | `nome`, `razao_social` | Telas e planilha |
| E-mail | `email` | Vira o login no app |
| Ativo | `ativo` | `"N"` desativa o acesso |

O app ainda tem dados **internos** do rep que o ERP não precisa conhecer:
login/senha, teclas de permissão e o interruptor de *venda interna* (pedido de
balcão que nasce aprovado — para o ERP é um pedido igual aos outros).

## Tabela de preço

| Dado | Onde vive | Observação |
|---|---|---|
| Código no ERP | `tabela_preco.codigo_erp` | Precisa estar preenchido no app (uma vez) para o vínculo funcionar |
| Coluna (1–6) | `tabela_preco.coluna` | Qual coluna de preço do ERP o pedido usou |
| T1/T2/T3 | interno do app | Os nomes das tabelas no catálogo; o ERP só vê código + coluna |

O pedido **fotografa** a tabela no momento da criação — trocar a tabela do
cliente depois não muda pedido antigo.

## Condição de pagamento

| Dado | Onde aparece | Observação |
|---|---|---|
| Código | `condicao_pagamento.codigo` | O MESMO código do Control (ex.: `"021"`) — é o que a planilha põe em C8 |
| Descrição | `condicao_pagamento.descricao` | Ex.: `"30/60/90"` — para conferência humana |

As 146 condições do Control estão cadastradas no app; representante e loja
escolhem uma ao fechar o pedido. Condição nova no ERP precisa ser cadastrada no
app (hoje por carga; no futuro pode virar um `POST /condicoes` — a combinar).

## Pedido

| Dado | Campo | Dono | Observação |
|---|---|---|---|
| Identificador técnico | `id` | App | UUID — use na confirmação; nunca muda |
| Número no app | `numero` | App | O número que rep e cliente enxergam (ex.: 14600) |
| **Número no ERP** | `pedido_erp` | **ERP** | Ex.: `SX16680`. Nasce na importação, volta pela confirmação e aparece no app para todo mundo |
| Situação | `situacao` | App | Ver "Situações do pedido" abaixo |
| Cliente | `cliente.*` | ERP | Código, CNPJ, razão social, fantasia |
| Representante | `representante_erp` | ERP | Código do rep |
| Tabela de preço | `tabela_preco.*` | ERP | Código + coluna, fotografados no pedido |
| Condição de pagamento | `condicao_pagamento.*` | ERP (código) | Escolhida no app entre as condições do Control |
| Desconto | `desconto_percentual` | App | Pontos percentuais (10 = 10%). Preços dos itens SEM desconto; `valor_total` COM. Igual à planilha (AB46) |
| Total | `valor_total` | App | Com o desconto aplicado |
| Observações gerais | `observacoes` | App | Só o que o rep digitou (remessa, boleto, recado) |
| Datas | `criado_em`, `atualizado_em` | App | ISO 8601 |
| Faturamento | `faturado`, `faturado_em`, `valor_faturado` | ERP | O carimbo — ver abaixo |

### Item do pedido

| Dado | Campo | Observação |
|---|---|---|
| Referência | `produto` | A referência que o ERP conhece (ex.: `0015`, `0130 PLUS`) |
| Tamanho | `tamanho` | P, M, G, GG, EG... — nas PLUS a numeração (48...) |
| Cor | `cor` | Sempre `"00001"` (sortido) — a grade do ERP é por tamanho |
| Cor escolhida | `observacao` | O texto da separação: `"azul"`, `"3M azul / 2G rosa"`, ou `null` se sortido |
| Quantidade | `quantidade` | Peças |
| Preço | `preco_unitario` | De tabela, sem desconto |
| Total do item | `valor_total` | quantidade × preço de tabela |

## Situações do pedido (o que o ERP enxerga)

O app tem etapas internas (rascunho, triagem do representante, aceite do
financeiro) que **nunca aparecem na API** — pedido só entra na fila depois de
aprovado. Para o ERP existem só estas:

| `situacao` | Significado | O que fazer |
|---|---|---|
| `approved` | Aprovado pelo financeiro, aguardando importação | Importar e confirmar com o número gerado |
| `sent_erp` | Já importado e confirmado (tem `pedido_erp`) | Nada — só aparece com `incluir=todos` |

**"Faturado" não é situação — é carimbo.** Um pedido `sent_erp` pode estar
faturado ou não; quem diz é o campo `faturado` (com `faturado_em` e
`valor_faturado`), que o ERP preenche pelo `POST /faturamento`. É de propósito:
o faturamento pode ser desfeito (`"faturado": false`) sem mexer na história do
pedido, e é ele que promove o degrau "Aprovado" na página do cliente e conta
venda no painel da fábrica.

## O ciclo completo, dado a dado

```
ERP  → POST /clientes, /representantes     (códigos, carteira, tabela)
rep  → monta o pedido no app               (itens, cores, desconto, condição)
fin. → aceita                              (pedido entra na fila da API)
ERP  → GET /pedidos                        (lê tudo acima)
ERP  → grava e gera o número               (ex.: SX16680)
ERP  → POST /pedidos/{id}/confirmar        (o número volta para o app)
ERP  → fatura e POST /faturamento          (nota, valor, data → carimbo)
app  → página do cliente vira "Aprovado", painel conta a venda
```

---

## Dúvidas / suporte

Falar com Yan (responsável pelo sistema de pedidos).
