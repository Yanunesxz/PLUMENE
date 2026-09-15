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
>
> Atualizado em 15/09/2026 — contrato endurecido antes da primeira chave
> emitida (ver "Estabilidade da v1", no fim).

Integração para o ERP da fábrica **buscar os pedidos** feitos pelos representantes
no aplicativo e gravá-los no próprio sistema. O aplicativo nunca escreve no banco
do ERP — quem grava é o programa da fábrica, usando esta API como fonte.

- **URL base (produção):** `https://setorxweb-production.up.railway.app`
- **Autenticação:** header `X-API-Key: <sua chave>` em todas as chamadas
  (a chave é fornecida pelo responsável do sistema e identifica a sua empresa)
- **Formato:** JSON, UTF-8, datas em ISO 8601 (`2026-07-15T14:30:00Z`)
- **Limites:** corpo de até 1 MB por requisição (acima disso, `413`); 300
  requisições por minuto por IP (acima disso, `429`); 1000 registros por lote
  em todos os `POST` de lista

## Os seis endpoints

| Método e rota | Para quê |
|---|---|
| `GET /partner/v1/status` | Testar a conexão e a chave |
| `GET /partner/v1/pedidos` | Buscar a fila de pedidos aprovados aguardando importação |
| `POST /partner/v1/pedidos/{id}/confirmar` | Confirmar a importação com o número gerado no ERP |
| `POST /partner/v1/faturamento` | Informar o que foi faturado — fecha o ciclo |
| `POST /partner/v1/clientes` | O ERP envia os clientes (cadastro) |
| `POST /partner/v1/representantes` | O ERP envia os representantes (cadastro) |

Quatro chamadas fazem o ciclo do pedido (testar, buscar, confirmar, faturar); as
outras duas mantêm os cadastros e rodam por conta própria, na frequência que o
ERP quiser. Mesma chave, mesma URL base.

## Fluxo recomendado

