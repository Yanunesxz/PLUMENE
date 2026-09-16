# API de Parceiro — Integração de Pedidos (v1)

> **Atualizado 15 set 2026.** Contrato da fase 0 da integração com o Control:
> canal por empresa, conciliação do passivo, faturamento com notas e peças,
> cadastros que não apagam o que não veio. Tudo isso entrou **antes da primeira
> chave ser emitida** e é correção da v1, não versão nova (ver "Estabilidade da
> v1", no fim).
>
> **Link para enviar ao parceiro:** https://setorx-web-web.vercel.app/api-parceiro
> (site da Corpo Sensual). O site da PLUMENE serve a mesma página no mesmo
> caminho, `/api-parceiro`.
>
> Mesma especificação em página navegável, com exemplos em Delphi, C#, Python,
> PHP, Java, Node e cURL. A página é servida pelo próprio site: o arquivo fica
> em `apps/web/public/api-parceiro.html` e sobe junto com o deploy do front. A
> URL sem `.html` funciona por um rewrite específico em `apps/web/vercel.json`,
> declarado **antes** do catch-all do SPA. Não use `cleanUrls` para isso — a
> opção faz o Vercel devolver 404 em todas as rotas do app.

Integração para o ERP da fábrica **buscar os pedidos** feitos pelos representantes
no aplicativo e gravá-los no próprio sistema. O aplicativo nunca escreve no banco
do ERP — quem grava é o programa da fábrica, usando esta API como fonte.

- **Autenticação:** header `X-API-Key: <sua chave>` em todas as chamadas
  (a chave é fornecida pelo responsável do sistema e identifica a sua empresa)
- **Formato:** JSON, UTF-8, datas em ISO 8601 **com fuso** (`2026-07-15T14:30:00Z`
  ou `2026-07-15T11:30:00-03:00`)
- **Limites:** corpo de até 1 MB por requisição (acima disso, `413`); 300
  requisições por minuto por IP (acima disso, `429`); 1000 registros por lote
  em todos os `POST` de lista

## URLs por marca — uma chave por marca

Cada marca é uma instalação separada, com servidor e banco próprios. Por isso
são **duas URLs** e **duas chaves**:

| Marca | URL base (produção) |
|---|---|
| Corpo Sensual | `https://setorxweb-production.up.railway.app` |
| PLUMENE | `https://csbapi-production.up.railway.app` |

**Uma chave por marca.** A chave de cada marca só vale na URL daquela marca e
só enxerga os pedidos daquela marca. A chave de uma marca na URL da outra
responde `401 PARTNER_UNAUTHORIZED`. Rode uma rotina por marca, cada uma com a
sua URL e a sua chave, e nunca misture os pedidos das duas: o `id` de um pedido
e o número do ERP confirmado numa marca não existem na outra.

Os exemplos desta página usam a URL da Corpo Sensual; na PLUMENE, troque só a
URL e a chave — as rotas, os campos e os códigos são os mesmos.

## Os nove endpoints

| Método e rota | Para quê | Canal exigido |
|---|---|---|
| `GET /partner/v1/status` | Testar a conexão e a chave; diz quais canais estão ligados | — |
| `GET /partner/v1/pedidos` | Buscar a fila de pedidos aprovados aguardando importação | pedidos |
| `POST /partner/v1/pedidos/{id}/confirmar` | Confirmar a importação com o número gerado no ERP | pedidos |
| `POST /partner/v1/pedidos/{id}/conciliar` | Dar o número a um pedido que foi para o ERP sem número (o passivo) | pedidos |
| `GET /partner/v1/conciliacao` | Só contagens, para conferir o passivo antes e depois de cada rodada | — |
| `GET /partner/v1/pedidos/excluidos` | Pedidos excluídos no app que já tinham número do ERP | — |
| `POST /partner/v1/faturamento` | Informar o que foi faturado (com a nota e as peças) — fecha o ciclo | faturamento |
| `POST /partner/v1/clientes` | O ERP envia os clientes (cadastro) | cadastro |
| `POST /partner/v1/representantes` | O ERP envia os representantes (cadastro) | cadastro |

Quatro chamadas fazem o ciclo do pedido (testar, buscar, confirmar, faturar);
conciliar, conciliação e excluídos acertam o que aconteceu antes da integração
ou fora dela; as duas de cadastro rodam por conta própria, na frequência que o
ERP quiser. Mesma chave e mesma URL base dentro de cada marca.

## Canal por empresa

Cada fluxo tem **um escritor só**. Enquanto a fábrica ainda lança o número do
pedido e o faturado à mão no aplicativo, a API não pode escrever os mesmos
dados — seria pedido lançado duas vezes e faturamento que se desfaz sozinho. Por
isso cada empresa tem três canais, e **o Yan (responsável pelo sistema) liga
cada canal para a API, empresa por empresa**, quando a fábrica estiver pronta
para parar de lançar aquele dado à mão:

| Canal | Rotas que dependem dele | Valor que libera a API |
|---|---|---|
| `pedido_erp` | `GET /pedidos`, `POST /confirmar`, `POST /conciliar` | `api` |
| `faturamento` | `POST /faturamento` | `api` |
| `cadastro` | `POST /clientes`, `POST /representantes` | `api` |

Com o canal em outro valor, a rota responde `409` **antes de ler o corpo ou os
parâmetros** e sem gravar nada:

```json
{
  "error": "Canal de faturamento ainda não está ligado para a API nesta empresa",
  "code": "CANAL_FECHADO",
  "statusCode": 409,
  "canal": "faturamento",
  "valor_atual": "manual"
}
```

O que o `409 CANAL_FECHADO` significa: **não é erro do seu programa** — é a
fábrica que ainda não virou a chave daquele fluxo. Combine com o Yan; depois que
ele liga o canal, a API passa a aceitar em até 30 segundos. Nas rotas que
exigem canal, a ordem das checagens é: chave (`401`/`503`) → canal
(`409 CANAL_FECHADO`) → corpo e parâmetros (`400`). Se o canal não puder ser
lido no momento (falha do banco), a resposta é `500` — tente de novo, nada foi
gravado.

`GET /status` mostra os três canais da sua empresa. `GET /status`,
`GET /conciliacao` e `GET /pedidos/excluidos` funcionam com qualquer canal — só
leem.

**Toda chamada fica registrada** do nosso lado (rota, status HTTP, quantos
registros chegaram, gravaram, ficaram iguais e foram ignorados, e os motivos) —
sem a sua chave e sem dado de cliente. É por esse registro que respondemos "o
que aconteceu com o envio das 14h".

## Fluxo recomendado

```
uma vez, na implantação (com o Yan):
  GET  /partner/v1/conciliacao                 → quantos pedidos foram ao ERP sem número
  POST /partner/v1/pedidos/{id}/conciliar      { "pedido_erp": "PL02672" }  (um por pedido do passivo)

a cada X minutos:
  1. GET  /partner/v1/pedidos            → lista de pedidos aguardando importação
  2. para cada pedido:
       grava no ERP (gera o número interno, ex.: CS17379)
  3. POST /partner/v1/pedidos/{id}/confirmar  { "pedido_erp": "CS17379" }
       → o pedido sai da fila e nunca mais aparece
  4. POST /partner/v1/faturamento             { "faturamento": [...] }  ← fecha o ciclo

a cada ~10 minutos, por fora do ciclo:
  POST /partner/v1/clientes          { "clientes": [...] }
  POST /partner/v1/representantes    { "representantes": [...] }
```

A fila só contém pedidos **aprovados, ainda não confirmados e ainda não
faturados** — depois do passo 3 o pedido não volta. Assim não há risco de
importar duas vezes, mesmo que o programa rode de novo ou a conexão caia no
meio.

Como alternativa/reforço, há o filtro por data (`?desde=`) para controle
próprio de "até onde eu já puxei".

## O número do pedido no ERP

O número que o seu ERP gera e devolve na confirmação (`pedido_erp`) tem formato
fixo: **duas letras e de 1 a 10 dígitos** (`^[A-Z]{2}\d{1,10}$`). Exemplos
válidos: `CS17379`, `PL02672`. Antes de validar e gravar, o app **normaliza** o
texto — maiúsculas, sem espaço, ponto, hífen ou barra: `cs 17379`, `CS-17379` e
`cs.17379` viram `CS17379`. É a forma normalizada que fica gravada e que volta
em `pedido_erp`. Fora do formato, a confirmação responde `400 INVALID_PEDIDO_ERP`.

O app **nunca** cunha esse número: quem numera é o ERP. O mesmo número não pode
estar em dois pedidos da mesma empresa (`409 ERP_NUMBER_IN_USE`).

---

## 1. Teste de conexão

```
GET /partner/v1/status
```

**Resposta 200:**
```json
{
  "ok": true,
  "parceiro": "suaempresa",
  "servidor_hora": "2026-07-15T20:13:15.006Z",
  "canais": { "pedido_erp": "api", "faturamento": "manual", "cadastro": "carga" }
}
```

`canais` diz quais rotas estão ligadas para a API na sua empresa (ver "Canal por
empresa"): `pedido_erp` é `manual`, `api` ou `sync_py`; `faturamento` é `manual`
ou `api`; `cadastro` é `carga`, `api` ou `firebird`. Só `api` libera a rota.

Sem chave ou com chave errada (inclusive a chave de uma marca na URL da outra, e
a chave que ainda não foi cadastrada): `401 PARTNER_UNAUTHORIZED`. Integração
ainda não liberada naquele servidor (nenhuma chave configurada):
`503 PARTNER_API_DISABLED`. Vale para as nove rotas.

---

## 2. Buscar pedidos

```
GET /partner/v1/pedidos
GET /partner/v1/pedidos?desde=2026-07-15T00:00:00Z
GET /partner/v1/pedidos?incluir=todos
```

| Parâmetro | Opcional | Descrição |
|---|---|---|
| `desde` | sim | Só pedidos alterados (`atualizado_em`) a partir desta data/hora (ISO, de preferência com fuso). Use como marcador "data que eu puxei". Data inválida → `400 INVALID_DESDE`. |
| `incluir=todos` | sim | Inclui também os já confirmados (`sent_erp`) e os já faturados. Sem ele, só a fila pendente. |

**A fila pendente** (sem `incluir=todos`) é: situação `approved`, sem número do
ERP (`pedido_erp` nulo) e **não faturado**. Pedido que já foi faturado à mão no
aplicativo não entra na fila — aparece só com `incluir=todos`.

**Importar a partir de `incluir=todos`:** a lista traz `approved` e `sent_erp`,
faturados ou não, e o `sent_erp` sai com `importavel: true` como qualquer
outro. Importe **só quem tem `pedido_erp` nulo e `faturado` falso**, e entre
esses só a situação `approved` — que é exatamente a fila pendente. O resto não
se importa:

- `pedido_erp` preenchido: já está no ERP;
- `faturado: true` com `pedido_erp` nulo: lançado e faturado à mão antes da
  integração;
- `sent_erp` com `pedido_erp` nulo: é o **passivo**, lançado à mão sem o número
  voltar ao app — já está no ERP. Não importe: dê o número a ele pelo
  `POST /conciliar` (seção 3b).

**Não há paginação do seu lado:** a resposta traz todos os pedidos que casam com
o filtro, em ordem de criação (`criado_em` e, no empate, `id`), e `total` é a
contagem real. Não existe `?page` nem `?limit`. Se a leitura falhar no meio, a
resposta é `500` — nunca uma lista parcial. Como a fila muda enquanto é lida
(alguém pode confirmar ou aprovar um pedido no meio), trate a lista pelo `id`:
não importe o mesmo `id` duas vezes, e um pedido que "faltou" numa rodada vem na
seguinte.

**Resposta 200:**
```json
{
  "total": 1,
  "servidor_hora": "2026-07-15T20:28:57.163Z",
  "pedidos": [
    {
      "id": "d31b5083-5cd4-400c-863d-f969904c287f",
      "numero": 10231,
      "situacao": "approved",
      "criado_em": "2026-07-15T20:13:48.015394+00:00",
      "atualizado_em": "2026-07-15T20:14:07.049+00:00",
      "valor_total": 238.7,
      "observacoes": "Entregar na loja do centro",
      "pedido_erp": null,
      "cliente": {
        "codigo_erp": "01234",
        "cnpj": "00.000.000/0001-00",
        "razao_social": "CLIENTE TESTE LTDA",
        "nome_fantasia": "LOJA TESTE",
        "endereco": {
          "cep": "00000000", "logradouro": "Rua Teste", "numero": "100",
          "complemento": null, "bairro": "Centro", "cidade": "Cidade Teste", "uf": "MG"
        },
        "inscricao_estadual": null,
        "whatsapp": "00900000000",
        "email": null
      },
      "representante_erp": "00042",
      "tabela_preco": { "codigo_erp": "00007", "coluna": 1 },
      "condicao_pagamento": { "codigo": 21, "descricao": "30/60/90" },
      "desconto_percentual": 10,
      "faturado": false,
      "faturado_em": null,
      "valor_faturado": null,
      "itens": [
        { "produto": "REF100", "tamanho": "G", "cor": "00001",
          "quantidade": 3, "preco_unitario": 42.9, "valor_total": 128.7,
          "observacao": "azul" },
        { "produto": "REF100", "tamanho": "GG", "cor": "00001",
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
| `situacao` | texto | `approved` (aguardando importação) ou `sent_erp` (já enviado ao ERP; só aparece com `incluir=todos`) |
| `criado_em` / `atualizado_em` | data ISO | Criação / última alteração |
| `valor_total` | número | Total do pedido, **já com o desconto aplicado** |
| `observacoes` | texto ou null | Só o que o representante DIGITOU (a cor escolhida sai por item, em `itens[].observacao`) |
| `pedido_erp` | texto ou null | Número no ERP, na forma normalizada (ex.: `CS17379`). Nulo na fila; preenchido pela sua confirmação ou conciliação |
| `cliente.codigo_erp` | texto | **Código do cliente no seu ERP** (campo CLIENTE) |
| `cliente.cnpj` | texto ou null | CNPJ/CPF para conferência |
| `cliente.razao_social` / `cliente.nome_fantasia` | texto ou null | Nomes do cadastro |
| `cliente.endereco` | objeto | `{ cep, logradouro, numero, complemento, bairro, cidade, uf }` — sempre com as sete chaves; cada uma sai `null` quando o cadastro não tem o dado. `cep` só com dígitos |
| `cliente.inscricao_estadual` | texto ou null | Inscrição estadual do cadastro |
| `cliente.whatsapp` / `cliente.email` | texto ou null | Contato do cadastro |
| `representante_erp` | texto | **Código do representante no seu ERP** (campo REPRESENTANTE) — o código gravado no cliente |
| `tabela_preco.codigo_erp` | texto ou null | **Código da tabela de preço no seu ERP** — a tabela que **precificou este pedido**. Pedido sem tabela gravada usa a tabela do cadastro do cliente. Tabela sem código do ERP sai `null` e gera a pendência `pedido sem tabela de preço vinculada no ERP` (nunca cai para outra tabela) |
| `tabela_preco.coluna` | inteiro | Coluna de preço **dessa tabela** (1 a 6; `1` quando a tabela não tem coluna gravada) |
| `condicao_pagamento` | objeto ou null | `codigo`: **número inteiro** da condição no Control (ex.: `21`; zeros à esquerda não vêm) + `descricao` (ex.: `"30/60/90"`, o texto que a planilha põe na C8). `null` quando o pedido não tem condição escolhida — isso **não** gera pendência |
| `desconto_percentual` | número | Desconto do representante em **pontos percentuais** (10 = 10%). Os preços dos itens vêm SEM ele; o `valor_total` já o aplica — mesmo contrato da célula AB46 da planilha |
| `faturado` | booleano | O carimbo de faturado (informado pelo passo 4, ou à mão no aplicativo). Na fila pendente vem sempre `false` — pedido faturado não entra na fila; aparece com `incluir=todos` |
| `faturado_em` | data ISO ou null | Quando a nota saiu |
| `valor_faturado` | número ou null | O valor que a nota fechou |
| `importavel` | booleano | `true` = todos os vínculos com o ERP presentes (`pendencias` vazia). Não diz se o pedido já foi importado — para isso, `pedido_erp` |
| `pendencias` | lista de texto | O que falta quando `importavel=false`. Cinco textos fixos — ver abaixo |

### As cinco pendências

`pendencias` só contém estes textos, sem repetição:

1. `cliente sem código do ERP`
2. `cliente sem representante vinculado no ERP`
3. `pedido sem tabela de preço vinculada no ERP`
4. `item sem vínculo de produto/tamanho com o ERP`
5. `pedido sem itens`

`importavel` é `true` exatamente quando a lista está vazia. Recomendação:
importar apenas os `importavel: true` e reportar os demais, para o cadastro ser
corrigido na origem.

### Campos do item

| Campo | Tipo | Descrição |
|---|---|---|
| `produto` | texto | **Referência do produto no seu ERP** (campo PRODUTO) |
| `tamanho` | texto | Tamanho (P, M, G, GG, EG, numeração...) |
| `cor` | texto | **Sempre `"00001"`** (cores sortidas). A cor escolhida vai em `observacao` |
| `quantidade` | inteiro | Quantidade de peças |
| `preco_unitario` | número | Preço unitário de tabela, **sem** o desconto |
| `valor_total` | número | Total do item (quantidade × preço de tabela) |
| `observacao` | texto ou null | **A(s) cor(es) que o cliente escolheu** para a referência (ex.: `"azul"`, `"3M azul / 2G rosa"`). `null` = sortido de verdade. É o mesmo texto da coluna OBSERVAÇÃO da planilha |

**Sobre a cor:** a operação é por *cores sortidas* — o item vai agregado por
(produto × tamanho) e a coluna COR recebe **sempre** `"00001"`. Quando o cliente
escolhe cor nas bolinhas do catálogo, a escolha **não muda o produto**: ela
viaja em `observacao`, no texto que a separação lê. Nesta versão não existe
código de cor real em `cor`; venda por cor com grade própria no ERP não faz
parte do contrato v1 — se um dia entrar, será combinado antes e chegará como
campo novo, sem mudar o que já existe.

**Campos que dependem de recurso do banco:** `numero`, `condicao_pagamento`,
`desconto_percentual`, `faturado`, `faturado_em`, `valor_faturado`, os pedaços
de `cliente.endereco` e `cliente.inscricao_estadual` dependem de recursos que
podem ainda não estar ativos numa instalação. Quando não estão, saem `null`
(`0` no desconto, `false` no faturado) — a resposta nunca quebra por isso.

---

## 3. Confirmar importação

Depois de gravar o pedido no ERP, confirme informando o número gerado:

```
POST /partner/v1/pedidos/{id}/confirmar
Content-Type: application/json

{ "pedido_erp": "CS17379" }
```

`pedido_erp` é normalizado (ver "O número do pedido no ERP") e é a forma
normalizada que fica gravada. A confirmação grava a situação `sent_erp`, o
número, `synced_at` e `updated_at`. O contrato desta rota não mudou na fase 0.

| Resposta | `code` | Significado | O que fazer |
|---|---|---|---|
| `200 {"ok":true,"ja_confirmado":false}` | — | Confirmado agora — sai da fila | Seguir para o próximo |
| `200 {"ok":true,"ja_confirmado":true}` | — | Já estava confirmado com esse mesmo número. Nada é regravado | Nada — repetição é segura |
| `400` | `MISSING_PEDIDO_ERP` | Falta `pedido_erp` (ausente, não é texto ou vazio) | Corrigir a chamada |
| `400` | `INVALID_PEDIDO_ERP` | Número fora do formato: duas letras e até 10 dígitos | Corrigir o número |
| `404` | `ORDER_NOT_FOUND` | Não existe pedido com esse `id` na sua empresa (inclusive `id` fora do formato UUID — cortado ou digitado errado) | Registrar e avisar o suporte |
| `409` | `ORDER_ALREADY_CONFIRMED` | Já confirmado com **outro** número; a resposta traz `pedido_erp_atual` (grafia gravada) | Investigar: sinal de importação duplicada do seu lado |
| `409` | `ORDER_NOT_APPROVED` | O pedido não está numa situação que aceite confirmação (só pedido aprovado — ou marcado com erro de envio ao ERP — pode ser confirmado); a resposta traz a `situacao` atual | Não importar — esse pedido não estava na fila. Registrar |
| `409` | `ERP_NUMBER_IN_USE` | Esse número já está gravado em **outro** pedido; a resposta traz `pedido_em_uso` — `{ id, numero }`, ou `null` (o objeto inteiro) quando o outro pedido não pôde ser lido no momento. `numero` é o número do outro pedido no aplicativo e vem `null` se o banco ainda não tiver essa coluna. Teste `pedido_em_uso` antes de ler `.id`/`.numero` | Conferir a numeração do seu lado |
| `409` | `CANAL_FECHADO` | Canal de pedidos não ligado para a API na sua empresa | Combinar com o Yan |
| `500` | `INTERNAL_ERROR` | Falha ao ler ou gravar. Não significa que o pedido não existe | Não trate como confirmado nem como inexistente: tente de novo na próxima rodada |

As checagens correm nesta ordem: campo presente → formato → pedido existe → já
tem número (o mesmo = 200, outro = 409) → situação aceita confirmação → número
livre → gravação. Duas confirmações ao mesmo tempo não passam: a segunda recebe
`ja_confirmado: true` (mesmo número) ou `409 ORDER_ALREADY_CONFIRMED`.

**Formato de toda resposta de erro** (nesta e nas outras rotas):

```json
{
  "error": "Número do Control já usado pelo pedido 10240",
  "code": "ERP_NUMBER_IN_USE",
  "statusCode": 409,
  "pedido_em_uso": { "id": "a1b2c3…", "numero": 10240 }
}
```

Decida pelo `code` e pelo status HTTP, não pela mensagem: o texto de `error` é
informativo e pode mudar.

---

## 3b. Conciliar o passivo (pedido enviado sem número)

Antes da integração, parte dos pedidos foi lançada no ERP à mão e marcada como
"enviado ao ERP" no aplicativo **sem o número**. Esses pedidos estão com
situação `sent_erp` e `pedido_erp` nulo: não voltam para a fila e o faturamento
não os acha. Esta rota dá a eles o número que o seu ERP já tem:

```
POST /partner/v1/pedidos/{id}/conciliar
Content-Type: application/json

{ "pedido_erp": "PL02672" }
```

O número é normalizado como na confirmação. A situação do pedido **não muda**
(continua `sent_erp`); só o número é gravado. Exige o canal de pedidos ligado
para a API.

| Resposta | `code` | Significado |
|---|---|---|
| `200 {"ok":true,"ja_conciliado":false}` | — | Número gravado agora |
| `200 {"ok":true,"ja_conciliado":true}` | — | O pedido já tinha esse mesmo número. Nada é regravado |
| `400` | `MISSING_PEDIDO_ERP` / `INVALID_PEDIDO_ERP` | Como na confirmação |
| `404` | `ORDER_NOT_FOUND` | Não existe pedido com esse `id` na sua empresa |
| `409` | `ORDER_ALREADY_CONFIRMED` | O pedido já tem **outro** número (`pedido_erp_atual`) |
| `409` | `ORDER_NOT_RECONCILABLE` | O pedido não é `sent_erp`; a resposta traz a `situacao`. Só pedido enviado ao ERP sem número é conciliado — pedido aprovado usa o `/confirmar` |
| `409` | `ERP_NUMBER_IN_USE` | O número já está em outro pedido (`pedido_em_uso`) |
| `409` | `CANAL_FECHADO` | Canal de pedidos não ligado para a API |
| `500` | `INTERNAL_ERROR` | Falha ao ler ou gravar — tente de novo |

Ordem das checagens: campo presente → formato → pedido existe → já tem número
(o mesmo = 200, outro = 409) → situação `sent_erp` → número livre → gravação
(só se ninguém gravou no meio e o pedido continua `sent_erp`).

## 3c. Conferir a conciliação (só contagens)

```
GET /partner/v1/conciliacao
```

Não devolve pedido nenhum, só quantos há em cada grupo da sua empresa:

```json
{
  "fila_aprovados_sem_numero_nao_faturados": 12,
  "enviados_sem_numero_nao_faturados": 42,
  "enviados_sem_numero_faturados": 7,
  "aprovados_faturados_sem_numero": 3,
  "enviados_com_numero_sem_faturamento": 18,
  "servidor_hora": "2026-09-15T13:00:00.000Z"
}
```

| Campo | O que conta |
|---|---|
| `fila_aprovados_sem_numero_nao_faturados` | A fila do `GET /pedidos` |
| `enviados_sem_numero_nao_faturados` | O passivo que o `/conciliar` resolve |
| `enviados_sem_numero_faturados` | O mesmo passivo, já faturado à mão |
| `aprovados_faturados_sem_numero` | Faturado à mão sem nunca ter ido ao ERP pelo app — não importe |
| `enviados_com_numero_sem_faturamento` | No ERP, esperando o faturamento chegar |

Funciona com qualquer canal. Erro em qualquer contagem responde `500`.

## 3d. Pedidos excluídos que já tinham número

```
GET /partner/v1/pedidos/excluidos
GET /partner/v1/pedidos/excluidos?desde=2026-09-15T00:00:00-03:00
```

Pedido com número do ERP não pode mais ser excluído no aplicativo; esta lista
traz os que foram excluídos **antes** dessa trava, para o seu ERP cancelar do
lado dele. `desde` é opcional e, quando vem, precisa de fuso (`Z` ou `-03:00`) —
sem fuso responde `400 INVALID_DESDE`. Fuso positivo vai na URL como `%2B`
(`+03:00` → `%2B03:00`). A lista vem inteira, do mais antigo para o mais novo.

```json
{
  "total": 1,
  "servidor_hora": "2026-09-15T13:00:00.000Z",
  "excluidos": [
    { "id": "d31b5083-…", "numero": 10231, "pedido_erp": "CS17379", "excluido_em": "2026-09-10T18:22:01+00:00" }
  ]
}
```

Só id, número no app, número no ERP e o momento — nunca o pedido, o cliente ou
quem excluiu. Funciona com qualquer canal.

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
    {
      "pedido_erp": "CS17379",
      "faturado_em": "2026-08-13T14:02:00-03:00",
      "valor_faturado": 870.50,
      "nota": { "numero": "12345", "serie": "1", "emitida_em": "2026-08-13T14:02:00-03:00", "valor": 870.50 },
      "itens": [
        { "produto": "REF100", "tamanho": "G", "quantidade": 3, "preco_unitario": 42.90 },
        { "produto": "REF100", "tamanho": "GG", "quantidade": 2, "preco_unitario": 55.00 }
      ]
    },
    { "pedido_erp": "CS17380" }
  ]
}
```

O corpo pode vir como `{ "faturamento": [...] }`, `{ "dados": [...] }` ou a
lista pura. Máximo de 1000 pedidos por requisição (`400 BATCH_TOO_LARGE`);
corpo fora do formato → `400 INVALID_BODY`. Exige o canal de faturamento ligado
para a API (`409 CANAL_FECHADO`).

**Regra de ouro: campo que não veio não mexe; `null` explícito limpa.** Reenviar
é seguro — o que chega igual ao que está gravado não grava nada e conta em
`inalterados`.

| Campo | Obrigatório | Significado |
|---|---|---|
| `pedido_erp` | sim¹ | O número do pedido no seu ERP (o mesmo do passo 3), **em qualquer grafia** — `cs-17379` acha `CS17379` |
| `id` | sim¹ | Alternativa ao `pedido_erp`: o id que veio na fila |
| `faturado` | não | `false` (o booleano) desfaz um faturamento informado antes: **limpa a data e o valor** e cancela as notas ativas do pedido. Ausente = `true`. Só o booleano `false` desfaz — o texto `"false"` conta como `true` |
| `faturado_em` | não | Momento da emissão, **com fuso** (`Z` ou `-03:00`). Sem fuso o registro é ignorado. Ausente (ou `null`) = mantém a data de quem já estava faturado; quem ainda não estava fica faturado agora |
| `valor_faturado` | não | O valor que a nota fechou, maior que zero. **Ausente = mantém o que está gravado**; `null` limpa (o painel volta a usar o valor do pedido) |
| `nota` | não | `{ numero, serie?, chave?, emitida_em?, valor? }` — a nota fiscal. `numero` é obrigatório quando `nota` vem; `serie` ausente vale `""` (número e série identificam a nota dentro do pedido); `emitida_em` com fuso; `valor` maior que zero. Em `chave`, `emitida_em` e `valor` vale a regra de ouro |
| `itens` | não | `[{ produto, tamanho, quantidade, preco_unitario? }]` — as peças que **essa nota** levou. Só com `nota`. Quando vem, **substitui** as peças daquela nota (as de outras notas do pedido ficam); `[]` apaga as peças daquela nota; ausente não mexe nelas. `quantidade` inteira maior que zero; `preco_unitario` maior ou igual a zero |

¹ Informe **um** dos dois. `pedido_erp` é o preferido. A busca é sempre dentro
da sua empresa: um parceiro nunca fatura pedido de outra fábrica. `id` fora do
formato UUID dá `pedido não encontrado nesta empresa`.

Só pedido **aprovado ou enviado ao ERP** (`approved` ou `sent_erp`) é faturado.
Pedido com mais de uma nota: mande um registro por nota, com o mesmo
`pedido_erp`. `produto` é o mesmo código que o `GET /pedidos` manda; a peça que
não casar com o catálogo é guardada assim mesmo, com aviso. Nota cancelada que
chega de novo (mesmo número e série) volta a valer.

**Sobre o `valor_faturado`:** é normal ele ser menor que o total do pedido — o
que faltou no estoque não é faturado. Mandando esse campo, a fábrica passa a ver
o número real em vez do valor pedido. Zero ou negativo é recusado: nota
cancelada se diz com `"faturado": false`, não com valor zerado.

**Resposta 200:**

```json
{
  "ok": true,
  "recebidos": 2,
  "atualizados": 1,
  "inalterados": 0,
  "ignorados": [
    { "pedido": "CS17380", "motivo": "pedido não encontrado nesta empresa" }
  ],
  "avisos": [
    { "pedido": "CS17379", "aviso": "peça REF100 tamanho GG sem variante no catálogo: guardada sem vínculo" }
  ],
  "servidor_hora": "2026-08-13T14:02:10.114Z"
}
```

`atualizados` conta os registros em que algo foi gravado (pedido, nota ou
peças); `inalterados`, os que chegaram iguais ao gravado (o mesmo lote mandado
de novo responde `atualizados: 0`, `inalterados: 1`). `ignorados` traz
`{ pedido, motivo }` — e `situacao`, quando o motivo é a situação do pedido;
`avisos` traz `{ pedido, aviso }`. Um registro com problema não derruba o lote:
ele volta em `ignorados` com o motivo, e o resto grava. Registro com `nota` ou
`itens` malformados é recusado **inteiro** (nada dele é gravado), para ser
corrigido e reenviado junto.

Ordem das checagens em cada registro: identificação → pedido existe → situação
→ `faturado_em` → `valor_faturado` → `nota` → `itens` → gravação.

| Motivo | Quando |
|---|---|
| `informe "pedido_erp" ou "id"` | O registro veio sem os dois |
| `falha ao buscar: …` | Erro ao procurar o pedido, a nota ou as peças. Reenvie na próxima rodada |
| `pedido não encontrado nesta empresa` | Nenhum pedido da sua empresa com esse número ou id |
| `pedido não está aprovado nem enviado ao ERP` | A situação do pedido não aceita faturamento; o ignorado traz `situacao` |
| `"faturado_em" não é uma data ISO` | Data fora do padrão |
| `"faturado_em" precisa de fuso (Z ou -03:00)` | Data e hora sem fuso, ou só a data |
| `"valor_faturado" precisa ser maior que zero` | Zero ou negativo |
| `"nota" precisa ser um objeto com "numero"` | `nota` não é objeto |
| `"nota.numero" é obrigatório quando "nota" vem` | Nota sem número |
| `"nota.chave" precisa ser um texto` | Chave que não é texto |
| `"nota.emitida_em" não é uma data ISO` / `"nota.emitida_em" precisa de fuso (Z ou -03:00)` | Emissão fora do padrão ou sem fuso |
| `"nota.valor" precisa ser maior que zero` | Valor da nota zero ou negativo |
| `"itens" precisa vir junto com "nota" (informe "nota.numero")` | Peças sem a nota |
| `"itens" precisa ser uma lista` | `itens` não é lista |
| `"itens[i]" precisa de "produto", "tamanho" e "quantidade" inteira maior que zero` | Peça incompleta (`i` é a posição, a partir de 0) |
| `"itens[i].preco_unitario" precisa ser um número maior ou igual a zero` | Preço inválido |
| `falha ao gravar: …` / `falha ao gravar a nota: …` / `falha ao gravar as peças da nota: …` | Erro ao gravar. Reenvie na próxima rodada |

Os `avisos` possíveis: `peça <produto> tamanho <tamanho> sem variante no
catálogo: guardada sem vínculo`; `notas e itens faturados ficam guardados
depois da migração 048` (a instalação ainda não guarda notas — o faturamento
grava, a nota e as peças não); e `nota e itens ignorados: "faturado": false
cancela as notas do pedido`.

Na passagem para faturado, o aplicativo também avança a "última compra" do
cliente (pelo dia em Brasília, nunca para trás) e avisa o representante.
Desfazer não recua a última compra.

---

## Códigos de erro (todas as rotas)

Toda resposta de erro tem o formato `{ "error": "<mensagem>", "code":
"<CODIGO>", "statusCode": <n> }`, mais campos extras quando indicado.

| HTTP | `code` | Onde | Quando |
|---|---|---|---|
| `503` | `PARTNER_API_DISABLED` | todas | A integração ainda não foi liberada naquele servidor (nenhuma chave configurada) |
| `401` | `PARTNER_UNAUTHORIZED` | todas | Chave ausente ou errada no `X-API-Key` — inclusive a chave de uma marca na URL da outra |
| `409` | `CANAL_FECHADO` | pedidos, confirmar, conciliar, faturamento, clientes, representantes | O canal da sua empresa não está ligado para a API (`canal`, `valor_atual`) — ver "Canal por empresa" |
| `400` | `INVALID_DESDE` | `GET /pedidos`, `GET /pedidos/excluidos` | `desde` não é uma data ISO (nos excluídos, também sem fuso) |
| `400` | `MISSING_PEDIDO_ERP` | `POST /confirmar`, `POST /conciliar` | Corpo sem `pedido_erp`, ou `pedido_erp` vazio / que não é texto (o corpo vazio é o caso de `INTERNAL_ERROR` 400, abaixo) |
| `400` | `INVALID_PEDIDO_ERP` | `POST /confirmar`, `POST /conciliar` | Número fora do formato (duas letras e até 10 dígitos) |
| `404` | `ORDER_NOT_FOUND` | `POST /confirmar`, `POST /conciliar` | Não há pedido com esse `id` na sua empresa (inclusive `id` fora do formato UUID) |
| `409` | `ORDER_ALREADY_CONFIRMED` | `POST /confirmar`, `POST /conciliar` | Já tem outro número (`pedido_erp_atual`) |
| `409` | `ORDER_NOT_APPROVED` | `POST /confirmar` | A situação do pedido não aceita confirmação (`situacao`) |
| `409` | `ORDER_NOT_RECONCILABLE` | `POST /conciliar` | Só pedido `sent_erp` sem número é conciliado (`situacao`) |
| `409` | `ERP_NUMBER_IN_USE` | `POST /confirmar`, `POST /conciliar` | Número já gravado em outro pedido (`pedido_em_uso`) |
| `400` | `INVALID_BODY` | `POST` de lista | O corpo não é uma lista nem `{ "faturamento" / "clientes" / "representantes": [...] }` (ou `{ "dados": [...] }`) |
| `400` | `BATCH_TOO_LARGE` | `POST` de lista | Mais de 1000 registros numa requisição |
| `400` | `INTERNAL_ERROR` | todas | Corpo JSON vazio ou malformado com `Content-Type: application/json` — o `statusCode` diz 400. Corrija a chamada, não reenvie |
| `413` | `INTERNAL_ERROR` | todas | Corpo acima de 1 MB — o `statusCode` diz 413; divida o lote |
| `429` | `INTERNAL_ERROR` | todas | Mais de 300 requisições por minuto do mesmo IP; espere um minuto |
| `500` | `INTERNAL_ERROR` | todas | Falha interna (banco, rede) |

**Qualquer 5xx: não confirme, não conclua que o pedido sumiu; tente de novo na
próxima rodada.** Qualquer 4xx é erro da chamada — repetir igual dá o mesmo
resultado; corrija ou registre. A exceção é o `409 CANAL_FECHADO`, que muda
quando o canal é ligado. Decida pelo `code` e pelo status HTTP — a mensagem em
`error` é informativa.

---

## Exemplo completo (linha de comando)

```bash
# Corpo Sensual; na PLUMENE: BASE=https://csbapi-production.up.railway.app (e a chave da PLUMENE)
BASE=https://setorxweb-production.up.railway.app

# testar a chave e ver os canais
curl -H "X-API-Key: SUA_CHAVE" "$BASE/partner/v1/status"

# fila de pedidos
curl -H "X-API-Key: SUA_CHAVE" "$BASE/partner/v1/pedidos"

# confirmar
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"pedido_erp\":\"CS17379\"}" \
  "$BASE/partner/v1/pedidos/ID_DO_PEDIDO/confirmar"

# informar o faturamento
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"faturamento\":[{\"pedido_erp\":\"CS17379\",\"faturado_em\":\"2026-08-13T14:02:00-03:00\",\"valor_faturado\":870.50}]}" \
  "$BASE/partner/v1/faturamento"
```

## Boas práticas

- Consulte a fila a cada 1–5 minutos (a chamada é leve).
- Grave o pedido no ERP **antes** de confirmar. Se a gravação falhar, não
  confirme — o pedido continua na fila para a próxima tentativa.
- Trate `409` como alerta: `ORDER_ALREADY_CONFIRMED` e `ERP_NUMBER_IN_USE` são
  sinal de numeração ou importação duplicada do seu lado; `ORDER_NOT_APPROVED`
  é pedido que não estava na fila. `CANAL_FECHADO` não é defeito: a rota ainda
  não foi ligada para a sua empresa.
- Mande as datas **com fuso** (`Z` ou `-03:00`): sem ele, o mesmo texto é uma
  hora no servidor e outra no ERP.
- `5xx` não é resposta: tente de novo na próxima rodada, sem marcar nada.
- Uma rotina por marca, cada uma com a sua URL e a sua chave.
- A chave de API é secreta — não coloque em código-fonte compartilhado.

## Antes de emitir a chave (lado do app — não é tarefa do parceiro)

Checagem do responsável pelo sistema, por instalação (Corpo Sensual e PLUMENE),
antes de configurar `PARTNER_API_KEYS` (uma chave diferente em cada serviço):

- Conferir no Railway (serviço → Variables → `SUPABASE_URL`) e no Vercel que
  `setorxweb-production` é a Corpo Sensual e `csbapi-production` é a PLUMENE,
  como diz a tabela de URLs.
- O índice único do número do ERP (migração 042) precisa estar no banco: é ele
  que garante o `409 ERP_NUMBER_IN_USE` quando duas confirmações chegam ao
  mesmo tempo. Sem ele, só a pré-checagem protege — dois pedidos podem ficar
  com o mesmo número. Em 15/09/2026 ele existia na PLUMENE e **faltava na
  Corpo Sensual**: rodar a consulta de repetidos do cabeçalho de
  `_tools/SQL-PARA-RODAR-013-042-NA-CS.sql` (deve vir vazia) e colar o arquivo,
  só na Corpo Sensual.
- As migrações 046 (`order_erp_sync`) e 047 já estão visíveis nos dois bancos
  desde 15/09/2026 (`node _tools/conferir-046-047.mjs`).
- A migração 048 (canais, registro das chamadas, rastro do pedido, notas e
  peças) precisa estar nos dois bancos: rodar as duas consultas do cabeçalho de
  `_tools/SQL-PARA-RODAR-048.sql`, colar o arquivo e conferir com
  `node _tools/conferir-048.mjs` (e `node _tools/conferir-048.mjs <raiz da PLUMENE>`).
  Sem ela, todos os canais valem o padrão — **a API fica fechada**
  (`409 CANAL_FECHADO`) e as notas não são guardadas.
- Virar o canal é um `UPDATE companies SET canal_… = 'api'` por empresa, feito
  quando a fábrica parar de lançar à mão o mesmo dado.

---

# Cadastros — o ERP ALIMENTA o app (v1)

A mão inversa dos pedidos: aqui o **seu ERP envia** clientes e representantes
atualizados, e o app grava. Você lê do seu banco e faz `POST`; o app nunca toca
no seu sistema. Mesma chave `X-API-Key`, mesma URL base da marca.

**Fluxo recomendado:** a cada ~10 minutos, envie os clientes e os representantes
(em lotes de até 500). Clientes: upsert por **código do ERP** — quem já existe é
atualizado, quem não existe é criado. Representantes: só atualização de quem já
tem login (ver abaixo). Nada é apagado. As duas rotas exigem o canal de cadastro
ligado para a API (`409 CANAL_FECHADO`).

## Regras gerais

- **Campo que não veio não mexe; `null` explícito limpa.** Texto vazio (`""` ou
  só espaços) conta como não veio. Pode mandar só o que mudou dentro do
  registro — mas `codigo` e `razao_social` (ou `nome`, no representante) vêm
  sempre.
- **Sem mudança, nada é gravado:** o registro que chega igual ao cadastro conta
  em `sem_mudanca`. Reenviar o mesmo lote é inofensivo.
- **Tolerante:** só é recusado o que não dá para usar (sem código, sem nome,
  código repetido). A resposta lista o que foi ignorado e por quê; o resto grava.
- **Casamento pelo miolo do código:** `#2225`, `2225` e `02225` são o mesmo
  cadastro. Dois registros do mesmo lote com o mesmo miolo: vale o primeiro, o
  segundo volta em `ignorados` (`código repetido no lote`).
- **Máximo 1000 por requisição** (recomendado 500). Acima de 1000 →
  `400 BATCH_TOO_LARGE`. Divida em lotes.
- **Datas e números** no padrão JSON. CNPJ/telefone podem vir com ou sem
  pontuação.
- **Desativar** um cliente é mandar `bloqueado: "S"` (ou `ativo: "N"` no rep). O
  app **nunca apaga** — cliente tem histórico de pedidos preso a ele.
- **Leitura antes de gravar:** o que já existe é lido antes da primeira
  gravação; se essa leitura falhar, a resposta é `500 INTERNAL_ERROR` e **nada
  foi gravado**.
- **Falha ao gravar um registro:** nos clientes, não derruba o lote — o registro
  volta em `ignorados` com `falha ao gravar: …` e o resto segue. Nos
  representantes, só a recusa do banco por valor repetido ou fora do formato
  vira `ignorados`; outra falha de gravação responde `500` e parte do lote pode
  já ter sido gravada. Nos dois casos reenviar é seguro: o que já gravou volta
  como `sem_mudanca`.
- **`avisos` é uma lista de textos** (nos cadastros), um por assunto, com os
  códigos envolvidos.

## POST /partner/v1/clientes

Corpo: `{ "clientes": [ ... ] }`, `{ "dados": [ ... ] }` ou a lista pura.

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do cliente no ERP. A chave do upsert, casada pelo miolo. Cliente novo é gravado com 5 dígitos (`900` → `00900`); o código de quem já existe nunca é reescrito |
| `razao_social` | texto | **Sim** | Sem ela o registro volta em `ignorados` |
| `nome_fantasia` | texto | Não | — |
| `cnpj_cpf` | texto | Recomendado | 11 (CPF) ou 14 (CNPJ) dígitos, com ou sem pontuação. Um cliente que já existia no app **sem código** e com esse CNPJ é *adotado*: recebe o código e não vira cadastro duplicado |
| `representante` | texto | **Sim, na prática** | Código do rep no ERP, gravado com 5 dígitos (`779` → `00779`). Fica no cliente, sai no pedido como `representante_erp` e é o que faz o cliente aparecer para o representante que tem esse código no login do app. `null` tira o cliente da carteira |
| `tabela_preco` | texto | Recomendado | Código da tabela no ERP, casado pelo miolo. Código que não casa com nenhuma tabela **não mexe** na tabela do cliente e volta em `avisos`; `null` limpa |
| `endereco` | objeto ou texto | Recomendado | `{ logradouro, numero, complemento, bairro, cidade, uf, cep }` ou um texto pronto. Em objeto, cada pedaço que veio é guardado no seu campo (onde a instalação já tem os campos; `cep` só com dígitos, `uf` em maiúscula) e a linha de texto é remontada com o que ficou; pedaço ausente não mexe, `null` limpa aquele pedaço. Onde a instalação ainda não tem esses campos, só a linha é gravada, montada com o que veio (e volta um aviso). Em texto, só a linha. `endereco: null` limpa o endereço inteiro |
| `inscricao_estadual` | texto | Não | Guardada onde a instalação já tem o campo (senão, aviso). `null` limpa |
| `observacoes` | texto | Não | Idem |
| `bloqueado` | `"S"`/`"N"` | Não | `S`, `SIM`, `1` ou `true` bloqueia; `N`, `NÃO`, `0` ou `false` desbloqueia; `null` desbloqueia; ausente não mexe; outro valor não mexe e dá aviso |
| `limite_credito` | número ou texto | Não | `1500.5` ou `"1.500,50"`. `null` limpa; negativo ou ilegível não mexe e dá aviso |
| `whatsapp` | texto | Não | Com DDD. `null` limpa |
| `email` | texto | Não | `null` limpa |

**Nota da tabela de preço:** o vínculo é pelo **código** do ERP. Tabela no app
sem esse código não casa com nada — o cliente fica com a tabela que tinha, e a
resposta avisa quais códigos não foram encontrados. Para o vínculo funcionar, o
código do ERP de cada tabela precisa ser preenchido no app (uma vez).

**Exemplo:**

```json
POST /partner/v1/clientes
X-API-Key: SUA_CHAVE
Content-Type: application/json

{
  "clientes": [
    {
      "codigo": "01234",
      "razao_social": "CLIENTE TESTE LTDA",
      "nome_fantasia": "Loja Teste",
      "cnpj_cpf": "00.000.000/0001-00",
      "representante": "00042",
      "tabela_preco": "00007",
      "endereco": {
        "logradouro": "Rua Teste", "numero": "100",
        "bairro": "Centro", "cidade": "Cidade Teste", "uf": "MG",
        "cep": "00000-000"
      },
      "inscricao_estadual": null,
      "bloqueado": "N",
      "whatsapp": "00900000000"
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
  "sem_mudanca": 0,
  "ignorados": [],
  "avisos": [],
  "servidor_hora": "2026-08-11T20:13:15.006Z"
}
```

`ignorados` traz `{ "codigo": "...", "motivo": "..." }` para cada registro
recusado: `registro inválido` (não é objeto), `sem código do ERP`,
`sem razão social`, `código repetido no lote`, `código com mais de um cadastro
no app` ou `falha ao gravar: …`. `avisos` traz, em texto, o que passou mas
merece conferência: tabelas de preço não encontradas (ou nenhuma tabela com
código do ERP, ou código usado por mais de uma tabela), clientes casados pelo
CNPJ, código de representante sem login no app ou gravado numa grafia diferente
da do login, valores de `bloqueado` ou `limite_credito` não entendidos e campos
que a instalação ainda não guarda.

## POST /partner/v1/representantes

Corpo: `{ "representantes": [ ... ] }`, `{ "dados": [ ... ] }` ou a lista pura.

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do rep no ERP. Casa pelo miolo com o código atribuído ao login no app (`0779`, `779` e `00779` são o mesmo), dentro da sua empresa |
| `nome` | texto | **Sim** | Sem ele o registro volta em `ignorados` |
| `razao_social` | texto | Não | Gravada na razão social do representante. `null` limpa |
| `email` | texto | Não | **Não é gravado: o e-mail do Control não troca o login do representante.** O e-mail é o login do app e só muda pelas telas. Quando difere do login, volta o aviso `e-mail do Control não troca o login do representante` |
| `ativo` | `"S"`/`"N"` | Não | Ou `true`/`false`. Só esses quatro mexem no acesso; ausente, vazio (`""`) ou `null` não mexem; outro valor não mexe e dá aviso |

**Importante — login não nasce por aqui.** Este endpoint **só atualiza** nome,
razão social e ativo dos representantes que já têm login no app **com o seu
código**. Um rep que existe no ERP mas ainda não tem acesso no app **não é
criado** — ele volta na resposta em `novos`, para o administrador criar o acesso
e atribuir o código na tela de Representantes (conta precisa de senha, e senha
não nasce de um POST). `criados` é sempre `0`.

Esta rota **não vincula a carteira**: quem liga cliente a representante é o
código que vem em cada cliente (`representante`, no `POST /clientes`) contra o
código atribuído ao login do representante no app.

**Resposta 200** (além dos campos comuns, `sem_mudanca` inclusive): `"novos":
[ { "codigo": "...", "nome": "..." } ]`. Quando há `novos`, `avisos` lembra de
criar o acesso deles. Motivos de `ignorados`: `registro inválido`, `sem código
do ERP`, `sem nome`, `código repetido no lote`, `código repetido no app (dois
logins com o mesmo código)` e `falha ao gravar: …`.

## Erros

Os códigos de todas as rotas estão na tabela **Códigos de erro** acima. Para os
cadastros valem `400 INVALID_BODY`, `400 BATCH_TOO_LARGE`, `401`, `503`,
`409 CANAL_FECHADO` e o `500 INTERNAL_ERROR` (falha ao ler o que já existe —
nada gravado; ou, nos representantes, falha de gravação que não é recusa do
banco).

## Boas práticas (cadastros)

- Envie a cada ~10 min. Não precisa mandar todos os clientes sempre — mandar só
  os que mudaram (por `DATA_UPDATE`) deixa o lote pequeno. Campo que você não
  mandar fica como está; para limpar, mande `null`.
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
| Código do representante | **ERP** | Chega em cada cliente (`representante`), mostra o cliente ao rep com o mesmo código no login e sai no pedido como `representante_erp`. `POST /representantes` só atualiza nome, razão social e ativo de quem já tem login **e** já tem esse código gravado no app |
| Tabela de preço (código e coluna) | **ERP** | O app guarda o vínculo no cliente e, em cada pedido, a tabela que o precificou; o pedido sai com a tabela dele |
| Condição de pagamento (código) | **ERP** | O app tem as condições do Control cadastradas; rep e loja só escolhem |
| Referência do produto | **ERP** | O app vende só o que está no catálogo da coleção |
| Pedido (itens, desconto, condição, observações) | **App** | O ERP importa via `GET /pedidos` |
| **Número do pedido no ERP** (ex.: CS17379) | **ERP** | Nasce na importação e volta pelo `POST /confirmar` (ou `POST /conciliar`, no passivo) — o app nunca inventa esse número |
| Faturamento (nota, valor, data, peças) | **ERP** | Volta pelo `POST /faturamento`; o app carimba sozinho e guarda a nota e as peças que ela levou |

## Cliente

O que o app guarda de cada cliente (alimentado pelo ERP via `POST /clientes`):

| Dado | Campo no envio | Para que serve |
|---|---|---|
| Código no ERP | `codigo` | A identidade do cliente na integração — chave do upsert e o que sai no pedido como `cliente.codigo_erp` |
| Razão social | `razao_social` | Nome oficial, sai nas telas e na conferência do pedido |
| Nome fantasia | `nome_fantasia` | O nome que o representante procura |
| CNPJ/CPF | `cnpj_cpf` | Conferência e casamento de cadastro (as cargas casam por CNPJ; cliente sem código é adotado por ele) |
| Representante dono | `representante` | Código do rep no ERP — define de quem é a carteira |
| Tabela de preço | `tabela_preco` | Código da tabela no ERP; sem ela o cliente usa a tabela do representante |
| Endereço | `endereco` | Entrega e cadastro — os pedaços e a linha de texto; sai no pedido em `cliente.endereco` |
| Inscrição estadual / observações | `inscricao_estadual`, `observacoes` | Cadastro; a inscrição sai no pedido em `cliente.inscricao_estadual` |
| Bloqueado | `bloqueado` | `"S"` = não fecha pedido no app |
| Limite de crédito | `limite_credito` | Informativo |
| WhatsApp / e-mail | `whatsapp`, `email` | Contato e o botão "Enviar pedido para o cliente"; saem no pedido em `cliente.whatsapp` e `cliente.email` |

## Representante

| Dado | Campo no envio | Para que serve |
|---|---|---|
| Código no ERP | `codigo` | Casa com o código atribuído ao login; é por ele que os clientes aparecem para o rep e que o pedido sai com `representante_erp` |
| Nome | `nome` | Telas e planilha |
| Razão social | `razao_social` | Cadastro do representante |
| E-mail | `email` | Não é gravado — o login só muda pelas telas do app |
| Ativo | `ativo` | `"N"` desativa o acesso |

O app ainda tem dados **internos** do rep que o ERP não precisa conhecer:
login/senha, teclas de permissão e o interruptor de *venda interna* (pedido de
balcão que nasce aprovado — para o ERP é um pedido igual aos outros).

## Tabela de preço

| Dado | Onde vive | Observação |
|---|---|---|
| Código no ERP | `tabela_preco.codigo_erp` | Precisa estar preenchido no app (uma vez) para o vínculo funcionar |
| Coluna (1–6) | `tabela_preco.coluna` | A coluna de preço gravada na tabela que o pedido usou |
| T1/T2/T3 | interno do app | Os nomes das tabelas no catálogo; o ERP só vê código + coluna |

O pedido sai com a tabela que **o precificou** (gravada no pedido quando ele foi
montado). Pedido antigo, sem tabela gravada, sai com a tabela do cadastro do
cliente no momento da consulta. A coluna é sempre a da tabela.

## Condição de pagamento

| Dado | Onde aparece | Observação |
|---|---|---|
| Código | `condicao_pagamento.codigo` | O código do Control, como **número inteiro** (ex.: `21`) |
| Descrição | `condicao_pagamento.descricao` | Ex.: `"30/60/90"` — para conferência humana; é o texto que a planilha põe na C8 |

As condições do Control estão cadastradas no app; representante e loja
escolhem uma ao fechar o pedido. Condição nova no ERP precisa ser cadastrada no
app (hoje por carga; no futuro pode virar um `POST /condicoes` — a combinar).
Pedido sem condição sai com `condicao_pagamento: null`, sem pendência.

## Pedido

| Dado | Campo | Dono | Observação |
|---|---|---|---|
| Identificador técnico | `id` | App | UUID — use na confirmação; nunca muda |
| Número no app | `numero` | App | O número que rep e cliente enxergam (ex.: 10231) |
| **Número no ERP** | `pedido_erp` | **ERP** | Ex.: `CS17379`, sempre na forma normalizada. Nasce na importação, volta pela confirmação e aparece no app para todo mundo |
| Situação | `situacao` | App | Ver "Situações do pedido" abaixo |
| Cliente | `cliente.*` | ERP | Código, CNPJ, razão social, fantasia, endereço, inscrição estadual, WhatsApp, e-mail |
| Representante | `representante_erp` | ERP | Código do rep gravado no cliente |
| Tabela de preço | `tabela_preco.*` | ERP | Código + coluna da tabela do pedido (na falta, a do cliente) |
| Condição de pagamento | `condicao_pagamento.*` | ERP (código) | Escolhida no app entre as condições do Control; `null` se não escolhida |
| Desconto | `desconto_percentual` | App | Pontos percentuais (10 = 10%). Preços dos itens SEM desconto; `valor_total` COM. Igual à planilha (AB46) |
| Total | `valor_total` | App | Com o desconto aplicado |
| Observações gerais | `observacoes` | App | Só o que o rep digitou (remessa, boleto, recado) |
| Datas | `criado_em`, `atualizado_em` | App | ISO 8601 |
| Faturamento | `faturado`, `faturado_em`, `valor_faturado` | ERP | O carimbo — ver abaixo |

### Item do pedido

| Dado | Campo | Observação |
|---|---|---|
| Referência | `produto` | A referência que o ERP conhece |
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
| `approved` | Aprovado pelo financeiro, aguardando importação | Importar e confirmar com o número gerado — só se `pedido_erp` for nulo e `faturado` falso (o `approved` faturado à mão, que aparece em `incluir=todos`, não se importa) |
| `sent_erp` | Já enviado ao ERP | Nada — só aparece com `incluir=todos`, e sai com `importavel: true` como qualquer outro. Com `pedido_erp` preenchido, já foi importado; com `pedido_erp` nulo, é o passivo: não importe, use o `POST /conciliar` |

**"Faturado" não é situação — é carimbo.** Um pedido `sent_erp` pode estar
faturado ou não; quem diz é o campo `faturado` (com `faturado_em` e
`valor_faturado`), que o ERP preenche pelo `POST /faturamento`. É de propósito:
o faturamento pode ser desfeito (`"faturado": false`) sem mexer na história do
pedido, e é ele que promove o degrau "Aprovado" na página do cliente e conta
venda no painel da fábrica. Pedido faturado (por esta rota ou à mão) sai da
fila pendente.

## O ciclo completo, dado a dado

```
ERP  → POST /clientes, /representantes     (códigos, carteira, tabela)
rep  → monta o pedido no app               (itens, cores, desconto, condição)
fin. → aceita                              (pedido entra na fila da API)
ERP  → GET /pedidos                        (lê tudo acima)
ERP  → grava e gera o número               (ex.: CS17379)
ERP  → POST /pedidos/{id}/confirmar        (o número volta para o app)
ERP  → fatura e POST /faturamento          (nota, peças, valor, data → carimbo)
app  → página do cliente vira "Aprovado", painel conta a venda
```

---

## Estabilidade da v1

Campos novos são sempre adicionados, nunca renomeados ou removidos dentro da
mesma versão; mudança que exija alteração no programa do parceiro vira
`/partner/v2/`, com a v1 continuando no ar.

**As mudanças de contrato de 15/09/2026 são correção da v1 antes da primeira
chave**, não versão nova: até ali nenhuma chave tinha sido emitida (as duas
APIs respondiam `503 PARTNER_API_DISABLED`) e nenhum programa em produção foi
afetado. Entraram nesse dia:

- na confirmação, as respostas `400 INVALID_PEDIDO_ERP`, `409 ORDER_NOT_APPROVED`
  e `409 ERP_NUMBER_IN_USE`;
- a **fase 0**: o `409 CANAL_FECHADO` por empresa e `canais` no `GET /status`;
  as rotas `/conciliar`, `/conciliacao` e `/pedidos/excluidos`; no pedido, os
  campos novos do cliente (`endereco`, `inscricao_estadual`, `whatsapp`,
  `email`) e a tabela do próprio pedido em `tabela_preco`; no faturamento,
  `faturado_em` com fuso, `valor_faturado` ausente mantendo o gravado, situação
  exigida, `nota`, `itens`, `inalterados` e `avisos`; nos cadastros, campo
  ausente que não apaga, `sem_mudanca`, falha de gravação por registro,
  casamento do representante pelo miolo, `razao_social` gravada e o e-mail do
  representante que não troca o login;
- na documentação, `condicao_pagamento.codigo` descrito como o número inteiro
  que a API sempre mandou (o texto antigo dizia `"021"`), e a tabela de URLs
  por marca.

## Dúvidas / suporte

Falar com Yan (responsável pelo sistema de pedidos).
