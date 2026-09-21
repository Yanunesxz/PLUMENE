# API de Parceiro — Integração de Pedidos (v1)

> **Atualizado 16 set 2026.** Contrato da fase 0 da integração com o Control,
> com as decisões de 16/09: a fila é o que o financeiro **solicitou** ao
> Control; o **CNPJ** é a chave do cliente entre os sistemas (cliente sem código
> deixa de ser pendência — o Control cria e devolve o código); um pedido tem
> **uma** nota (a nova substitui a anterior); o Control **manda tudo** pela API
> (tabelas, condições, produtos, preços, estoque e o retrato do cliente) e
> **puxa** o que mudou no app (`GET /clientes` e `GET /representantes` com
> `?desde=`); "sincronizar agora" pela tela; exclusão avisada pelo Control; e a
> série do número é a da marca (`CS` / `PL`). Tudo isso entrou **antes da
> primeira chave ser emitida** e é correção da v1, não versão nova (ver
> "Estabilidade da v1", no fim).
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

## Como funciona

O lançamento do pedido no Control continua sendo **um clique do financeiro** —
o que muda é que ninguém digita número. O caminho inteiro, do clique ao número
na tela:

1. O representante fecha o pedido no aplicativo e o financeiro **aprova**.
2. O financeiro clica **"Lançar no Control"** na tela do pedido. O pedido fica
   marcado como **solicitado** (`solicitado_em`) e entra na fila da API. A tela
   fica aguardando: *"Aguardando o Control importar o pedido… Isso leva até
   3 min."*
3. O programa do Fábio puxa a fila **a cada 1 minuto** — `GET /partner/v1/pedidos`
   — e recebe só os pedidos solicitados, já com os códigos do Control (cliente,
   representante, tabela e coluna, condição, referência e tamanho) e o **CNPJ do
   cliente como chave**. Cliente que o Control ainda não conhece vem com
   `novo_no_control: true`: o programa cria o cadastro lá e devolve o código
   pelo `POST /clientes`.
4. O programa **grava o pedido no Control**, que cunha o número na série da
   marca (`CS17379` na Corpo Sensual, `PL02672` na PLUMENE).
5. O programa **confirma** — `POST /partner/v1/pedidos/{id}/confirmar
   { "pedido_erp": "CS17379" }`. O pedido sai da fila e vira `sent_erp`.
6. A tela do financeiro, que consultava o pedido a cada 3 segundos, mostra:
   *"Parabéns, pedido importado! O número no Control é CS17379."* Se em 3
   minutos o número não chegar: *"O Control ainda não respondeu. O pedido fica
   na fila e o número aparece aqui quando chegar."* — o pedido continua
   solicitado, e o número aparece na próxima passada.
7. Quando a nota sai, o programa informa o **faturamento** — é isso que faz o
   lojista ver "Aprovado" e a venda contar no painel.

Por fora do pedido, o mesmo programa mantém o aplicativo com a mesma chave:
manda o catálogo, os cadastros e o retrato do cliente, e **puxa** o que mudou
no aplicativo (`GET /clientes`, `GET /representantes` e
`GET /pedidos?incluir=todos` com `?desde=`). Os intervalos estão em "Fluxo
recomendado".

## O que cada lado manda

**O que o Control precisa mandar** (tudo pela API; o aplicativo nunca conecta
no banco do Control — o Firebird está aposentado):

- **clientes** — `POST /clientes`: código, razão social, fantasia, CNPJ,
  representante, tabela, endereço, bloqueio e motivo, limite, pendência
  financeira, títulos vencidos, contato, `data_update`;
- **representantes** — `POST /representantes`: código, nome, razão social,
  e-mail do Control, ativo;
- **tabelas de preço e a coluna** — `POST /tabelas-preco`: código, descrição,
  coluna (1 a 6), ativo;
- **condições de pagamento** — `POST /condicoes-pagamento`: código, descrição,
  ativo, valor mínimo;
- **produtos e tamanhos** — `POST /produtos`: código, referência, nome, grupo,
  coleção, marca, ativo e a grade;
- **preços por tabela** — `POST /precos`: o preço de cada produto em cada tabela
  (sobrescreve o que estava);
- **estoque** — `POST /estoque`: quantidade e reservado por produto e tamanho;
- **faturamento com a nota e os itens** — `POST /faturamento`: data, valor, a
  nota (uma por pedido) e as peças que ela levou;
- **retrato e pendência financeira** — `POST /retrato`: última compra, total
  comprado, vencido, títulos vencidos, pendência, com a data de referência;
- **exclusão** — `POST /pedidos/{id}/excluir` quando o Control exclui um pedido
  do lado dele;
- e o **aviso de sincronização concluída** — `POST /sincronizacao`, depois de
  atender um `sincronizar_agora: true`.

**O que o app entrega:**

- **a fila solicitada** — `GET /pedidos`: os pedidos aprovados que o financeiro
  mandou lançar, com os códigos do Control e o CNPJ como chave;
- **a confirmação do número** — `POST /pedidos/{id}/confirmar` (e
  `POST /conciliar` para o passivo);
- **as alterações feitas no aplicativo** — `GET /clientes?desde=` (cliente
  novo ou editado, com `novo_no_control`), `GET /representantes?desde=` e
  `GET /pedidos?incluir=todos&desde=` (pedido editado depois da importação,
  `alterado_apos_importacao`);
- **os excluídos** — `GET /pedidos/excluidos`: pedidos apagados no aplicativo
  que já tinham número do Control;
- **a conciliação** — `GET /conciliacao`: as contagens da fila e do passivo; e
  o `GET /status`, que diz quais canais estão ligados e se alguém pediu
  "sincronizar agora".

## Os endpoints

| Método e rota | Para quê | Canal exigido |
|---|---|---|
| `GET /partner/v1/status` | Testar a conexão e a chave; diz quais canais estão ligados e se alguém pediu "sincronizar agora" | — |
| `GET /partner/v1/pedidos` | Buscar a fila: pedidos aprovados que o financeiro **solicitou** ao Control | pedidos |
| `POST /partner/v1/pedidos/{id}/confirmar` | Confirmar a importação com o número gerado no ERP | pedidos |
| `POST /partner/v1/pedidos/{id}/conciliar` | Dar o número a um pedido que foi para o ERP sem número (o passivo) | pedidos |
| `POST /partner/v1/pedidos/{id}/excluir` | O Control excluiu o pedido do lado dele e avisa; o app exclui também | pedidos |
| `GET /partner/v1/conciliacao` | Só contagens, para conferir o passivo antes e depois de cada rodada | — |
| `GET /partner/v1/pedidos/excluidos` | Pedidos excluídos no app que já tinham número do ERP | — |
| `POST /partner/v1/faturamento` | Informar o que foi faturado (com a nota e as peças) — fecha o ciclo | faturamento |
| `POST /partner/v1/clientes` | O ERP envia os clientes (cadastro) | cadastro |
| `POST /partner/v1/representantes` | O ERP envia os representantes (cadastro) | cadastro |
| `GET /partner/v1/clientes?desde=` | O ERP **puxa** os clientes que mudaram no app | cadastro |
| `GET /partner/v1/representantes?desde=` | O ERP **puxa** os representantes que mudaram no app | cadastro |
| `POST /partner/v1/tabelas-preco` | O ERP envia as tabelas de preço (código, descrição, coluna, ativo) | catálogo |
| `POST /partner/v1/condicoes-pagamento` | O ERP envia as condições de pagamento (código, descrição, ativo, valor mínimo) | catálogo |
| `POST /partner/v1/produtos` | O ERP envia os produtos e a grade de tamanhos | catálogo |
| `POST /partner/v1/precos` | O ERP envia o preço de cada produto por tabela (sobrescreve) | catálogo |
| `POST /partner/v1/estoque` | O ERP envia o estoque por produto e tamanho | catálogo |
| `POST /partner/v1/retrato` | O ERP envia o retrato do cliente: última compra, total comprado, vencido, pendência financeira | retrato |
| `POST /partner/v1/sincronizacao` | O ERP avisa que rodou a passada que o `sincronizar_agora` pediu | — |

Quatro chamadas fazem o ciclo do pedido (testar, buscar, confirmar, faturar);
conciliar, conciliação, excluídos e excluir acertam o que aconteceu antes da
integração ou fora dela; as de cadastro, catálogo e retrato rodam por conta
própria, nos intervalos recomendados em "Fluxo recomendado". Mesma chave e
mesma URL base dentro de cada marca. **O Control é a fonte de tudo que ele
manda** — o app nunca conecta no banco do ERP.

## Canal por empresa

Cada fluxo tem **um escritor só**. Enquanto a fábrica ainda lança o número do
pedido e o faturado à mão no aplicativo, a API não pode escrever os mesmos
dados — seria pedido lançado duas vezes e faturamento que se desfaz sozinho. Por
isso cada empresa tem cinco canais, e **o Yan (responsável pelo sistema) liga
cada canal para a API, empresa por empresa**, quando a fábrica estiver pronta
para parar de lançar aquele dado à mão:

| Canal | Rotas que dependem dele | Valor que libera a API |
|---|---|---|
| `pedido_erp` | `GET /pedidos`, `POST /confirmar`, `POST /conciliar`, `POST /pedidos/{id}/excluir` | `api` |
| `faturamento` | `POST /faturamento` | `api` |
| `cadastro` | `POST /clientes`, `POST /representantes`, `GET /clientes?desde=`, `GET /representantes?desde=` | `api` |
| `catalogo` | `POST /tabelas-preco`, `POST /condicoes-pagamento`, `POST /produtos`, `POST /precos`, `POST /estoque` | `api` |
| `retrato` | `POST /retrato` | `api` |

O canal muda o que o **app** faz também: com `pedido_erp = api`, o botão
"Lançar no ERP" do financeiro deixa de pedir número — ele **solicita** ao
Control e a tela espera o número chegar pela sua confirmação; com
`faturamento = api`, o botão manual de faturado some para todo mundo (o
faturado só chega por `POST /faturamento`); com `catalogo = api`, o preço que
vale é o que você manda (sobrescreve o da carga do catálogo) e a importação de
catálogo por planilha no app fica desligada — ela desfaria o preço e o estoque
que você mandou.

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

`GET /status` mostra os cinco canais da sua empresa. `GET /status`,
`GET /conciliacao`, `GET /pedidos/excluidos` e `POST /sincronizacao` funcionam
com qualquer canal — são diagnóstico e controle, não dado.

**Toda chamada fica registrada** do nosso lado (rota, status HTTP, quantos
registros chegaram, gravaram, ficaram iguais e foram ignorados, e os motivos) —
sem a sua chave e sem dado de cliente. É por esse registro que respondemos "o
que aconteceu com o envio das 14h".

## Fluxo recomendado

### Intervalos recomendados