```
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
estar em dois pedidos (`409 ERP_NUMBER_IN_USE`).

---

## 1. Teste de conexão

```
GET /partner/v1/status
```

**Resposta 200:**
```json
{ "ok": true, "parceiro": "suaempresa", "servidor_hora": "2026-07-15T20:13:15.006Z" }
```

Sem chave ou com chave errada (inclusive quando a sua chave ainda não foi
cadastrada): `401 PARTNER_UNAUTHORIZED`. Integração ainda não liberada no
servidor (nenhuma chave configurada): `503 PARTNER_API_DISABLED`. Vale para as
seis rotas.

---

## 2. Buscar pedidos

```
GET /partner/v1/pedidos
GET /partner/v1/pedidos?desde=2026-07-15T00:00:00Z
GET /partner/v1/pedidos?incluir=todos
```

| Parâmetro | Opcional | Descrição |
|---|---|---|
| `desde` | sim | Só pedidos alterados (`atualizado_em`) a partir desta data/hora (ISO). Use como marcador "data que eu puxei". Data inválida → `400 INVALID_DESDE`. |
| `incluir=todos` | sim | Inclui também os já confirmados (`sent_erp`) e os já faturados. Sem ele, só a fila pendente. |

**A fila pendente** (sem `incluir=todos`) é: situação `approved`, sem número do
ERP (`pedido_erp` nulo) e **não faturado**. Pedido que já foi faturado à mão no
aplicativo não entra na fila — aparece só com `incluir=todos`. Com
`incluir=todos`, o pedido `sent_erp` sai com `importavel: true` como qualquer
outro. **Para decidir se importa a partir de `incluir=todos`, use os dois
campos:** importe só quem tem `pedido_erp` nulo **e** `faturado` falso. Pedido
com `faturado: true` e `pedido_erp` nulo foi lançado e faturado à mão antes da
integração — **não importe**.

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
| `situacao` | texto | `approved` (aguardando importação) ou `sent_erp` (já confirmado; só aparece com `incluir=todos`) |
| `criado_em` / `atualizado_em` | data ISO | Criação / última alteração |
| `valor_total` | número | Total do pedido, **já com o desconto aplicado** |
| `observacoes` | texto ou null | Só o que o representante DIGITOU (a cor escolhida sai por item, em `itens[].observacao`) |
| `pedido_erp` | texto ou null | Número no ERP, na forma normalizada (ex.: `CS17379`). Nulo na fila; preenchido pela sua confirmação |
| `cliente.codigo_erp` | texto | **Código do cliente no seu ERP** (campo CLIENTE) |
| `cliente.cnpj` | texto ou null | CNPJ/CPF para conferência |
| `representante_erp` | texto | **Código do representante no seu ERP** (campo REPRESENTANTE) — o código gravado no cliente |
| `tabela_preco.codigo_erp` | texto ou null | **Código da tabela de preço no seu ERP** — a tabela vinculada ao cliente no momento da consulta |
| `tabela_preco.coluna` | inteiro | Coluna de preço usada (1 a 6) |
| `condicao_pagamento` | objeto ou null | **Código da condição no seu ERP** (`codigo`, ex.: `"021"`) + `descricao`. O mesmo código da célula C8 da planilha. `null` quando o pedido não tem condição escolhida — isso **não** gera pendência |
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
`desconto_percentual`, `faturado`, `faturado_em` e `valor_faturado` dependem de
recursos que podem ainda não estar ativos numa instalação. Quando não estão,
saem `null` (`0` no desconto, `false` no faturado) — a resposta nunca quebra por
isso.

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
número, `synced_at` e `updated_at`.

| Resposta | `code` | Significado | O que fazer |
|---|---|---|---|
| `200 {"ok":true,"ja_confirmado":false}` | — | Confirmado agora — sai da fila | Seguir para o próximo |
| `200 {"ok":true,"ja_confirmado":true}` | — | Já estava confirmado com esse mesmo número. Nada é regravado | Nada — repetição é segura |
| `400` | `MISSING_PEDIDO_ERP` | Falta `pedido_erp` (ausente, não é texto ou vazio) | Corrigir a chamada |
| `400` | `INVALID_PEDIDO_ERP` | Número fora do formato: duas letras e até 10 dígitos | Corrigir o número |
| `404` | `ORDER_NOT_FOUND` | Não existe pedido com esse `id` na sua empresa (inclusive `id` fora do formato UUID — cortado ou digitado errado) | Registrar e avisar o suporte |
| `409` | `ORDER_ALREADY_CONFIRMED` | Já confirmado com **outro** número; a resposta traz `pedido_erp_atual` (grafia gravada) | Investigar: sinal de importação duplicada do seu lado |
| `409` | `ORDER_NOT_APPROVED` | O pedido não está numa situação que aceite confirmação (só pedido aprovado pode ser confirmado); a resposta traz a `situacao` atual | Não importar — esse pedido não estava na fila. Registrar |
| `409` | `ERP_NUMBER_IN_USE` | Esse número já está gravado em **outro** pedido; a resposta traz `pedido_em_uso` — `{ id, numero }`, ou `null` (o objeto inteiro) quando o outro pedido não pôde ser lido no momento. `numero` é o número do outro pedido no aplicativo e vem `null` se o banco ainda não tiver essa coluna. Teste `pedido_em_uso` antes de ler `.id`/`.numero` | Conferir a numeração do seu lado |
| `500` | `INTERNAL_ERROR` | Falha ao ler ou gravar. Não significa que o pedido não existe | Não trate como confirmado nem como inexistente: tente de novo na próxima rodada |

As checagens correm nesta ordem: campo presente → formato → pedido existe → já
tem número (o mesmo = 200, outro = 409) → situação aceita confirmação → número
livre → gravação. Duas confirmações ao mesmo tempo não passam: a segunda recebe
`ja_confirmado: true` (mesmo número) ou `409 ORDER_ALREADY_CONFIRMED`.

**Formato de toda resposta de erro** (nesta e nas outras rotas):

```json
{
  "error": "Número do Control já usado pelo pedido 14602",
  "code": "ERP_NUMBER_IN_USE",
  "statusCode": 409,
  "pedido_em_uso": { "id": "a1b2c3…", "numero": 14602 }
}
```

Decida pelo `code` e pelo status HTTP, não pela mensagem: o texto de `error` é
informativo e pode mudar.

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
    { "pedido_erp": "CS17379", "faturado_em": "2026-08-13T14:02:00Z", "valor_faturado": 870.50 },
    { "pedido_erp": "CS17380" }
  ]
}
```

O corpo pode vir como `{ "faturamento": [...] }`, `{ "dados": [...] }` ou a
lista pura. Máximo de 1000 pedidos por requisição (`400 BATCH_TOO_LARGE`);
corpo fora do formato → `400 INVALID_BODY`.

