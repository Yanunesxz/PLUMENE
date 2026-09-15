# _tools/erp-sync — o agente Python que fala com o Firebird do Control

Atualizado em 15/09/2026. Toda afirmação abaixo aponta para `sync.py:linha`
(as linhas são as do arquivo neste commit). Se mexer no script, atualize aqui.

## O que há nesta pasta

| Arquivo | O que é |
|---|---|
| `sync.py` | O agente. Lê o Firebird 2.5 do Control e grava no Supabase — e, num modo só, faz o caminho inverso (ver **push-orders**). |
| `photos.py` | Ingestão única de fotos: pasta de rede MARKETING → Supabase Storage → `products.image_url` (`photos.py:3-16`). Não toca no Firebird. |
| `.env.example` | As variáveis que o agente lê. Copie para `.env` ao lado do script. |
| `skus_sem_foto.txt`, `skus_sem_preco.txt` | Saídas de rodadas antigas do `photos.py` e do `--mode prices-audit`. Só diagnóstico. |
| `fbembed25_x64/` (não versionada) | As DLLs do Firebird. O script procura primeiro aqui e depois em `_tools/firebird-reader/fbembed25_x64` (`sync.py:38-42`) — **essa segunda pasta não existe no disco**; sem as DLLs ao lado do script, nada sobe. |

O docstring do `sync.py:6-10` lista só quatro modos; está desatualizado. A
lista real está no `argparse` em `sync.py:640-641` e é a tabela abaixo.

## Como ele sobe