| O quê | Rotas | Quando |
|---|---|---|
| **Fila de pedidos** | `GET /pedidos` → grava no Control → `POST /pedidos/{id}/confirmar` | **a cada 1 minuto** — o financeiro fica olhando a tela esperando o número |
| **Cadastros e alterações, nas duas mãos** | `POST /clientes`, `POST /representantes` (só o que mudou); `GET /clientes?desde=`, `GET /representantes?desde=`, `GET /pedidos?incluir=todos&desde=` | **a cada 5 minutos** |
| **Faturamento** | `POST /faturamento` | **assim que a nota sair** (ou a cada 5 minutos) |
| **Catálogo, preço e estoque** | `POST /tabelas-preco`, `/condicoes-pagamento`, `/produtos`, `/precos`, `/estoque` | **a cada 30 minutos** |
| **Retrato do cliente** | `POST /retrato` | **1x por dia** |
| **Sincronizar agora** | `GET /status` → `sincronizar_agora: true` → tudo acima → `POST /sincronizacao` | **sempre que o `/status` pedir** (o `/status` é barato: chame-o junto com a fila; o pedido expira em 15 minutos) |
| Passivo (uma vez) | `GET /conciliacao`, `POST /pedidos/{id}/conciliar` | na implantação, com o Yan |

```
uma vez, na implantação (com o Yan):
  GET  /partner/v1/conciliacao                 → quantos pedidos foram ao ERP sem número
  POST /partner/v1/pedidos/{id}/conciliar      { "pedido_erp": "PL02672" }  (um por pedido do passivo)
  POST /partner/v1/tabelas-preco, /condicoes-pagamento, /produtos, /precos, /estoque
                                               → o catálogo inteiro, nesta ordem

a cada 1 minuto — a fila:
  1. GET  /partner/v1/pedidos            → os pedidos que o financeiro SOLICITOU ao Control
  2. para cada pedido:
       o cliente tem chave (CNPJ): se novo_no_control, crie o cadastro lá
       grava no ERP (gera o número interno, ex.: CS17379)
  3. POST /partner/v1/pedidos/{id}/confirmar  { "pedido_erp": "CS17379" }
       → o pedido sai da fila; a tela do financeiro mostra o número na hora

a cada 5 minutos — cadastros e alterações (as duas mãos):
  POST /partner/v1/clientes            { "clientes": [...] }          ← o que mudou no ERP
  POST /partner/v1/representantes      { "representantes": [...] }
  GET  /partner/v1/clientes?desde=      → o que mudou no app (cliente novo, sem código: crie e devolva o código)
  GET  /partner/v1/representantes?desde=
  GET  /partner/v1/pedidos?incluir=todos&desde=  → pedido editado depois da importação (alterado_apos_importacao)

assim que a nota sair (ou a cada 5 minutos):
  POST /partner/v1/faturamento         { "faturamento": [...] }  ← fecha o ciclo

a cada 30 minutos — catálogo, preço e estoque:
  POST /partner/v1/tabelas-preco, /condicoes-pagamento, /produtos, /precos, /estoque

1x por dia — o retrato do cliente:
  POST /partner/v1/retrato             { "retrato": [...] }

e sempre que GET /status devolver "sincronizar_agora": true:
  rode tudo acima já, e depois  POST /partner/v1/sincronizacao { "concluida": true, "solicitado_em": "..." }
```

A fila só contém pedidos **aprovados, solicitados ao Control pelo financeiro,
ainda não confirmados e ainda não faturados** — depois do passo 3 o pedido não
volta. Assim não há risco de importar duas vezes, mesmo que o programa rode de
novo ou a conexão caia no meio. O clique do financeiro em "Lançar no Control"
continua sendo o gatilho: pedido aprovado que ninguém mandou lançar não aparece
na fila.

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

**A série é a da marca:** `CS` na Corpo Sensual, `PL` na PLUMENE — um Control
por marca, uma chave e uma URL por marca. A máscara continua duas letras e a
numeração; não existe série própria de representante nem de integração — o
número é sempre o da série da marca.

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
  "canais": { "pedido_erp": "api", "faturamento": "manual", "cadastro": "carga", "catalogo": "carga", "retrato": "carga" },
  "sincronizar_agora": false,
  "solicitado_em": null
}
```

`canais` diz quais rotas estão ligadas para a API na sua empresa (ver "Canal por
empresa"): `pedido_erp` é `manual`, `api` ou `sync_py`; `faturamento` é `manual`
ou `api`; `cadastro`, `catalogo` e `retrato` são `carga`, `api` ou `firebird`.
Só `api` libera a rota.

`sincronizar_agora` (sempre booleano) é o botão "Pedir sincronização agora" da
tela de integração do app: `true` = alguém pediu para o Control puxar tudo já,
sem esperar o próximo horário. Rode a rodada inteira (fila, cadastros nas duas
mãos, faturamento, catálogo, retrato) e avise com `POST /partner/v1/sincronizacao`
`{ "concluida": true, "solicitado_em": <o mesmo texto que veio aqui> }` — só
aí o campo volta a `false`. `solicitado_em` é o momento do pedido (ISO com
fuso) ou `null`. Ver a seção "Sincronizar agora".

**O pedido expira em 15 minutos.** Se o Control não avisar a conclusão em até
15 minutos depois de `solicitado_em`, `sincronizar_agora` passa a vir `false` —
um robô que volta depois de horas parado não roda uma rodada que ninguém espera
mais. `solicitado_em` continua saindo com o momento do pedido expirado (só para
diagnóstico), e mandar o `POST /sincronizacao` com ele continua seguro. Quando
alguém pede de novo na tela, vem um `solicitado_em` novo com
`sincronizar_agora: true`.

`canais` vem **`null`** quando o app não conseguiu ler os canais agora (banco
sem responder). O `/status` é a rota de diagnóstico e nunca vira 500 por isso —
`ok: true` continua significando "a chave e a conexão estão boas". Tente de novo
para ver os canais.

Sem chave ou com chave errada (inclusive a chave de uma marca na URL da outra, e
a chave que ainda não foi cadastrada): `401 PARTNER_UNAUTHORIZED`. Integração
ainda não liberada naquele servidor (nenhuma chave configurada):
`503 PARTNER_API_DISABLED`. Vale para as dezenove rotas — chave errada responde
`401` em qualquer uma delas, nunca `404`.

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
ERP (`pedido_erp` nulo), **não faturado** e **solicitado ao Control** pelo
financeiro (`solicitado_em` preenchido — o clique em "Lançar no Control" na
tela do pedido). Pedido aprovado que ninguém mandou lançar, e pedido que já foi
faturado à mão no aplicativo, não entram na fila — aparecem só com
`incluir=todos`. (Numa instalação onde a migração 049 ainda não rodou, a fila é
a de antes: todo aprovado sem número e não faturado.)

**Pedido que sai da fila depois de entregue:** enquanto o pedido não tem
número, o financeiro pode **cancelar a solicitação** na tela do app. O pedido
some da fila (com `incluir=todos` volta com `solicitado_em: null` e a pendência
`pedido não solicitado pelo financeiro`). O app não sabe se você já o puxou —
entre a sua leitura da fila e o `POST /confirmar` ele continua sem número —,
então o cancelamento **não invalida o que você já importou**: se o pedido já
está no seu ERP, confirme normalmente; o `POST /confirmar` aceita e **o número
vence o cancelamento**. Se o financeiro pedir de novo, o mesmo `id` volta à
fila: confira pelo `id` antes de importar e, se ele já está no seu ERP, só
confirme com o número que já tem.

**Importar a partir de `incluir=todos`:** a lista traz `approved` e `sent_erp`,
faturados ou não, e o `sent_erp` sai com `importavel: true` como qualquer
outro. Importe **só quem tem `pedido_erp` nulo, `faturado` falso e
`solicitado_em` preenchido**, e entre esses só a situação `approved` — que é
exatamente a fila pendente. O resto não se importa:

- `pedido_erp` preenchido: já está no ERP;
- `faturado: true` com `pedido_erp` nulo: lançado e faturado à mão antes da
  integração;
- `sent_erp` com `pedido_erp` nulo: é o **passivo**, lançado à mão sem o número
  voltar ao app — já está no ERP. Não importe: dê o número a ele pelo
  `POST /conciliar` (seção 3b).

**Pedido editado depois da importação:** com `incluir=todos`, o campo
`alterado_apos_importacao` diz se o pedido de hoje é **diferente do que o
Control conhece** — peças, desconto, condição de pagamento ou observação. A
comparação é com a foto que o app guarda quando o número do Control é gravado
(e de novo quando alguém confirma na tela que atualizou no Control); **não** é a
data de alteração do pedido, que o faturamento, as notas e a própria
confirmação também mexem. `true` continua `true` até alguém confirmar a
atualização na tela do app. `null` = sem número, ou pedido lançado antes de o
app guardar a foto (não dá para comparar). Use `?incluir=todos&desde=` na
rodada de 5 minutos para pegar essas alterações e espelhá-las no ERP.

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
      "solicitado_em": "2026-07-15T20:15:02.000+00:00",
      "alterado_apos_importacao": null,
      "cliente": {
        "codigo_erp": "01234",
        "chave": "00000000000100",
        "novo_no_control": false,
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
| `solicitado_em` | data ISO ou null | Quando o financeiro clicou em "Lançar no Control". Na fila vem sempre preenchido; `null` no passivo, no pedido lançado à mão e em instalação sem a migração 049 |
| `alterado_apos_importacao` | booleano ou null | O pedido está diferente do que o Control conhece (peças, desconto, condição, observação)? `null` sem número (na fila é sempre `null`) ou sem a foto do lançamento — ver "Pedido editado depois da importação" |
| `cliente.codigo_erp` | texto ou null | **Código do cliente no seu ERP** (campo CLIENTE). `null` quando o cliente nasceu no app e o Control ainda não devolveu o código |
| `cliente.chave` | texto ou null | **A chave única do cliente entre os sistemas: o CNPJ/CPF só com dígitos.** É por ela que o seu ERP casa o cadastro. `null` quando o cadastro não tem documento, ou tem menos de 11 dígitos (aí vira a pendência `cliente sem CNPJ`) — a mesma régua do `POST /clientes`, que só casa a partir de 11 |
| `cliente.novo_no_control` | booleano | `true` = o app não tem o código deste cliente no Control. **Crie o cadastro no ERP** (casando pela `chave`) e devolva o código pelo `POST /clientes` — não é pendência, o pedido é importável |
| `cliente.cnpj` | texto ou null | CNPJ/CPF como está no cadastro (com pontuação, se tiver) |
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
| `pendencias` | lista de texto | O que falta quando `importavel=false`. Seis textos fixos — ver abaixo |

### As pendências

`pendencias` só contém estes textos, sem repetição:

1. `cliente sem CNPJ`
2. `cliente sem representante vinculado no ERP`
3. `pedido sem tabela de preço vinculada no ERP`
4. `item sem vínculo de produto/tamanho com o ERP`
5. `pedido sem itens`
6. `pedido não solicitado pelo financeiro` — só com `incluir=todos`: pedido
   aprovado que o financeiro ainda não mandou lançar. O lançamento é o clique
   dele; não importe (o `POST /confirmar` desse pedido responde
   `409 ORDER_NOT_REQUESTED`). Na fila padrão nunca aparece. Também sai assim
   o pedido cuja solicitação o financeiro cancelou: se você já o tinha
   importado, confirme — ver "Pedido que sai da fila depois de entregue"

`importavel` é `true` exatamente quando a lista está vazia. Recomendação:
importar apenas os `importavel: true` e reportar os demais, para o cadastro ser
corrigido na origem.

**Cliente sem código do ERP deixou de ser pendência** (16/09/2026): o CNPJ é a
chave entre os sistemas. Pedido de cliente que o Control ainda não conhece sai
com `cliente.novo_no_control: true` e `cliente.codigo_erp: null` — o seu ERP
cria o cadastro (casando pela `chave`) e devolve o código pelo `POST /clientes`.
Só o cliente **sem CNPJ** trava, porque sem documento não há como casar.

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
número, `synced_at` e `updated_at`. O contrato desta rota não mudou na fase 0,
fora a solicitação ao Control (049): pedido aprovado que o financeiro não
solicitou é recusado — **menos** o que ele solicitou e depois cancelou, que é
aceito (você pode tê-lo puxado da fila antes do cancelamento; ver "Pedido que
sai da fila depois de entregue", na seção 2).

| Resposta | `code` | Significado | O que fazer |
|---|---|---|---|
| `200 {"ok":true,"ja_confirmado":false}` | — | Confirmado agora — sai da fila | Seguir para o próximo |
| `200 {"ok":true,"ja_confirmado":true}` | — | Já estava confirmado com esse mesmo número. Nada é regravado | Nada — repetição é segura |
| `400` | `MISSING_PEDIDO_ERP` | Falta `pedido_erp` (ausente, não é texto ou vazio) | Corrigir a chamada |
| `400` | `INVALID_PEDIDO_ERP` | Número fora do formato: duas letras e até 10 dígitos | Corrigir o número |
| `404` | `ORDER_NOT_FOUND` | Não existe pedido com esse `id` na sua empresa (inclusive `id` fora do formato UUID — cortado ou digitado errado) | Registrar e avisar o suporte |
| `409` | `ORDER_ALREADY_CONFIRMED` | Já confirmado com **outro** número; a resposta traz `pedido_erp_atual` (grafia gravada) | Investigar: sinal de importação duplicada do seu lado |
| `409` | `ORDER_NOT_APPROVED` | O pedido não está numa situação que aceite confirmação (só pedido aprovado — ou marcado com erro de envio ao ERP — pode ser confirmado); a resposta traz a `situacao` atual | Não importar — esse pedido não estava na fila. Registrar |
| `409` | `ORDER_NOT_REQUESTED` | Pedido aprovado que o financeiro **nunca solicitou** ao Control (veio da lista `incluir=todos`, não da fila). O que ele solicitou e depois cancelou **não** cai aqui: a confirmação é aceita | Não importar — espere o pedido aparecer na fila |
| `409` | `ERP_NUMBER_IN_USE` | Esse número já está gravado em **outro** pedido; a resposta traz `pedido_em_uso` — `{ id, numero }`, ou `null` (o objeto inteiro) quando o outro pedido não pôde ser lido no momento. `numero` é o número do outro pedido no aplicativo e vem `null` se o banco ainda não tiver essa coluna. Teste `pedido_em_uso` antes de ler `.id`/`.numero` | Conferir a numeração do seu lado |
| `409` | `CANAL_FECHADO` | Canal de pedidos não ligado para a API na sua empresa | Combinar com o Yan |
| `500` | `INTERNAL_ERROR` | Falha ao ler ou gravar. Não significa que o pedido não existe | Não trate como confirmado nem como inexistente: tente de novo na próxima rodada |

As checagens correm nesta ordem: campo presente → formato → pedido existe → já
tem número (o mesmo = 200, outro = 409) → situação aceita confirmação →
solicitado pelo financeiro, ou solicitado e cancelado depois (aprovado) →
número livre → gravação. Duas confirmações ao mesmo tempo não passam: a segunda recebe
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
  "aprovados_solicitados_ao_control": 9,
  "enviados_sem_numero_nao_faturados": 42,
  "enviados_sem_numero_faturados": 7,
  "aprovados_faturados_sem_numero": 3,
  "enviados_com_numero_sem_faturamento": 18,
  "servidor_hora": "2026-09-15T13:00:00.000Z"
}
```