| Campo | Obrigatório | Significado |
|---|---|---|
| `pedido_erp` | sim¹ | O número do pedido no seu ERP (o mesmo do passo 3), **em qualquer grafia** — `cs-17379` acha `CS17379` |
| `id` | sim¹ | Alternativa ao `pedido_erp`: o id que veio na fila |
| `faturado` | não | `false` desfaz um faturamento informado antes e **limpa a data e o valor**. Ausente = `true` |
| `faturado_em` | não | ISO da emissão da nota. Ausente = agora — reenviar sem ele move a data para o momento do reenvio, então mande sempre |
| `valor_faturado` | não | O valor que a nota fechou, maior que zero. **Ausente = fica vazio (NULL) no aplicativo**, e o painel volta a usar o valor do pedido. Reenviar sem o valor **apaga** o que foi informado antes — mande sempre |

¹ Informe **um** dos dois. `pedido_erp` é o preferido. A busca é sempre dentro
da sua empresa: um parceiro nunca fatura pedido de outra fábrica.

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
  "ignorados": [
    { "pedido": "CS17380", "motivo": "pedido não encontrado nesta empresa" }
  ],
  "servidor_hora": "2026-08-13T14:02:10.114Z"
}
```

Um registro com problema não derruba o lote: ele volta em `ignorados` com o
motivo, e o resto grava. Os motivos possíveis são seis:

| Motivo | Quando |
|---|---|
| `informe "pedido_erp" ou "id"` | O registro veio sem os dois |
| `falha ao buscar: …` | Erro ao procurar o pedido. Reenvie na próxima rodada |
| `pedido não encontrado nesta empresa` | Nenhum pedido da sua empresa com esse número ou id |
| `"faturado_em" não é uma data ISO` | Data fora do padrão |
| `"valor_faturado" precisa ser maior que zero` | Zero ou negativo |
| `falha ao gravar: …` | Erro ao gravar o carimbo. Reenvie na próxima rodada |

Repetir o mesmo envio, **com os mesmos campos**, é seguro. O faturamento também
atualiza a "última compra" do cliente no aplicativo.

---

## Códigos de erro (todas as rotas)

Toda resposta de erro tem o formato `{ "error": "<mensagem>", "code":
"<CODIGO>", "statusCode": <n> }`, mais campos extras quando indicado.

| HTTP | `code` | Onde | Quando |
|---|---|---|---|
| `503` | `PARTNER_API_DISABLED` | todas | A integração ainda não foi liberada no servidor |
| `401` | `PARTNER_UNAUTHORIZED` | todas | Chave ausente ou errada no `X-API-Key` |
| `400` | `INVALID_DESDE` | `GET /pedidos` | `desde` não é uma data ISO |
| `400` | `MISSING_PEDIDO_ERP` | `POST /confirmar` | Corpo sem `pedido_erp`, ou `pedido_erp` vazio / que não é texto (o corpo vazio é o caso da linha abaixo) |
| `400` | `INTERNAL_ERROR` | todas | Corpo JSON vazio ou malformado com `Content-Type: application/json` — o `statusCode` diz 400. Corrija a chamada, não reenvie |
| `400` | `INVALID_PEDIDO_ERP` | `POST /confirmar` | Número fora do formato (duas letras e até 10 dígitos) |
| `404` | `ORDER_NOT_FOUND` | `POST /confirmar` | Não há pedido com esse `id` na sua empresa (inclusive `id` fora do formato UUID) |
| `409` | `ORDER_ALREADY_CONFIRMED` | `POST /confirmar` | Já confirmado com outro número (`pedido_erp_atual`) |
| `409` | `ORDER_NOT_APPROVED` | `POST /confirmar` | A situação do pedido não aceita confirmação (`situacao`) |
| `409` | `ERP_NUMBER_IN_USE` | `POST /confirmar` | Número já gravado em outro pedido (`pedido_em_uso`) |
| `400` | `INVALID_BODY` | `POST` de lista | O corpo não é uma lista nem `{ "faturamento" / "clientes" / "representantes": [...] }` |
| `400` | `BATCH_TOO_LARGE` | `POST` de lista | Mais de 1000 registros numa requisição |
| `413` | `INTERNAL_ERROR` | todas | Corpo acima de 1 MB — o `statusCode` diz 413; divida o lote |
| `429` | `INTERNAL_ERROR` | todas | Mais de 300 requisições por minuto do mesmo IP; espere um minuto |
| `500` | `INTERNAL_ERROR` | todas | Falha interna (banco, rede) |

**Qualquer 5xx: não confirme, não conclua que o pedido sumiu; tente de novo na
próxima rodada.** Qualquer 4xx é erro da chamada — repetir igual dá o mesmo
resultado; corrija ou registre. Decida pelo `code` e pelo status HTTP — a
mensagem em `error` é informativa.

---

## Exemplo completo (linha de comando)

```bash
# fila de pedidos
curl -H "X-API-Key: SUA_CHAVE" \
  https://setorxweb-production.up.railway.app/partner/v1/pedidos