- Lê **dois** `.env`: `_tools/erp-sync/.env` e `apps/api/.env` (`sync.py:49-50`).
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`) são
  obrigatórias (`sync.py:86-93`). É a **service_role**, sem escopo nenhum
  (`sync.py:110-115`): poder total sobre o banco, numa máquina da fábrica. É o
  oposto da chave de parceiro, que é amarrada a um `company_id`.
- `COMPANY_ID` é obrigatório (`sync.py:644-646`): é o UUID da empresa no
  Supabase. São dois bancos (Corpo Sensual e PLUMENE) — cada rodada é de UMA
  marca.
- Firebird: com `FIREBIRD_HOST` conecta por TCP 3050 (`sync.py:102-105`), que é
  o modo certo na fábrica, onde o Control mantém o `.FDB` aberto; sem ele abre
  o arquivo direto com a fbembed (`sync.py:107`), só para cópia offline.

## O que cada `--mode` faz

| Modo | Função | O que grava | Observações |
|---|---|---|---|
| `full` | `sync.py:657-661` | `price_tables`, `products` + `product_variants`, `product_prices`, `customers` | Roda, nesta ordem: `sync_price_tables` (`sync.py:168-189`), depois o mesmo que `products`, `prices` e `customers`. **Não** inclui `stock` nem `push-orders`. |
| `stock` | `sync_stock`, `sync.py:607-635` | `product_variants.stock_quantity/stock_committed` | Casa pela `erp_sku` (`PRODUTO\|TAMANHO`, `sync.py:623`). |
| `customers` | `sync_customers`, `sync.py:391-431` | `customers` (upsert por `company_id,erp_id`, `sync.py:429`) | Manda `block_reason: None` (`sync.py:422`), então apaga o motivo de bloqueio digitado no app. |
| `prices` | `sync_prices`, `sync.py:277-321` | `product_prices` (upsert por `product_id,price_table_id`, `sync.py:319`) | **Defeituoso — ver "vetos"**. |
| `products` | `sync_products`, `sync.py:192-274` | `products` (upsert por `company_id,sku`) + `product_variants` (por `company_id,erp_sku`), desativa ref desligada no ERP (`sync.py:255-262`) | Grava `description: None` (`sync.py:227`): apaga descrição editada no app. `image_url` é preservada de propósito (`sync.py:220-221`). |
| `reconcile` | `reconcile_active`, `sync.py:324-344` | só `products.active` | PATCH pontual, não reescreve nada mais. |
| `prices-audit` | `audit_prices`, `sync.py:348-387` | **nada** | Só lê: conta produtos com preço em PRECO1, só em PRECO2..6, ou sem preço. |
| `test` | `sync.py:676-681` | **nada** | Conta produtos e clientes ativos no Firebird. |
| `push-orders` | `push_orders`, `sync.py:572-604` | **PEDIDO e ITENS_PEDIDO no Firebird do Fábio** + `orders` no Supabase | A única escrita no ERP (`sync.py:434-435`). Detalhado abaixo. **Vetado em produção.** |

Além do Python, existe um segundo leitor do Firebird em TypeScript dentro da
API (`apps/api/src/erp/firebird/`, ligado por `ERP_SYNC_ENABLED`). Ele tem o
mesmo defeito de preço duplicado. Ver "vetos".

## O modo `push-orders`, sem rodeio

Direção inversa de todo o resto: pega pedido aprovado no Supabase e **insere no
banco de produção do Control**. Passo a passo, com a linha:

1. **Busca a fila** (`fetch_pending_orders`, `sync.py:460-473`): `orders` da
   empresa com `status = approved` (`ERP_PUSH_STATUS`, `sync.py:85`) **e**
   `erp_order_id IS NULL`, em ordem de `created_at` (`sync.py:468-469`). Sem
   paginação (o PostgREST corta em 1.000) e sem filtro de faturado.
   **É a fila da API de Parceiro menos duas proteções:** a API
   (`getPartnerOrders` em `apps/api/src/modules/partner/partner.service.ts`)
   filtra `status = approved`, `erp_order_id IS NULL` **e não faturado**, e
   pagina além de 1.000; o `push-orders` não faz nenhuma das duas — pega
   também o pedido que a Larissa já faturou à mão. Os pedidos não faturados
   estão nas duas filas ao mesmo tempo: dois consumidores = o mesmo pedido
   lançado duas vezes no Control, com dois números.
2. **Garante o generator** (`_ensure_generator`, `sync.py:445-458`): consulta
   `RDB$GENERATORS`; se `GEN_PEDIDO_UNIVERSAL` (`ERP_ORDER_GENERATOR`,
   `sync.py:81`) não existir, executa **`CREATE GENERATOR`** e dá commit
   (`sync.py:457-458`). Isso é **DDL no banco de produção do Fábio**, feito
   por um script nosso, sem ninguém do lado de lá saber.
3. **Cunha o número** (`sync.py:534-538`): `SELECT GEN_ID(GEN_PEDIDO_UNIVERSAL, 1)`
   dentro do Firebird e monta `SX` + sequência (`ERP_ORDER_PREFIX`,
   `sync.py:80`). O `GEN_PEDIDO_UNIVERSAL` é a sequência **única compartilhada
   por todas as séries** do Control (CS/SX/PL entrelaçam o mesmo contador,
   `sync.py:77-79`, `.env.example:19-23`). `GEN_ID` não é transacional no
   Firebird: qualquer falha depois da linha 534 (o `rollback` em
   `sync.py:598` e `602`) **queima um número** da numeração do Fábio.
4. **Insere `PEDIDO`** (`sync.py:543-556`): `STATUS = 'A'`,
   `SITUACAO = LIBERADO` (`ERP_ORDER_SITUACAO`, `sync.py:83`), `ATIVO = 'S'`,
   `BAIXOU_ESTOQUE = 'N'`, data de hoje (`sync.py:540`), observação cortada em
   100 caracteres (`sync.py:541`), tabela de preço e coluna vindas de
   `price_tables.erp_code/price_column` (`sync.py:523-527` — sem `erp_code`
   o pedido nem entra).
5. **Insere `ITENS_PEDIDO`** (`sync.py:558-567`): um por item, `COR` fixa em
   `'00001'` (`sync.py:564`), produto e tamanho da `erp_sku` `PRODUTO|TAMANHO`
   ou de `products.erp_id` + `variants.size` (`sync.py:486-493`). Commit em
   `sync.py:569`.
6. **Confirma no Supabase** por PATCH direto (`sync.py:590-594`):
   `status = sent_erp`, `erp_order_id = SXnnnnn`, `synced_at`. Não manda
   `updated_at` — quem carimba é o gatilho da migração 013
   (`apps/api/src/config/migrations/013_protecoes.sql:88-105`).
7. **Cadastro que não casa vira `error_erp`** (`sync.py:597-600`): cliente sem
   `erp_id` (`sync.py:518-519`), sem `rep_erp_id` (`sync.py:520-521`), sem
   tabela com `erp_code` (`sync.py:523-525`), pedido sem itens ou item sem
   vínculo (`sync.py:481-496`) → `rollback` e PATCH `status = error_erp`.
   Isso acontece **por fora do fluxo do app**: nenhum array do
   `ORDER_STATUS_FLOW` tem `error_erp` como destino
   (`packages/shared/src/constants/orderStatus.ts:36-45`); a única saída dele
   é para `sent_erp` (`:44`). Pedido em `error_erp` some da fila padrão **e**
   do `incluir=todos` da API (`getPartnerOrders`, que só lê `approved` e
   `sent_erp`) e não volta
   sozinho.
8. **Qualquer outra falha** (`sync.py:601-603`): `rollback` e tenta de novo na
   próxima rodada. A idempotência é por `PEDIDO.IDPEDIDO_EXTERNO` = os 10
   primeiros hex do UUID do pedido (`sync.py:442-443`, conferido em
   `sync.py:509-513`): se o PATCH do passo 6 falhar, a rodada seguinte
   reaproveita o número já cunhado em vez de duplicar.

O modo não entra no `--mode full` (`sync.py:657-661`), não tem agendador e só
roda quando alguém digita `--mode push-orders` (`sync.py:674-675`). Nesta
máquina ele nem sobe: falta `COMPANY_ID` no `.env` e faltam as DLLs. É bomba
armada e desconectada — não é processo rodando.

## Por que isso contradiz o contrato publicado

O que foi prometido ao Fábio, nos dois documentos que são a mesma
especificação:

- `docs/API-PARCEIRO.md:16` — *"O aplicativo nunca escreve no banco do ERP"*.
- `apps/web/public/api-parceiro.html:611` — *"nada é escrito no seu ERP por
  fora — você continua no controle do que entra"*.
- `apps/api/src/modules/partner/partner.router.ts:6-8` — duas mãos: pedidos
  **saem** (o parceiro busca e confirma) e cadastros **entram** por POST.

O `push-orders` faz o contrário: escreve `PEDIDO`, `ITENS_PEDIDO` e, se
precisar, o próprio generator no Firebird de produção. Enquanto o script
existir com esse modo, a frase do contrato só é verdadeira se ninguém rodá-lo.

## DECISÃO — 15/09/2026

1. **O canal oficial é a API de Parceiro.** O programa do Fábio **PUXA** os
   pedidos em `GET /partner/v1/pedidos`, grava no Control e devolve o número
   em `POST /partner/v1/pedidos/:id/confirmar`. O número do Control é cunhado
   **pelo Control**; o app nunca cunha número e nunca escreve no Firebird.
   A frase "nada é escrito no seu ERP" continua sendo o contrato.
2. **`--mode push-orders` NÃO deve ser executado em produção**, em nenhuma das
   duas marcas, até decisão explícita do Yan com o Fábio. As perguntas que
   destravam isso estão no §6 do brief (`docs/BRIEF-ERP-FABIO.md`):
   - **Pergunta 1** — o Fábio fica com o modelo publicado (ele puxa e confirma)
     ou prefere que o app insira direto no Firebird? Um dos dois morre.
   - **Pergunta 5** — alguém já rodou `push-orders` em produção? Existe
     `PEDIDO` com `IDPEDIDO_EXTERNO` preenchido? O `GEN_PEDIDO_UNIVERSAL` já
     existia no Control ou foi o nosso script que criou?
3. **O código não é apagado.** É decisão registrada, não remoção: ele é a
   prova de como a inserção direta funcionaria, caso a resposta da pergunta 1
   vá por esse caminho. Se um dia for ligado, precisa antes: paginar a fila,
   filtrar faturado, parar de gravar `error_erp` por fora do fluxo, e a API de
   Parceiro precisa ser desligada para aquela marca — nunca os dois ao mesmo
   tempo.

## Outros vetos (mesma data)

- **Não ligar `ERP_SYNC_ENABLED=true`** na API (`apps/api/src/config/env.ts:36`,
  `false` por padrão). O `upsertBatch` do sync TypeScript
  (`apps/api/src/erp/firebird/erpSyncService.ts`) sobe sem `onConflict` e
  monta preço repetido dentro do lote; além disso grava `description: null`
  em `products`.
- **Não rodar `--mode prices` nem `--mode full`** sem corrigir o upsert de
  preços duplicados: `sync_prices` percorre `ITENS_TABELA_PRECO` por
  (tabela, produto, **tamanho**) (`sync.py:280-288`) mas a linha gravada só
  tem `product_id` + `price_table_id` (`sync.py:311-317`). Cada tamanho
  repete o mesmo par no mesmo lote, e o `on_conflict=product_id,price_table_id`
  (`sync.py:319`) estoura no Postgres ("ON CONFLICT DO UPDATE command cannot
  affect row a second time"). O `full` também derruba a descrição dos produtos
  (`sync.py:227`).
- **As tabelas de preço em produção vêm dos PDFs de 2027**
  (`_tools/tabelas-2027/carregar.mjs`), com `erp_code` vazio **de propósito**
  para o sync não sobrescrevê-las. Preencher `erp_code` reabre as tabelas ao
  Firebird. Quem manda no preço — o PDF ou o Control — é a pergunta 9 do §6,
  não uma coluna esquecida.

## O que pode rodar hoje sem susto

`--mode test`, `--mode prices-audit` (só leitura) e `--mode reconcile` (só o
flag `active`). `--mode stock` e `--mode customers` gravam, mas não tocam em
pedido nem em preço; ainda assim, rode primeiro numa cópia do banco e pause o
cron do CRM antes de uma carga grande de clientes (cada linha ganha
`updated_at` novo e o CRM relê a base inteira na rodada seguinte).