| Campo | O que conta |
|---|---|
| `fila_aprovados_sem_numero_nao_faturados` | Aprovado, sem número, não faturado — solicitado ao Control ou ainda não |
| `aprovados_solicitados_ao_control` | Desses, os que o financeiro já mandou lançar: **é a fila do `GET /pedidos`**. `null` numa instalação sem a migração 049 (aí a fila é a linha de cima) |
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

## 3e. O Control excluiu o pedido (avisar o app)

```
POST /partner/v1/pedidos/{id}/excluir
Content-Type: application/json

{ "motivo": "cliente desistiu" }
```

Pedido com número do Control **não pode ser excluído pela tela do app** (nem
pelo administrador): apagar de um lado só deixaria o outro com um pedido
fantasma. O caminho é este: quando o seu ERP exclui o pedido, avisa aqui e o
app exclui também — guardando uma cópia no histórico de excluídos, com o nome
do parceiro como quem excluiu, e o rastro `excluido` (origem `api`) com o
`motivo` (opcional, até 500 caracteres). Exige o canal de pedidos ligado para a
API. **Só vale para pedido que o Control tem:** com número do Control, ou
solicitado ao Control pelo financeiro (está na fila, ou você o importou e
excluiu antes de confirmar). Rascunho, pedido aguardando aceite e aprovado que
ninguém mandou lançar não são excluídos por aqui (`409 ORDER_NOT_IN_CONTROL`).
O pedido cuja solicitação o financeiro **cancelou** (e que você não confirmou)
volta a ser um aprovado que ninguém mandou lançar: se você o importou e depois
o excluiu do seu ERP, o aviso responde `409 ORDER_NOT_IN_CONTROL` e o app
mantém o pedido, fora da fila — do seu lado, nada a fazer.

| Resposta | `code` | Significado |
|---|---|---|
| `200 {"ok":true,"excluido_em":"…"}` | — | Apagado agora |
| `404` | `ORDER_NOT_FOUND` | Não existe pedido com esse `id` na sua empresa (ou já foi apagado — repetir é seguro) |
| `409` | `ORDER_INVOICED` | Pedido **faturado** não é excluído: tem nota e conta como venda. Desfaça o faturamento antes (`POST /faturamento` com `"faturado": false`). Também quando o faturamento chega no mesmo instante da exclusão: nada é apagado |
| `409` | `ORDER_NOT_IN_CONTROL` | O pedido não tem número do Control e não está solicitado (nunca foi, ou o financeiro cancelou a solicitação): o app não o exclui por aviso |
| `409` | `CANAL_FECHADO` | Canal de pedidos não ligado para a API |
| `500` | `SEM_COPIA` | A cópia do histórico não gravou — **o pedido não foi apagado**; tente de novo |
| `500` | `INTERNAL_ERROR` | O banco recusou apagar — tente de novo |

O pedido excluído por aqui também aparece em `GET /pedidos/excluidos` (a cópia
tem o número do Control): o seu ERP deve ignorar o próprio eco.

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
| `nota` | não | `{ numero, serie?, chave?, emitida_em?, valor? }` — a nota fiscal. `numero` é obrigatório quando `nota` vem; `serie` ausente vale `""` (número e série identificam a nota dentro do pedido); `emitida_em` com fuso; `valor` maior que zero (número ou texto numérico, como o `valor_faturado`). Em `chave`, `emitida_em` e `valor` vale a regra de ouro |
| `itens` | não | `[{ produto, tamanho, quantidade, preco_unitario? }]` — as peças que **essa nota** levou. Só com `nota`. Quando vem, **substitui** as peças daquela nota (as de outras notas do pedido ficam); `[]` apaga as peças daquela nota; ausente não mexe nelas. `quantidade` inteira maior que zero; `preco_unitario` maior ou igual a zero. Os dois aceitam número ou texto numérico (`2` ou `"2"`) |

¹ Informe **um** dos dois. `pedido_erp` é o preferido. A busca é sempre dentro
da sua empresa: um parceiro nunca fatura pedido de outra fábrica. `id` fora do
formato UUID dá `pedido não encontrado nesta empresa`.

Só pedido **aprovado ou enviado ao ERP** (`approved` ou `sent_erp`) é faturado.

**Um pedido tem UMA nota.** Nota com número (e série) diferente para o mesmo
pedido **substitui** a anterior: a antiga fica cancelada e marcada como
"substituída por" a nova, as peças dela deixam de contar e o rastro do pedido
ganha `nota_substituida`. Nota cancelada ou devolvida no seu ERP não precisa de
aviso — suba a nota nova por cima. A mesma nota reenviada (mesmo número e
série) é `inalterado`; nota cancelada que chega de novo volta a valer. Enquanto
a nota levar MENOS peças que o pedido e o `valor_faturado` não tiver vindo, o
app mostra "faturado em partes" e **não** afirma que o resto foi cortado — é o
`valor_faturado` que fecha a conta. `produto` é o mesmo código que o
`GET /pedidos` manda; a peça que não casar com o catálogo é guardada assim
mesmo, com aviso.

Com o canal de faturamento em `api`, o botão manual de "faturado" some do app
para todo mundo (financeiro, administrador, venda interna): o carimbo só entra
e só sai por esta rota.

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

## 5. Catálogo — o Control manda tabelas, condições, produtos, preços e estoque

Cinco rotas, todas com o canal de catálogo ligado para a API
(`409 CANAL_FECHADO`), corpo `{ "<nome>": [...] }`, `{ "dados": [...] }` ou a
lista pura (`tabelas-preco` aceita também `{ "tabelas": [...] }` e
`condicoes-pagamento`, `{ "condicoes": [...] }`), no máximo 1000 registros por
requisição, e a mesma resposta:

```json
{ "ok": true, "recebidos": 120, "criados": 3, "atualizados": 40, "sem_mudanca": 77,
  "ignorados": [ { "codigo": "0706", "motivo": "produto não encontrado no app" } ],
  "avisos": [], "servidor_hora": "2026-09-16T14:00:00.000Z" }
```

Regras que valem para as cinco: **campo que não veio não mexe; `null` explícito
limpa; sem mudança nada é gravado** (conta em `sem_mudanca`; reenviar o lote
inteiro a cada 30 minutos é inofensivo); registro com problema volta em
`ignorados` com o motivo e o resto grava; `data_update`, quando vem, é um
momento **com fuso** (sem fuso o registro é ignorado; ausente = agora);
códigos casam pelo **miolo** (`7`, `07` e `00007` são a mesma tabela). Envie
**tabelas e produtos antes de preços e estoque**: preço de tabela ou produto
que o app não tem, e estoque de tamanho fora da grade, voltam como ignorados.
Nada é apagado por estas rotas.

### POST /partner/v1/tabelas-preco