# confirmar
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"pedido_erp\":\"CS17379\"}" \
  https://setorxweb-production.up.railway.app/partner/v1/pedidos/ID_DO_PEDIDO/confirmar

# informar o faturamento
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"faturamento\":[{\"pedido_erp\":\"CS17379\",\"faturado_em\":\"2026-08-13T14:02:00Z\",\"valor_faturado\":870.50}]}" \
  https://setorxweb-production.up.railway.app/partner/v1/faturamento
```

## Boas práticas

- Consulte a fila a cada 1–5 minutos (a chamada é leve).
- Grave o pedido no ERP **antes** de confirmar. Se a gravação falhar, não
  confirme — o pedido continua na fila para a próxima tentativa.
- Trate `409` como alerta: `ORDER_ALREADY_CONFIRMED` e `ERP_NUMBER_IN_USE` são
  sinal de numeração ou importação duplicada do seu lado; `ORDER_NOT_APPROVED`
  é pedido que não estava na fila.
- `5xx` não é resposta: tente de novo na próxima rodada, sem marcar nada.
- A chave de API é secreta — não coloque em código-fonte compartilhado.

## Antes de emitir a chave (lado do app — não é tarefa do parceiro)

Checagem do responsável pelo sistema, por instalação (Corpo Sensual e PLUMENE),
antes de configurar `PARTNER_API_KEYS`:

- O índice único do número do ERP (migração 042) precisa estar no banco: é ele
  que garante o `409 ERP_NUMBER_IN_USE` quando duas confirmações chegam ao
  mesmo tempo. Sem ele, só a pré-checagem protege — dois pedidos podem ficar
  com o mesmo número. Em 15/09/2026 ele existia na PLUMENE e **faltava na
  Corpo Sensual**: rodar a conferência do fim da 042 (repetidos deve vir vazio)
  e colar o `CREATE UNIQUE INDEX`.
- A tabela da migração 046 (`order_erp_sync`) precisa existir e estar visível
  para a API (`node _tools/conferir-046.mjs`), senão a confirmação grava o
  número mas não tira a foto do que o ERP conhece.

---

# Cadastros — o ERP ALIMENTA o app (v1)

A mão inversa dos pedidos: aqui o **seu ERP envia** clientes e representantes
atualizados, e o app grava. Você lê do seu banco e faz `POST`; o app nunca toca
no seu sistema. Mesma chave `X-API-Key`, mesma URL base.

**Fluxo recomendado:** a cada ~10 minutos, envie os clientes e os representantes
(em lotes de até 500). Clientes: upsert por **código do ERP** — quem já existe é
atualizado, quem não existe é criado. Representantes: só atualização de quem já
tem login (ver abaixo). Nada é apagado.

## Regras gerais

- **Tolerante:** só é recusado o que não dá para usar (sem código ou sem nome).
  A resposta lista o que foi ignorado e por quê; o resto grava.
- **Registro sempre completo:** o cliente é gravado com todos os campos a cada
  envio — campo que não veio é gravado vazio. **Mande o cadastro inteiro**, não
  só o que mudou dentro do registro (ver o aviso em `/clientes`).
- **Máximo 1000 por requisição** (recomendado 500). Acima de 1000 →
  `400 BATCH_TOO_LARGE`. Divida em lotes.
- **Datas e números** no padrão JSON. CNPJ/telefone podem vir com ou sem
  pontuação.
- **Desativar** um cliente é mandar `bloqueado: "S"` (ou `ativo: "N"` no rep). O
  app **nunca apaga** — cliente tem histórico de pedidos preso a ele.
- **Erro de banco no meio do lote** → `500 INTERNAL_ERROR` e o lote fica pela
  metade: os registros anteriores já gravaram, os seguintes não. Reenviar o lote
  inteiro é seguro (o upsert não duplica) — e é por isso que lotes pequenos são
  melhores.

## POST /partner/v1/clientes

Corpo: `{ "clientes": [ ... ] }`, `{ "dados": [ ... ] }` ou a lista pura.

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do cliente no ERP. A chave do upsert. O casamento é pelo "miolo": `#2225`, `2225` e `02225` são o mesmo cliente |
| `razao_social` | texto | **Sim** | Sem ela o registro volta em `ignorados` |
| `nome_fantasia` | texto | Não | — |
| `cnpj_cpf` | texto | Recomendado | 11 (CPF) ou 14 (CNPJ) dígitos, com ou sem pontuação. Um cliente que já existia no app **sem código** e com esse CNPJ é *adotado*: recebe o código e não vira cadastro duplicado |
| `representante` | texto | **Sim, na prática** | Código do rep no ERP. Fica gravado no cliente, sai no pedido como `representante_erp` e é o que faz o cliente aparecer para o representante que tem esse código no login do app. Sem ele, o cliente fica sem dono e o pedido sai com pendência |
| `tabela_preco` | texto | Recomendado | Código da tabela no ERP. Ver nota abaixo |
| `endereco` | objeto ou texto | Recomendado | `{ logradouro, numero, complemento, bairro, cidade, uf, cep }` ou um texto pronto. O app grava **uma linha de texto** (`Rua das Flores, 123 - Centro - Juiz de Fora/MG - CEP 36000-000`); não há campos separados de endereço alimentados por esta rota |
| `bloqueado` | `"S"`/`"N"` | Não | `S` = cliente não fecha pedido. Ausente = `N` |
| `limite_credito` | número | Não | Informativo |
| `whatsapp` | texto | Não | Com DDD |
| `email` | texto | Não | — |

**Mande o cadastro inteiro.** O registro é gravado completo, sempre: um envio
só com `codigo` e `razao_social` apaga fantasia, CNPJ, representante, tabela,
endereço, WhatsApp e e-mail que estavam lá — e desbloqueia um cliente bloqueado
(`bloqueado` ausente vira `N`).

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
recusado (`sem código do ERP`, `sem razão social`). `avisos` traz o que passou
mas merece conferência: tabelas de preço não encontradas, clientes casados pelo
CNPJ e o aviso de que nenhuma tabela tem código do ERP.

## POST /partner/v1/representantes

Corpo: `{ "representantes": [ ... ] }`, `{ "dados": [ ... ] }` ou a lista pura.

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do rep no ERP. Casa **exato** com o código atribuído ao login no app (`0779` e `779` não são o mesmo) |
| `nome` | texto | **Sim** | Sem ele o registro volta em `ignorados` |
| `razao_social` | texto | Não | Aceito, mas não é gravado nesta versão |
| `email` | texto | Não | Atualiza o e-mail de login (gravado em minúsculas) — só quando vem |
| `ativo` | `"S"`/`"N"` | Não | Ou `true`/`false`. Só é alterado quando vem: ausente ou vazio (`""`) não mexe no acesso. Qualquer outro texto conta como `"N"` |

**Importante — login não nasce por aqui.** Este endpoint **só atualiza** nome,
e-mail e ativo dos representantes que já têm login no app **com o seu código**.
Um rep que existe no ERP mas ainda não tem acesso no app **não é criado** — ele
volta na resposta em `novos`, para o administrador criar o acesso e atribuir o
código na tela de Representantes (conta precisa de senha, e senha não nasce de
um POST). `criados` é sempre `0`.

Esta rota **não vincula a carteira**: quem liga cliente a representante é o
código que vem em cada cliente (`representante`, no `POST /clientes`) contra o
código atribuído ao login do representante no app.

**Resposta 200** (além dos campos comuns): `"novos": [ { "codigo": "...",
"nome": "..." } ]`. Quando há `novos`, `avisos` lembra de criar o acesso deles.

## Erros

Os códigos de todas as rotas estão na tabela **Códigos de erro** acima. Para os
cadastros valem `400 INVALID_BODY`, `400 BATCH_TOO_LARGE`, `401`, `503` e o
`500 INTERNAL_ERROR` de erro de banco no meio do lote.

## Boas práticas (cadastros)