`{ "tabelas_preco": [ { "codigo", "descricao", "coluna", "ativo", "data_update" } ] }`

| Campo | Precisa? | Observação |
|---|---|---|
| `codigo` | **Sim** | Código da tabela no ERP (chave, pelo miolo) |
| `descricao` | Não | A descrição do Control. Fica guardada **numa coluna própria** — o nome que o app mostra ao representante não é regravado |
| `coluna` | Na tabela nova | A coluna de preço (1 a 6). Fora disso o registro é ignorado; tabela nova sem coluna nasce com 1 e volta um aviso |
| `ativo` | Não | `S`/`N`, `true`/`false`. Tabela nova nasce ativa |
| `data_update` | Não | Quando mudou no ERP, com fuso |

Motivos de `ignorados`: `registro inválido`, `sem código do ERP`, `código
repetido no lote`, `código com mais de uma tabela no app`, `"coluna" precisa
ser um inteiro de 1 a 6`, `"data_update" não é uma data ISO`, `"data_update"
precisa de fuso (Z ou -03:00)`, `falha ao gravar: …`. Avisos: tabela nova sem
coluna (gravada com 1), `ativo` não reconhecido, e o aviso fixo da 049.

**Exemplo:**

```json
POST /partner/v1/tabelas-preco
{ "tabelas_preco": [
  { "codigo": "00007", "descricao": "ATACADO SUDESTE", "coluna": 1, "ativo": "S", "data_update": "2026-09-16T08:00:00-03:00" },
  { "codigo": "00012", "descricao": "PROMOCIONAL", "coluna": 3, "ativo": "N" }
] }
```

```json
{ "ok": true, "recebidos": 2, "criados": 1, "atualizados": 1, "sem_mudanca": 0,
  "ignorados": [], "avisos": [], "servidor_hora": "2026-09-16T11:00:00.000Z" }
```

### POST /partner/v1/condicoes-pagamento

`{ "condicoes_pagamento": [ { "codigo", "descricao", "ativo", "valor_minimo", "data_update" } ] }`

| Campo | Precisa? | Observação |
|---|---|---|
| `codigo` | **Sim** | Código numérico da condição no Control (`"015"` e `15` são a mesma). Não numérico é ignorado |
| `descricao` | Na condição nova | A descrição (`"30/60/90"`). Na condição que já existe vai para a coluna própria do Control — o texto que o app mostra não é regravado |
| `ativo` | Não | `S`/`N`, `true`/`false`. Condição inativa some do seletor do pedido |
| `valor_minimo` | Não | O menor pedido que a condição aceita (número ou `"1.500,50"`). `null` limpa; negativo ou ilegível não mexe e avisa |
| `data_update` | Não | Com fuso |

Motivos: `registro inválido`, `sem código do ERP`, `código da condição precisa
ser numérico`, `código repetido no lote`, `código com mais de uma condição no
app`, `sem descrição` (só na nova), `"data_update" não é uma data ISO` /
`"data_update" precisa de fuso (Z ou -03:00)`, `falha ao gravar: …`. Avisos:
`ativo` não reconhecido, `valor_minimo` negativo ou ilegível, e o fixo da 049.

**Exemplo:**

```json
POST /partner/v1/condicoes-pagamento
{ "condicoes_pagamento": [
  { "codigo": "021", "descricao": "30/60/90", "ativo": "S", "valor_minimo": 1500.00 },
  { "codigo": "099", "descricao": "A VISTA", "ativo": "N", "valor_minimo": null }
] }
```

```json
{ "ok": true, "recebidos": 2, "criados": 0, "atualizados": 2, "sem_mudanca": 0,
  "ignorados": [], "avisos": [], "servidor_hora": "2026-09-16T11:00:00.000Z" }
```

### POST /partner/v1/produtos

`{ "produtos": [ { "codigo", "referencia", "nome", "grupo", "colecao", "marca", "ativo", "tamanhos": [ { "tamanho", "ativo" } ], "data_update" } ] }`

| Campo | Precisa? | Observação |
|---|---|---|
| `codigo` | **Sim** | Código do produto no ERP (chave). Produto que já existia no app **sem código** (carregado do PDF do catálogo) e tem a mesma `referencia` é *adotado*: aprende o código em vez de nascer duplicado |
| `referencia` | Recomendado | A referência do catálogo. Vira a referência do app só quando o produto nasce (ou está sem) |
| `nome` | No produto novo | `null` **não** apaga o nome |
| `grupo`, `colecao`, `marca` | Não | `null` limpa |
| `ativo` | Não | `S`/`N`, `true`/`false` |
| `tamanhos` | Não | A grade. Tamanho que falta no app é criado (estoque 0); o que já existe só troca `ativo`. **Tamanho que não veio não é desativado** — para tirar um tamanho, mande-o com `ativo: "N"` |
| `data_update` | Não | Com fuso |

A resposta traz também `tamanhos_criados` e `tamanhos_atualizados`. Motivos:
`registro inválido`, `sem código do ERP`, `código repetido no lote`, `código
com mais de um produto no app`, `sem nome` (só no novo), `"data_update" não é
uma data ISO` / `"data_update" precisa de fuso (Z ou -03:00)`, `falha ao
gravar: …`. Avisos: tamanho que não deu para gravar (o produto foi gravado),
entrada de `tamanhos` sem tamanho ou repetida, produtos que existiam sem código
e aprenderam o do Control, `ativo` não reconhecido, e o fixo da 049. Foto,
descrição e cores do catálogo são do app: esta rota nunca as toca.

**Exemplo:**

```json
POST /partner/v1/produtos
{ "produtos": [
  { "codigo": "0706", "referencia": "0706", "nome": "CONJUNTO TESTE", "grupo": "CONJUNTOS",
    "colecao": "VERAO 2027", "marca": "CORPO SENSUAL", "ativo": "S",
    "tamanhos": [ { "tamanho": "P" }, { "tamanho": "M" }, { "tamanho": "G" }, { "tamanho": "GG", "ativo": "N" } ],
    "data_update": "2026-09-16T08:00:00-03:00" }
] }
```

```json
{ "ok": true, "recebidos": 1, "criados": 0, "atualizados": 1, "sem_mudanca": 0,
  "tamanhos_criados": 1, "tamanhos_atualizados": 1,
  "ignorados": [], "avisos": [], "servidor_hora": "2026-09-16T11:00:00.000Z" }
```

### POST /partner/v1/precos

`{ "precos": [ { "tabela", "produto", "preco", "preco_faixa_maior", "preco_original", "desconto_percentual", "data_update" } ] }`

| Campo | Precisa? | Observação |
|---|---|---|
| `tabela` | **Sim** | Código da tabela de preço no ERP (miolo) |
| `produto` | **Sim** | Código do produto no ERP (miolo) |
| `preco` | **Sim** | O preço que vale nessa tabela — **sobrescreve** o que estava (inclusive o da carga do PDF). Zero ou negativo é ignorado; não há como apagar um preço pela API |
| `preco_faixa_maior` | Recomendado | O preço dos tamanhos da **faixa maior** (EG/XG e 48 a 54) nessa tabela — o pedido cobra esse valor nesses tamanhos. `null` = não há preço diferente: todo tamanho paga `preco`. **Ausente não mexe**: se a carga do PDF tinha deixado um preço de faixa maior, ele continua valendo e volta um aviso com o produto. Zero ou negativo não mexe e avisa |
| `preco_original` | Não | O preço antes do desconto do ERP (informativo) |
| `desconto_percentual` | Não | 0 a 100 (informativo) |
| `data_update` | Não | Com fuso |

Motivos: `registro inválido`, `sem código do produto`, `sem código da tabela`,
`repetido no lote (tabela X)`, `"preco" precisa ser um número maior que zero`,
`tabela X não encontrada no app`, `tabela X com mais de um cadastro no app`,
`produto não encontrado no app`, `produto com mais de um cadastro no app`,
`"data_update" não é uma data ISO` / `"data_update" precisa de fuso (Z ou
-03:00)`, `falha ao gravar: …`. Os avisos apontam a rota que cadastra o que
faltou (`POST /tabelas-preco`, `POST /produtos`), `preco_original`,
`desconto_percentual` ou `preco_faixa_maior` ilegíveis, o preço da faixa maior
que continua o de antes (mande `preco_faixa_maior`, ou `null`), e o fixo da 049.

**Exemplo:**

```json
POST /partner/v1/precos
{ "precos": [
  { "tabela": "00007", "produto": "0706", "preco": 89.90, "preco_faixa_maior": 99.90, "preco_original": 99.90, "desconto_percentual": 10 },
  { "tabela": "00007", "produto": "0999", "preco": 55.00 }
] }
```

```json
{ "ok": true, "recebidos": 2, "criados": 0, "atualizados": 1, "sem_mudanca": 0,
  "ignorados": [ { "codigo": "0999", "motivo": "produto não encontrado no app" } ],
  "avisos": [ "Produto sem cadastro no app (mande-o em POST /partner/v1/produtos): 0999." ],
  "servidor_hora": "2026-09-16T11:00:00.000Z" }
```

### POST /partner/v1/estoque

`{ "estoque": [ { "produto", "tamanho", "quantidade", "reservado" } ] }`

| Campo | Precisa? | Observação |
|---|---|---|
| `produto` | **Sim** | Código do produto no ERP (miolo) |
| `tamanho` | **Sim** | O tamanho, como está na grade (`P`, `M`, `G`, `48`…) |
| `quantidade` | **Sim** | Estoque de prateleira, inteiro — **sobrescreve**; negativo é aceito como o ERP conta |
| `reservado` | Não | Reservado em pedidos, inteiro. Ausente não mexe; `null` zera |

Motivos: `registro inválido`, `sem código do produto`, `sem tamanho`, `repetido
no lote`, `"quantidade" precisa ser um número inteiro`, `"reservado" precisa ser
um número inteiro`, `produto não encontrado no app`, `produto com mais de um
cadastro no app`, `tamanho não encontrado na grade do app` (mande o tamanho em
`POST /produtos` antes), `falha ao gravar: …`. No estoque `criados` é sempre
`0` (a grade nasce em `POST /produtos`); `ignorados[].codigo` sai como
`PRODUTO|TAMANHO`.

**Exemplo:**

```json
POST /partner/v1/estoque
{ "estoque": [
  { "produto": "0706", "tamanho": "M", "quantidade": 42, "reservado": 5 },
  { "produto": "0706", "tamanho": "G", "quantidade": 0 }
] }
```

```json
{ "ok": true, "recebidos": 2, "criados": 0, "atualizados": 2, "sem_mudanca": 0,
  "ignorados": [], "avisos": [], "servidor_hora": "2026-09-16T11:00:00.000Z" }
```

**Avisos "migração 049":** numa instalação onde a migração 049 ainda não rodou,
descrição do Control, `ativo` e `data_update` das tabelas, `valor_minimo` das
condições, `preco_original`/`desconto_percentual` e a data do estoque ficam de
fora, e o lote volta com um aviso fixo dizendo isso; o resto grava normalmente.