- Envie a cada ~10 min. Não precisa mandar todos os clientes sempre — mandar só
  os que mudaram (por `DATA_UPDATE`) deixa o lote pequeno. Mas cada cliente
  enviado vai com o cadastro inteiro.
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
| Código do representante | **ERP** | Chega em cada cliente (`representante`), mostra o cliente ao rep com o mesmo código no login e sai no pedido como `representante_erp`. `POST /representantes` só atualiza nome, e-mail e ativo de quem já tem login **e** já tem esse código gravado no app |
| Tabela de preço (código e coluna) | **ERP** | O app guarda o vínculo no cliente; o pedido sai com a tabela que o cliente tem na hora da consulta |
| Condição de pagamento (código) | **ERP** | O app tem as 146 cadastradas; rep e loja só escolhem |
| Referência do produto | **ERP** | O app vende só o que está no catálogo da coleção |
| Pedido (itens, desconto, condição, observações) | **App** | O ERP importa via `GET /pedidos` |
| **Número do pedido no ERP** (ex.: CS17379) | **ERP** | Nasce na importação e volta pelo `POST /confirmar` — o app nunca inventa esse número |
| Faturamento (nota, valor, data) | **ERP** | Volta pelo `POST /faturamento`; o app carimba sozinho |

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
| Endereço | `endereco` | Entrega e cadastro — gravado numa linha de texto |
| Bloqueado | `bloqueado` | `"S"` = não fecha pedido no app |
| Limite de crédito | `limite_credito` | Informativo |
| WhatsApp / e-mail | `whatsapp`, `email` | Contato e o botão "Enviar pedido para o cliente" |

## Representante

| Dado | Campo no envio | Para que serve |
|---|---|---|
| Código no ERP | `codigo` | Casa com o código atribuído ao login; é por ele que os clientes aparecem para o rep e que o pedido sai com `representante_erp` |
| Nome | `nome` | Telas e planilha |
| E-mail | `email` | O login no app (atualizado só quando vem) |
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

O pedido sai com a tabela vinculada ao cliente **no momento da consulta** — o
vínculo é do cadastro, não uma foto por pedido. Trocar a tabela do cliente muda
o que sai para os pedidos ainda não puxados.

## Condição de pagamento

| Dado | Onde aparece | Observação |
|---|---|---|
| Código | `condicao_pagamento.codigo` | O MESMO código do Control (ex.: `"021"`) — é o que a planilha põe em C8 |
| Descrição | `condicao_pagamento.descricao` | Ex.: `"30/60/90"` — para conferência humana |

As 146 condições do Control estão cadastradas no app; representante e loja
escolhem uma ao fechar o pedido. Condição nova no ERP precisa ser cadastrada no
app (hoje por carga; no futuro pode virar um `POST /condicoes` — a combinar).
Pedido sem condição sai com `condicao_pagamento: null`, sem pendência.

## Pedido

| Dado | Campo | Dono | Observação |
|---|---|---|---|
| Identificador técnico | `id` | App | UUID — use na confirmação; nunca muda |
| Número no app | `numero` | App | O número que rep e cliente enxergam (ex.: 14600) |
| **Número no ERP** | `pedido_erp` | **ERP** | Ex.: `CS17379`, sempre na forma normalizada. Nasce na importação, volta pela confirmação e aparece no app para todo mundo |
| Situação | `situacao` | App | Ver "Situações do pedido" abaixo |
| Cliente | `cliente.*` | ERP | Código, CNPJ, razão social, fantasia |
| Representante | `representante_erp` | ERP | Código do rep gravado no cliente |
| Tabela de preço | `tabela_preco.*` | ERP | Código + coluna da tabela do cliente |
| Condição de pagamento | `condicao_pagamento.*` | ERP (código) | Escolhida no app entre as condições do Control; `null` se não escolhida |
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
| `sent_erp` | Já importado e confirmado (tem `pedido_erp`) | Nada — só aparece com `incluir=todos`, e sai com `importavel: true` como qualquer outro; quem diz que já foi importado é o `pedido_erp` preenchido. Em `incluir=todos` também vem o `approved` faturado à mão (`faturado: true`, `pedido_erp` nulo): não importe esse |

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
ERP  → fatura e POST /faturamento          (nota, valor, data → carimbo)
app  → página do cliente vira "Aprovado", painel conta a venda
```

---

## Estabilidade da v1

Campos novos são sempre adicionados, nunca renomeados ou removidos dentro da
mesma versão; mudança que exija alteração no programa do parceiro vira
`/partner/v2/`, com a v1 continuando no ar.

As respostas `400 INVALID_PEDIDO_ERP`, `409 ORDER_NOT_APPROVED` e
`409 ERP_NUMBER_IN_USE` da confirmação entraram em 15/09/2026 como **correção
de defeito da v1**, antes da primeira chave ser emitida — não é versão nova e
nenhum programa em produção foi afetado.

## Dúvidas / suporte

Falar com Yan (responsável pelo sistema de pedidos).