---

## 6. Retrato do cliente — última compra, total comprado, vencido e pendência

```
POST /partner/v1/retrato
Content-Type: application/json

{ "retrato": [
  { "cnpj": "00.000.000/0001-00", "codigo": "01234",
    "ultima_compra": "2026-09-10", "total_comprado": 18450.30,
    "valor_vencido": 0, "titulos_vencidos": 0, "pendencia_financeira": 0,
    "referencia": "2026-09-16T03:00:00-03:00" }
] }
```

Exige o canal de retrato ligado para a API. Uma vez por dia é o suficiente. O
cliente é achado **primeiro pelo CNPJ** (com ou sem pontuação), depois pelo
`codigo`; informe pelo menos um dos dois. A exceção é o CPF/CNPJ corrigido no
app e ainda não trocado no seu ERP: o retrato com o documento antigo casa pelo
`codigo` (mande os dois), mesmo que outro cadastro do app tenha esse documento
(com o cliente ainda sem código no app e o documento hoje noutro cadastro sem
código, o retrato não tem como decidir e volta em `ignorados` — ver "Cliente
editado no app").

| Campo | Precisa? | Observação |
|---|---|---|
| `referencia` | **Sim** | De quando é o retrato, momento **com fuso**. Retrato com referência mais antiga que a guardada é ignorado |
| `ultima_compra` | Não | `AAAA-MM-DD` ou momento com fuso. **Só anda para frente**; `null` não mexe |
| `total_comprado` | Não | R$ acumulado (número ou texto numérico) |
| `valor_vencido` | Não | R$ vencido |
| `titulos_vencidos` | Não | Quantidade de títulos vencidos (inteiro, ≥ 0) |
| `pendencia_financeira` | Não | R$ em aberto que o financeiro precisa ver |

Um valor ilegível ou negativo recusa **o registro inteiro** (motivo fixo).
Retrato igual ao guardado conta em `sem_mudanca`. Resposta:
`{ ok, recebidos, atualizados, sem_mudanca, ignorados: [{ cliente, motivo }], avisos, servidor_hora }`.
Motivos: `registro inválido`, `informe "cnpj" ou "codigo"`, `CNPJ com mais de
um cadastro no app`, `código com mais de um cadastro no app`, `CNPJ corrigido
no app num cliente sem código e hoje de outro cadastro sem código — confira
qual dos dois é este cliente`, `cliente não encontrado nesta empresa`, `cliente repetido no lote`, `referência mais antiga
que o retrato guardado`, `falha ao gravar: …`, e os de valor: `"referencia" é
obrigatória (momento com fuso, …)`, `"referencia" não é uma data ISO`,
`"referencia" precisa de fuso (Z ou -03:00)`, `"ultima_compra" precisa ser
AAAA-MM-DD ou um momento com fuso (Z ou -03:00)`, `"total_comprado" precisa ser
um número maior ou igual a zero` (idem `valor_vencido` e
`pendencia_financeira`), `"titulos_vencidos" precisa ser um inteiro maior ou
igual a zero`. Avisos fixos: numa instalação sem a migração 036, última compra,
total e vencido ficam de fora; sem a 049, pendência, títulos e a referência.

**Resposta do exemplo acima:**

```json
{ "ok": true, "recebidos": 1, "atualizados": 1, "sem_mudanca": 0,
  "ignorados": [], "avisos": [], "servidor_hora": "2026-09-16T06:00:10.000Z" }
```

**O bloqueio do Control não trava o representante.** Cliente bloqueado
(`bloqueado: "S"` no `POST /clientes`) continua podendo receber pedido no app;
o que o Control manda — o motivo do bloqueio, a pendência financeira e os
títulos vencidos — fica guardado no cadastro e é o que o financeiro vê na hora
de decidir o pedido.

---

## 7. Sincronizar agora — o botão da tela e o aviso de concluída

A tela "Integração" do app (financeiro e administrador) tem o botão **"Pedir
sincronização agora"**. Ele grava um pedido, e a partir daí `GET /status`
responde `"sincronizar_agora": true` com `"solicitado_em"`. O que o seu ERP
faz: roda a rodada inteira (fila, cadastros nas duas mãos, faturamento,
catálogo, retrato) e avisa:

```
POST /partner/v1/sincronizacao
Content-Type: application/json

{ "concluida": true, "solicitado_em": "2026-09-16T14:00:00.000Z" }
```

**Resposta 200:**

```json
{ "ok": true, "limpo": true, "sincronizar_agora": false, "solicitado_em": null,
  "servidor_hora": "2026-09-16T14:06:30.000Z" }
```

| Resposta | `code` | Significado |
|---|---|---|
| `200 { ok, limpo, sincronizar_agora, solicitado_em, servidor_hora }` | — | `limpo: true` = o pedido pendente foi apagado. `sincronizar_agora: true` na resposta = já há um pedido **novo** (alguém clicou de novo enquanto você rodava), e `solicitado_em` é o momento dele: rode de novo |
| `400` | `MISSING_CONCLUIDA` | Falta `"concluida": true` |
| `400` | `INVALID_SOLICITADO_EM` | `solicitado_em` veio sem fuso ou fora do formato |

`solicitado_em` é opcional, mas mande o que veio no `/status`: um pedido mais
novo que ele fica de pé. Sem pedido pendente a rota responde `200` sem gravar
nada (repetir é seguro). Funciona com qualquer canal. **Enquanto o Control não
chamar esta rota, `sincronizar_agora` continua `true` — por até 15 minutos.**
Passado isso o pedido expira: o `/status` devolve `sincronizar_agora: false`
(com o `solicitado_em` do pedido expirado), a tela do app mostra "pedido
expirado" e quem pediu pode pedir de novo.

---

## Códigos de erro (todas as rotas)

Toda resposta de erro tem o formato `{ "error": "<mensagem>", "code":
"<CODIGO>", "statusCode": <n> }`, mais campos extras quando indicado.

| HTTP | `code` | Onde | Quando |
|---|---|---|---|
| `503` | `PARTNER_API_DISABLED` | todas | A integração ainda não foi liberada naquele servidor (nenhuma chave configurada) |
| `401` | `PARTNER_UNAUTHORIZED` | todas | Chave ausente ou errada no `X-API-Key` — inclusive a chave de uma marca na URL da outra |
| `409` | `CANAL_FECHADO` | todas as rotas com canal (ver "Canal por empresa") | O canal da sua empresa não está ligado para a API (`canal`, `valor_atual`) |
| `400` | `INVALID_DESDE` | `GET /pedidos`, `GET /pedidos/excluidos`, `GET /clientes`, `GET /representantes` | `desde` não é uma data ISO (fora do `GET /pedidos`, também sem fuso) |
| `400` | `MISSING_PEDIDO_ERP` | `POST /confirmar`, `POST /conciliar` | Corpo sem `pedido_erp`, ou `pedido_erp` vazio / que não é texto (o corpo vazio é o caso de `INTERNAL_ERROR` 400, abaixo) |
| `400` | `INVALID_PEDIDO_ERP` | `POST /confirmar`, `POST /conciliar` | Número fora do formato (duas letras e até 10 dígitos) |
| `404` | `ORDER_NOT_FOUND` | `POST /confirmar`, `POST /conciliar`, `POST /excluir` | Não há pedido com esse `id` na sua empresa (inclusive `id` fora do formato UUID) |
| `409` | `ORDER_INVOICED` | `POST /excluir` | Pedido faturado não é excluído; desfaça o faturamento antes |
| `409` | `ORDER_NOT_IN_CONTROL` | `POST /excluir` | Pedido sem número do Control e não solicitado (ou de solicitação cancelada): o app não o exclui |
| `500` | `SEM_COPIA` | `POST /excluir` | A cópia do histórico não gravou; o pedido **não** foi apagado — tente de novo |
| `400` | `MISSING_CONCLUIDA` | `POST /sincronizacao` | Falta `"concluida": true` |
| `400` | `INVALID_SOLICITADO_EM` | `POST /sincronizacao` | `solicitado_em` sem fuso ou fora do formato |
| `409` | `ORDER_ALREADY_CONFIRMED` | `POST /confirmar`, `POST /conciliar` | Já tem outro número (`pedido_erp_atual`) |
| `409` | `ORDER_NOT_APPROVED` | `POST /confirmar` | A situação do pedido não aceita confirmação (`situacao`) |
| `409` | `ORDER_NOT_REQUESTED` | `POST /confirmar` | Aprovado que o financeiro nunca solicitou ao Control (o de solicitação cancelada é aceito) |
| `409` | `ORDER_NOT_RECONCILABLE` | `POST /conciliar` | Só pedido `sent_erp` sem número é conciliado (`situacao`) |
| `409` | `ERP_NUMBER_IN_USE` | `POST /confirmar`, `POST /conciliar` | Número já gravado em outro pedido (`pedido_em_uso`) |
| `400` | `INVALID_BODY` | `POST` de lista | O corpo não é uma lista nem `{ "<nome da rota>": [...] }` (`faturamento`, `clientes`, `representantes`, `tabelas_preco`, `condicoes_pagamento`, `produtos`, `precos`, `estoque`, `retrato`) nem `{ "dados": [...] }` |
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

# mandar o catálogo (mesmo formato nas cinco rotas)
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"tabelas_preco\":[{\"codigo\":\"00007\",\"descricao\":\"ATACADO\",\"coluna\":1,\"ativo\":\"S\"}]}" \
  "$BASE/partner/v1/tabelas-preco"

# o retrato do cliente (1x por dia)
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"retrato\":[{\"cnpj\":\"00000000000100\",\"ultima_compra\":\"2026-09-10\",\"total_comprado\":18450.30,\"valor_vencido\":0,\"referencia\":\"2026-09-16T06:00:00-03:00\"}]}" \
  "$BASE/partner/v1/retrato"

# puxar o que mudou no app (fuso positivo vai como %2B)
curl -H "X-API-Key: SUA_CHAVE" "$BASE/partner/v1/clientes?desde=2026-09-16T13:00:00-03:00"

# avisar que a passada pedida pelo "sincronizar agora" foi feita
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"concluida\":true,\"solicitado_em\":\"2026-09-16T14:00:00.000Z\"}" \
  "$BASE/partner/v1/sincronizacao"
```

## Boas práticas

- Consulte a fila a cada 1 minuto (a chamada é leve): o financeiro fica
  olhando a tela esperando o número chegar. Os outros intervalos estão em
  "Fluxo recomendado"; e quando `GET /status` disser `sincronizar_agora: true`,
  rode tudo já e avise com `POST /sincronizacao`.
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
- A migração 049 (pedido solicitado ao Control, nota substituída, e-mail do
  Control no representante, retrato e pendência financeira, colunas do
  catálogo) precisa estar nos dois bancos, **depois** da 048: colar
  `_tools/SQL-PARA-RODAR-049.sql` e conferir com `node _tools/conferir-049.mjs`
  (e `node _tools/conferir-049.mjs <raiz da PLUMENE>`). Sem ela, a fila é a de
  antes (todo aprovado sem número), o "sincronizar agora" não existe e os
  campos novos do catálogo/retrato voltam com aviso.
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

**Fluxo recomendado:** a cada ~5 minutos, envie os clientes e os representantes
que mudaram (em lotes de até 500) **e puxe** o que mudou no app com
`GET /clientes?desde=` e `GET /representantes?desde=` (seções abaixo). Clientes:
casamento **primeiro pelo CNPJ, depois pelo código do ERP** — quem já existe é
atualizado, quem não existe é criado; o cliente que nasceu no app (sem código)
recebe o código que você mandar. Representantes: só atualização de quem já tem
login (ver abaixo). Nada é apagado. As quatro rotas exigem o canal de cadastro
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
- **O CNPJ é a chave entre os sistemas.** O cliente é procurado primeiro pelo
  CNPJ/CPF (só dígitos), depois pelo miolo do código: `#2225`, `2225` e `02225`
  são o mesmo cadastro. Cliente achado pelo CNPJ **sem código** recebe o código
  que veio; cliente que já tem código **nunca** tem o código reescrito (código
  diferente vira aviso). Dois registros do mesmo lote com o mesmo miolo ou o
  mesmo CNPJ: vale o primeiro, o segundo volta em `ignorados` (`código repetido
  no lote` / `CNPJ repetido no lote`).
- **Máximo 1000 por requisição** (recomendado 500). Acima de 1000 →
  `400 BATCH_TOO_LARGE`. Divida em lotes.
- **Datas e números** no padrão JSON. CNPJ/telefone podem vir com ou sem
  pontuação.
- **Bloquear** um cliente é mandar `bloqueado: "S"` (com `motivo_bloqueio`);
  desativar um representante é `ativo: "N"`. O app **nunca apaga** — cliente tem
  histórico de pedidos preso a ele. **O bloqueio não trava o representante:** o
  cliente bloqueado continua na lista e pode receber pedido; o motivo, a
  pendência financeira e os títulos vencidos que vierem ficam no cadastro para o
  financeiro ver na hora de decidir.
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
- **A edição do cadastro feita no app não é apagada** (a partir de
  17/09/2026). Razão social, nome fantasia, CNPJ/CPF, inscrição estadual,
  WhatsApp, e-mail, observações e endereço também podem ser editados no app;
  enquanto a edição não chega ao seu ERP, o cliente sai no
  `GET /clientes?desde=` com `alterado_no_app`, e o `POST /clientes` **não
  sobrescreve** esses campos com outro valor — ver "Cliente editado no app"
  abaixo.

## POST /partner/v1/clientes

Corpo: `{ "clientes": [ ... ] }`, `{ "dados": [ ... ] }` ou a lista pura.

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do cliente no ERP. Cliente novo é gravado com 5 dígitos (`900` → `00900`); o código de quem já existe nunca é reescrito. É o que o app devolve em `cliente.codigo_erp` |
| `razao_social` | texto | **Sim** | Sem ela o registro volta em `ignorados` |
| `nome_fantasia` | texto | Não | — |
| `cnpj_cpf` | texto | **Sim, na prática** | 11 (CPF) ou 14 (CNPJ) dígitos, com ou sem pontuação. **É a chave entre os sistemas:** o cliente é procurado primeiro por ele. Um cliente que já existia no app **sem código** e com esse CNPJ é *adotado*: recebe o código e não vira cadastro duplicado (é assim que o cliente novo do `GET /pedidos` — `novo_no_control: true` — ganha o código que você criou) |
| `representante` | texto | **Sim, na prática** | Código do rep no ERP, gravado com 5 dígitos (`779` → `00779`). Fica no cliente, sai no pedido como `representante_erp` e é o que faz o cliente aparecer para o representante que tem esse código no login do app. `null` tira o cliente da carteira |
| `tabela_preco` | texto | Recomendado | Código da tabela no ERP, casado pelo miolo. Código que não casa com nenhuma tabela **não mexe** na tabela do cliente e volta em `avisos`; `null` limpa |
| `endereco` | objeto ou texto | Recomendado | `{ logradouro, numero, complemento, bairro, cidade, uf, cep }` ou um texto pronto. Em objeto, cada pedaço que veio é guardado no seu campo (onde a instalação já tem os campos; `cep` só com dígitos, `uf` em maiúscula) e a linha de texto é remontada com o que ficou; pedaço ausente não mexe, `null` limpa aquele pedaço. Onde a instalação ainda não tem esses campos, só a linha é gravada, montada com o que veio (e volta um aviso). Em texto, só a linha. `endereco: null` limpa o endereço inteiro |
| `inscricao_estadual` | texto | Não | Guardada onde a instalação já tem o campo (senão, aviso). `null` limpa |
| `observacoes` | texto | Não | Idem |
| `bloqueado` | `"S"`/`"N"` | Não | `S`, `SIM`, `1` ou `true` bloqueia; `N`, `NÃO`, `0` ou `false` desbloqueia; `null` desbloqueia; ausente não mexe; outro valor não mexe e dá aviso. **O bloqueio não impede o pedido** — aparece como selo para o representante e como aviso para o financeiro |
| `motivo_bloqueio` | texto | Não | O motivo do bloqueio no Control. `null` limpa |
| `pendencia_financeira` | número ou texto | Não | R$ em aberto (`1500.5` ou `"1.500,50"`). `null` limpa; negativo ou ilegível não mexe e dá aviso |
| `titulos_vencidos` | inteiro | Não | Quantos títulos vencidos. `null` limpa |
| `limite_credito` | número ou texto | Não | `1500.5` ou `"1.500,50"`. `null` limpa; negativo ou ilegível não mexe e dá aviso |
| `whatsapp` | texto | Não | Com DDD. `null` limpa |
| `email` | texto | Não | `null` limpa |
| `data_update` | data ISO | Não | Quando o cadastro mudou no ERP (`DATA_UPDATE`), **com fuso**. Informativo: é conferido (sem fuso volta em `avisos`), mas **não é gravado e não conta como mudança** — o mesmo cadastro com outro `data_update` é `sem_mudanca`. O carimbo que evita o eco no `GET /clientes?desde=` é o momento em que o app gravou o registro |

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
`sem razão social`, `código repetido no lote`, `CNPJ repetido no lote`, `código
com mais de um cadastro no app`, `CNPJ com mais de um cadastro no app`,
`cadastro já atualizado por outro registro do lote`, `CNPJ já é do cliente de
código X no app` (o CNPJ achou um cadastro que já tem **outro** código: nada é
gravado — nem nome, nem representante, nem tabela; confira o cadastro
duplicado no ERP), `cadastro alterado no app durante o envio — reenvie` (alguém
salvou a ficha desse cliente no app enquanto o lote era gravado: nada do
registro foi gravado, para não apagar a edição; reenvie na próxima rodada, e a
edição já vem conferida — ver "Cliente editado no app"; vale também para o
cliente sem código que o registro adotaria pelo CNPJ), `CNPJ corrigido no app
num cliente sem código e hoje de outro cadastro sem código — confira qual dos
dois é este cliente` (ver "Cliente editado no app": nada é gravado em nenhum
dos dois) ou `falha ao gravar: …`.
`avisos` traz, em texto, o que passou mas merece conferência: tabelas de preço
não encontradas (ou nenhuma tabela com código do ERP, ou código usado por mais
de uma tabela), clientes casados pelo CNPJ, código de representante sem
login no app ou gravado numa grafia diferente da do login, valores de
`bloqueado`, `limite_credito` ou `pendencia_financeira` não entendidos,
`data_update` sem fuso, campos que a instalação ainda não guarda e campos
editados no app que o seu ERP ainda não tem (abaixo).

### Cliente editado no app — a edição não é apagada

O escritório e o representante podem corrigir no app o cadastro de um cliente
que **já tem código** no seu ERP: `razao_social`, `nome_fantasia`, `cnpj_cpf`,
`inscricao_estadual`, `whatsapp`, `email`, `observacoes` e `endereco`. Até o seu
ERP ter o mesmo valor, a edição fica **pendente** no app (o financeiro vê a
fila) e o cliente sai no `GET /clientes?desde=` com `alterado_no_app` dizendo
quais campos.

No `POST /clientes`, para cada campo com edição pendente que vier no registro:

- **mesmo valor do app** → a edição chegou ao seu ERP: o app a dá por
  atualizada sozinho (sai da fila do financeiro). A comparação ignora
  pontuação no CNPJ/CPF e no CEP, maiúscula na UF, espaços em volta e o tipo de
  quebra de linha (`\r\n` = `\n`); `""` (o CHAR nulo do Firebird) conta como
  campo **vazio** no seu ERP. O valor do app é o **atual** — o da edição mais
  recente do campo —, mesmo quando uma edição mais nova já foi dada por
  atualizada e uma mais antiga ainda espera outro campo;
- **valor diferente** → o campo **não é gravado** (o app mantém o que a pessoa
  editou) e volta um aviso por cliente:
  `Cliente 01234: whatsapp, endereco alterados no app ainda não aplicados no Control — mantido o valor do app.`
  (até 20 clientes por resposta; o resto num aviso "E mais N cliente(s)…").
  O que fazer: aplicar no seu ERP o valor que o `GET /clientes` traz para esse
  cliente e reenviar;
- **campo ausente** → nada a conferir; a edição continua pendente.

O **endereço é um grupo**: as peças (e a linha pronta) chegam juntas. Um pedaço
diferente do app — editado ou não — deixa o endereço inteiro de fora; a edição
só é dada por atualizada quando cada pedaço editado no app vem no objeto com o
mesmo valor (ou a linha pronta vem igual à do app). Os outros campos do mesmo
registro (representante, tabela, bloqueio, pendência…) seguem as regras de
sempre. Uma edição com vários campos só sai da fila quando **todos** chegaram.

**Cliente sem código casado pelo CNPJ.** O cliente que nasceu no app pode ser
corrigido no app depois de o seu ERP já o ter puxado (`novo_no_control`) e
antes de o código voltar no `POST /clientes`. Na adoção pelo CNPJ, essas
correções são conferidas como as pendentes: campo igual, nada a fazer; campo
**diferente** não é gravado, volta o aviso de sempre e a correção passa a sair
em `alterado_no_app` (e na fila do financeiro) até o seu ERP ter o mesmo valor.
Campo **ausente** do registro da adoção também: a adoção é a única conferência
dessas correções, então a que o registro não mostrou que o seu ERP tem passa a
sair em `alterado_no_app` e fecha sozinha no primeiro envio com o mesmo valor.

**CPF/CNPJ trocado no app.** Enquanto `cnpj_cpf` está em `alterado_no_app`, o
registro que ainda vem com o documento **antigo** casa pelo `codigo` — mesmo que
outro cadastro do app tenha esse documento (é comum: a troca corrige um CNPJ que
era de outra loja) — e o documento do app é mantido, com o aviso de sempre. E a
`chave` desse cliente no `GET /clientes` e no `GET /pedidos` **já é o documento
novo**: para achar o cadastro no seu ERP, case pelo `codigo`, não pela `chave`.

Vale também quando a troca aconteceu **antes de o código voltar** (o cliente
ainda estava sem código no app): o registro que traz o código com o documento
**antigo** adota esse cadastro — nunca cria um segundo — e a correção passa a
sair em `alterado_no_app`, mesmo que outro cadastro do app tenha hoje esse
documento com outro código. Se quem tem o documento hoje também está **sem
código**, os dois podem ser o cliente que o seu ERP puxou: a `razao_social` do
registro decide (igual à de um só dos dois); sem como decidir, o registro volta
em `ignorados` (`CNPJ corrigido no app num cliente sem código e hoje de outro
cadastro sem código — confira qual dos dois é este cliente`) e nada é gravado.
O mesmo no `POST /retrato`: o retrato com o documento antigo acha o cliente em
vez de "cliente não encontrado nesta empresa" — e, como o retrato não traz a
razão social, com o documento hoje noutro cadastro sem código ele volta com esse
motivo.

Numa instalação sem a migração 051 nada disto existe: o `POST /clientes` grava
como sempre gravou.

## POST /partner/v1/representantes

Corpo: `{ "representantes": [ ... ] }`, `{ "dados": [ ... ] }` ou a lista pura.

| Campo | Tipo | Precisa? | Observação |
|---|---|---|---|
| `codigo` | texto | **Sim** | Código do rep no ERP. Casa pelo miolo com o código atribuído ao login no app (`0779`, `779` e `00779` são o mesmo), dentro da sua empresa |
| `nome` | texto | **Sim** | Sem ele o registro volta em `ignorados` |
| `razao_social` | texto | Não | Gravada na razão social do representante. `null` limpa |
| `email` | texto | Não | Guardado como **o e-mail do Control** do representante (coluna própria; `null` limpa). **Nunca troca o login:** o e-mail de acesso ao app só muda pelas telas. Numa instalação sem a migração 049, é ignorado com o aviso `e-mail do Control não troca o login do representante` |
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

## GET /partner/v1/clientes?desde= — o que mudou no app

```
GET /partner/v1/clientes
GET /partner/v1/clientes?desde=2026-09-16T13:00:00-03:00
```

A outra mão: o que o representante ou o escritório mudou no cadastro do
cliente **dentro do app** (cliente novo, WhatsApp, endereço, tabela trocada),
para o seu ERP espelhar. `desde` é opcional e precisa de fuso (sem fuso,
`400 INVALID_DESDE`; fuso positivo vai na URL como `%2B`). Sem `desde`, vem
tudo. Exige o canal de cadastro ligado para a API.

Cada cliente sai **no mesmo formato do `POST /clientes`** — você pode devolver o
registro como veio — mais estes campos só de leitura:

| Campo | Significado |
|---|---|
| `codigo` | O código no Control; **`null` = nasceu no app** e ainda não tem código |
| `chave` | O CNPJ/CPF só com dígitos (a chave entre os sistemas) |
| `novo_no_control` | `true` = crie o cadastro no seu ERP e devolva o código pelo `POST /clientes` (casando pelo CNPJ) |
| `bloqueado`, `motivo_bloqueio`, `limite_credito`, `whatsapp`, `email`, `endereco`, `inscricao_estadual`, `observacoes`, `representante`, `tabela_preco` | Como no POST (`bloqueado` sai `"S"`/`"N"`; `tabela_preco` é o código da tabela no ERP) |
| `pendencia_financeira`, `titulos_vencidos` | O que o próprio Control mandou por último |
| `atualizado_em` | Quando mudou no app |
| `atualizado_pelo_control_em` | Quando o Control mandou pela última vez |
| `alterado_no_app` | `{ "em": ISO, "campos": [...] }` ou `null`. O cadastro foi **editado no app** e o seu ERP ainda não tem a edição: `campos` usa os nomes deste contrato (`razao_social`, `nome_fantasia`, `cnpj_cpf`, `inscricao_estadual`, `whatsapp`, `email`, `observacoes`, `endereco`) e `em` é a edição mais recente. Aplique os valores deste registro nesses campos. `null` = nada pendente (ou a instalação ainda sem a migração 051). Sai sempre — campo novo, aditivo |

**Edição do app pendente sai até chegar ao seu ERP.** O cliente com
`alterado_no_app` sai em **toda** puxada — mesmo com um `desde` depois da
edição, e mesmo que nada mais tenha mudado nele — enquanto o `POST /clientes`
não trouxer o mesmo valor (ver "Cliente editado no app"). O `POST` não a apaga,
e ela deixa de aparecer assim que o valor igual chega (ou o financeiro confirma
que atualizou à mão).

**O que o próprio Control gravou por último não volta** — nem pelo
`POST /clientes`, nem pelo `POST /retrato`: o app guarda o momento de cada
gravação sua e só devolve o cliente que mudou depois dela (com alguns segundos
de folga, porque o banco carimba a alteração com a própria hora). Se o app
mexeu num cliente e você ainda não puxou, uma gravação sua nesse meio tempo
**não** esconde a mudança do app: ela continua saindo aqui — e o cliente com
`alterado_no_app` sai mesmo que a sua gravação tenha sido segundos antes da
edição. O eco é raro; se algum voltar, reenviar é `sem_mudanca`. Numa
instalação sem a migração 049 a lista traz também o que o Control acabou de
mandar, com aviso. Resposta:
`{ total, servidor_hora, clientes: [...], avisos: [...] }`.

**`servidor_hora` é a hora do app ANTES da consulta, menos 2 minutos de folga**
(desde 17/09/2026; antes era tomada depois dela). Use-a como o `desde` da
próxima puxada: uma mudança gravada enquanto a lista era lida — ainda que
confirmada pelo banco com alguns instantes de atraso — sai na puxada seguinte.
O preço é o que mudou nos últimos 2 minutos sair de novo na puxada seguinte, o
que é inofensivo (reenviar é `sem_mudanca`). A lista é paginada pela ordem
(`atualizado_em`, cliente), e não pela posição: um cliente gravado de novo
durante a leitura pode sair duas vezes, mas não empurra outro para fora. Vale
igual para o `GET /representantes`.

**Exemplo** — um cliente que o representante cadastrou no app hoje:

```json
GET /partner/v1/clientes?desde=2026-09-16T13:00:00-03:00

{
  "total": 1,
  "servidor_hora": "2026-09-16T16:05:00.000Z",
  "clientes": [
    {
      "codigo": null,
      "chave": "00000000000200",
      "novo_no_control": true,
      "razao_social": "LOJA NOVA TESTE LTDA",
      "nome_fantasia": "Loja Nova",
      "cnpj_cpf": "00.000.000/0002-00",
      "representante": "00042",
      "tabela_preco": "00007",
      "endereco": { "logradouro": "Rua Teste", "numero": "200", "complemento": null,
                    "bairro": "Centro", "cidade": "Cidade Teste", "uf": "MG", "cep": "00000000" },
      "inscricao_estadual": null,
      "observacoes": null,
      "bloqueado": "N",
      "motivo_bloqueio": null,
      "limite_credito": null,
      "whatsapp": "00900000001",
      "email": null,
      "pendencia_financeira": null,
      "titulos_vencidos": null,
      "atualizado_em": "2026-09-16T15:40:12.000+00:00",
      "atualizado_pelo_control_em": null,
      "alterado_no_app": null
    }
  ],
  "avisos": []
}
```

O seu ERP cria o cadastro, gera o código (ex.: `01235`) e devolve
`POST /clientes { "clientes": [ { "codigo": "01235", "razao_social": "LOJA NOVA TESTE LTDA", "cnpj_cpf": "00.000.000/0002-00", ... } ] }`
— o cadastro do app é casado pelo CNPJ e aprende o código.

**Exemplo** — um cliente que já está no seu ERP e teve o WhatsApp e o endereço
corrigidos no app (só os campos que importam aqui):

```json
{
  "codigo": "01234",
  "chave": "00000000000100",
  "novo_no_control": false,
  "razao_social": "CLIENTE TESTE LTDA",
  "whatsapp": "00900000009",
  "endereco": { "logradouro": "Avenida Teste", "numero": "300", "complemento": null,
                "bairro": "Centro", "cidade": "Cidade Teste", "uf": "MG", "cep": "00000000" },
  "atualizado_em": "2026-09-17T14:10:00.000+00:00",
  "alterado_no_app": { "em": "2026-09-17T14:10:00.000+00:00", "campos": ["whatsapp", "endereco"] }
}
```

O seu ERP grava o WhatsApp e o endereço e, no próximo `POST /clientes` desse
cliente com os mesmos valores, a edição sai da fila do app.

## GET /partner/v1/representantes?desde= — o que mudou no app

```
GET /partner/v1/representantes?desde=2026-09-16T13:00:00-03:00
```

Mesmas regras. Cada representante sai como
`{ codigo, nome, razao_social, email, ativo: "S"/"N", atualizado_em }`, onde
`email` é o e-mail **do Control** que você mandou (nunca o login do app). Numa
instalação sem a data de alteração do representante (migração 048) a lista vem
inteira, com aviso. Resposta:
`{ total, servidor_hora, representantes: [...], avisos: [...] }`.

```json
{
  "total": 1,
  "servidor_hora": "2026-09-16T16:05:00.000Z",
  "representantes": [
    { "codigo": "00042", "nome": "REPRESENTANTE TESTE", "razao_social": "REPRESENTACOES TESTE LTDA",
      "email": "rep.teste@exemplo.com", "ativo": "S", "atualizado_em": "2026-09-16T14:02:00.000+00:00" }
  ],
  "avisos": []
}
```

## Erros

Os códigos de todas as rotas estão na tabela **Códigos de erro** acima. Para os
cadastros valem `400 INVALID_BODY`, `400 BATCH_TOO_LARGE`, `400 INVALID_DESDE`
(nos `GET`), `401`, `503`, `409 CANAL_FECHADO` e o `500 INTERNAL_ERROR` (falha
ao ler o que já existe — nada gravado; ou, nos representantes, falha de
gravação que não é recusa do banco).

## Boas práticas (cadastros)

- Envie a cada ~5 min. Não precisa mandar todos os clientes sempre — mandar só
  os que mudaram (por `DATA_UPDATE`) deixa o lote pequeno. Campo que você não
  mandar fica como está; para limpar, mande `null`. Reenviar um cliente só
  porque o `DATA_UPDATE` mudou (por exemplo, depois de gravar o que puxou do
  `GET /clientes`) é inofensivo: sem outro campo diferente, é `sem_mudanca` e
  nada volta no `GET`.
- Na mesma rodada, puxe `GET /clientes?desde=` e `GET /representantes?desde=`
  com a hora da rodada anterior (`servidor_hora` da resposta) e crie no ERP os
  `novo_no_control`. Nos clientes com `alterado_no_app`, aplique no ERP os
  campos listados — o próximo envio com o mesmo valor fecha a pendência no app.
- Aviso `alterados no app ainda não aplicados no Control — mantido o valor do
  app` quer dizer que o seu ERP mandou o valor antigo de um campo que alguém
  corrigiu no app: o campo não foi gravado; atualize o ERP com o valor do app.
- Leia a resposta: `ignorados` e `avisos` mostram o que precisa de ajuste no
  cadastro do ERP.
- Mande as tabelas de preço por `POST /tabelas-preco` antes dos clientes, senão
  o `tabela_preco` do cliente não casa e ele entra sem tabela.

---

# Dicionário de dados — TODOS os dados da integração

Referência completa, do cadastro do cliente até o carimbo de faturado. É o
inventário de tudo que circula entre o app e o ERP, com o **dono** de cada dado
(quem cria e quem só lê). Vale a regra geral: **cada dado tem um dono único** —
o outro lado recebe cópia, nunca inventa.

## Quem é dono de cada dado

| Dado | Dono (quem cria) | O outro lado |
|---|---|---|
| Código do cliente | **ERP** | O app recebe por `POST /clientes` e guarda como `codigo_erp`. Cliente que nasce no app sai em `GET /clientes?desde=` com `novo_no_control: true`; o ERP cria e devolve o código, casando pelo **CNPJ** (a chave entre os sistemas) |
| Cadastro do cliente (razão social, nome fantasia, WhatsApp, e-mail, inscrição estadual, observações, endereço) | **ERP e app** — a edição do app pendente prevalece até o ERP devolver o mesmo valor (ou o financeiro confirmar que atualizou); sem edição pendente, vale o que o ERP mandar | Chega por `POST /clientes`. Desde 17/09/2026 também é **editado no app** (admin, financeiro, gerente e o representante na própria carteira); a edição sai em `GET /clientes?desde=` com `alterado_no_app` e o `POST /clientes` não a sobrescreve até trazer o mesmo valor — aí ela é dada por atualizada |
| CPF/CNPJ do cliente | **ERP e app** (no app, só o escritório) | Chave entre os sistemas. No app, só admin e financeiro trocam; a troca segue a mesma regra da linha acima (`cnpj_cpf` em `alterado_no_app`). O cliente com o documento antigo no ERP continua casando pelo código — mesmo que outro cadastro do app tenha esse documento. Enquanto a troca está pendente, a `chave` no `GET /clientes` e no `GET /pedidos` já é o documento novo: case pelo `codigo` |
| Código do representante | **ERP** | Chega em cada cliente (`representante`), mostra o cliente ao rep com o mesmo código no login e sai no pedido como `representante_erp`. `POST /representantes` só atualiza nome, razão social e ativo de quem já tem login **e** já tem esse código gravado no app |
| Tabela de preço (código, descrição, coluna, ativo) | **ERP** | Chega por `POST /tabelas-preco`. O app guarda o vínculo no cliente e, em cada pedido, a tabela que o precificou; o pedido sai com a tabela dele |
| Condição de pagamento (código, descrição, ativo, valor mínimo) | **ERP** | Chega por `POST /condicoes-pagamento`; rep e loja só escolhem |
| Referência do produto, grade de tamanhos | **ERP** | Chega por `POST /produtos`. O app vende só o que está no catálogo; foto, descrição e cores são do app |
| Preço por tabela | **ERP** | Chega por `POST /precos` e **sobrescreve** o preço da carga do catálogo |
| Estoque por tamanho | **ERP** | Chega por `POST /estoque` (as duas marcas) |
| Retrato do cliente (última compra, total comprado, vencido, pendência, títulos vencidos) | **ERP** | Chega por `POST /retrato`, 1x por dia; a pendência e os títulos também podem vir no `POST /clientes` |
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
| Bloqueado | `bloqueado`, `motivo_bloqueio` | `"S"` = selo "Bloqueado" no cadastro e aviso ao financeiro; **não trava o pedido do representante** |
| Pendência financeira | `pendencia_financeira`, `titulos_vencidos` | O que o financeiro vê antes de decidir o pedido; vem pelo `POST /clientes` ou pelo `POST /retrato` |
| Limite de crédito | `limite_credito` | Informativo |
| WhatsApp / e-mail | `whatsapp`, `email` | Contato e o botão "Enviar pedido para o cliente"; saem no pedido em `cliente.whatsapp` e `cliente.email` |

Razão social, nome fantasia, CNPJ/CPF, inscrição estadual, observações,
endereço, WhatsApp e e-mail também são editáveis no app (17/09/2026): a edição
volta ao ERP pelo `GET /clientes?desde=` (`alterado_no_app`) e não é apagada
pelo `POST /clientes` — ver "Cliente editado no app". Código, representante,
tabela, bloqueio, limite e pendência continuam só do ERP.

## Representante

| Dado | Campo no envio | Para que serve |
|---|---|---|
| Código no ERP | `codigo` | Casa com o código atribuído ao login; é por ele que os clientes aparecem para o rep e que o pedido sai com `representante_erp` |
| Nome | `nome` | Telas e planilha |
| Razão social | `razao_social` | Cadastro do representante |
| E-mail | `email` | Guardado como o e-mail do Control; o login do app é outro campo e só muda pelas telas |
| Ativo | `ativo` | `"N"` desativa o acesso |

O app ainda tem dados **internos** do rep que o ERP não precisa conhecer:
login/senha, teclas de permissão e o interruptor de *venda interna* (pedido de
balcão que nasce aprovado — para o ERP é um pedido igual aos outros).

## Tabela de preço

| Dado | Onde vive | Observação |
|---|---|---|
| Código no ERP | `tabela_preco.codigo_erp` | Chega por `POST /tabelas-preco`; é o que faz o `tabela_preco` do cliente casar |
| Coluna (1–6) | `tabela_preco.coluna` | A coluna de preço gravada na tabela que o pedido usou |
| Descrição do Control, ativo | `POST /tabelas-preco` | Guardados em colunas próprias; o nome que o app mostra (T1/T2/T3) não é regravado pela API |

O pedido sai com a tabela que **o precificou** (gravada no pedido quando ele foi
montado). Pedido antigo, sem tabela gravada, sai com a tabela do cadastro do
cliente no momento da consulta. A coluna é sempre a da tabela.

## Condição de pagamento

| Dado | Onde aparece | Observação |
|---|---|---|
| Código | `condicao_pagamento.codigo` | O código do Control, como **número inteiro** (ex.: `21`) |
| Descrição | `condicao_pagamento.descricao` | Ex.: `"30/60/90"` — para conferência humana; é o texto que a planilha põe na C8 |

As condições do Control chegam por `POST /condicoes-pagamento` (código,
descrição, ativo, valor mínimo); representante e loja escolhem uma ao fechar o
pedido. Pedido sem condição sai com `condicao_pagamento: null`, sem pendência.

## Pedido

| Dado | Campo | Dono | Observação |
|---|---|---|---|
| Identificador técnico | `id` | App | UUID — use na confirmação; nunca muda |
| Número no app | `numero` | App | O número que rep e cliente enxergam (ex.: 10231) |
| **Número no ERP** | `pedido_erp` | **ERP** | Ex.: `CS17379`, sempre na forma normalizada. Nasce na importação, volta pela confirmação e aparece no app para todo mundo |
| Situação | `situacao` | App | Ver "Situações do pedido" abaixo |
| Cliente | `cliente.*` | ERP | Código, CNPJ, razão social, fantasia, endereço, inscrição estadual, WhatsApp, e-mail |
| Representante | `representante_erp` | ERP | Código do rep gravado no cliente |
| Tabela de preço | `tabela_preco.*` | ERP | Código + coluna da **tabela que precificou o pedido**. Pedido sem tabela gravada usa a do cadastro do cliente; tabela gravada sem código do ERP sai `null` e vira pendência — **nunca** cai para outra tabela |
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
ERP  → POST /tabelas-preco, /condicoes-pagamento, /produtos, /precos, /estoque   (o catálogo)
ERP  → POST /clientes, /representantes     (códigos, carteira, tabela, bloqueio, pendência)
ERP  → GET  /clientes?desde=               (cliente novo no app → cria lá e devolve o código;
                                            cadastro corrigido no app → alterado_no_app)
rep  → monta o pedido no app               (itens, cores, desconto, condição)
fin. → aceita e clica "Lançar no Control"  (pedido entra na fila da API; a tela espera)
ERP  → GET /pedidos                        (lê tudo acima; cliente.chave = CNPJ)
ERP  → grava e gera o número               (ex.: CS17379)
ERP  → POST /pedidos/{id}/confirmar        (o número volta; a tela diz "pedido importado")
ERP  → fatura e POST /faturamento          (nota, peças, valor, data → carimbo; uma nota por pedido)
ERP  → POST /retrato (1x/dia)              (última compra, total, vencido, pendência)
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

**As mudanças de 16/09/2026 também são correção da v1** (ainda sem chave
emitida): a fila passa a ser só o que o financeiro solicitou (`solicitado_em`),
e ele pode cancelar a solicitação enquanto o pedido não tem número (a
confirmação de quem já o puxou continua aceita);
`alterado_apos_importacao`; `cliente.chave` e `cliente.novo_no_control` no
pedido, com a pendência `cliente sem CNPJ` no lugar de `cliente sem código do
ERP`; uma nota por pedido (a nova substitui a anterior); `POST
/pedidos/{id}/excluir`; as cinco rotas de catálogo, o `POST /retrato`, os `GET
/clientes` e `/representantes` com `?desde=`; `sincronizar_agora` (que
expira em 15 minutos) e `solicitado_em` no `GET /status` com o `POST
/sincronizacao`; nos cadastros, o
casamento primeiro pelo CNPJ, `motivo_bloqueio`, `pendencia_financeira`,
`titulos_vencidos`, `data_update` e o `email` do representante guardado como
e-mail do Control; `aprovados_solicitados_ao_control` na conciliação; os cinco
canais no `/status`; e a série do número passa a ser a da marca (`CS`/`PL`).

**As mudanças de 17/09/2026 são aditivas** (nada renomeado nem removido): o
campo `alterado_no_app` em cada cliente do `GET /clientes?desde=`; no
`POST /clientes`, o campo com edição do app pendente e valor diferente deixa
de ser gravado (com aviso) e o valor igual fecha a pendência; o registro cujo
cliente foi salvo no app durante o envio volta em `ignorados` (`cadastro
alterado no app durante o envio — reenvie`); com `cnpj_cpf` pendente, o
documento antigo casa pelo `codigo` (e o registro que não dá para casar sem
adivinhar volta em `ignorados`, `CNPJ corrigido no app num cliente sem código e
hoje de outro cadastro sem código — confira qual dos dois é este cliente`); e o `servidor_hora` dos `GET /clientes` e
`/representantes` passa a ser tomado antes da consulta, menos 2 minutos de
folga, com a lista paginada pela ordem e não pela posição (o `desde` da próxima
puxada não pula uma mudança gravada durante a leitura; o que mudou nesses 2
minutos sai de novo, o que é inofensivo).

## Dúvidas / suporte

Falar com Yan (responsável pelo sistema de pedidos).
