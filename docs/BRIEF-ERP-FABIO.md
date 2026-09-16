# BRIEF DE ENTREGA — Integração App de Pedidos ⇄ ERP do Fábio ("Control")

**Para o chat que assume esta área daqui em diante.** Tudo abaixo tem arquivo:linha como prova. Fato sem evidência não entrou. Raízes:
- App: `C:\Users\Yan\Desktop\SetorxWeb\SetorxWeb`
- CRM (CSP 360): `C:\Users\Yan\Desktop\Projeto-CS-SP`

---

## 0. CORREÇÕES DA AUDITORIA DE 15/09/2026

Auditoria feita antes de commitar: 14 leitores (um por grupo de arquivos) verificaram ~330 afirmações deste brief contra o código; toda contestação passou por céticos independentes. O diagnóstico, o mapa do CRM e a ordem do §7 se sustentam. O que está listado abaixo **prevalece sobre o texto original** onde houver conflito.

### 0.0 O desenho, confirmado pelo Yan em 15/09

```
site ── CRM (CSP 360) ──┬── app Corpo Sensual ──┬── ERP do Fábio (Control)
                        └── app PLUMENE ────────┘
```

- **Cada app tem a sua própria API de Parceiro e a sua própria chave**, porque o Fábio tem um sistema do Control por app. São duas instalações (dois deploys, dois Supabase), logo duas URLs e duas chaves.
- **O CRM só lê os apps.** Nunca fala com o Control. Tudo que o CRM precisar do ERP tem de entrar pelo app, pela API de Parceiro — o contrato da API precisa ser completo o bastante para alimentar o CRM (o "retrato do Control" que o CRM já lê de `customers`: última compra, total comprado, valor vencido, bloqueio, motivo de inatividade). O Yan vai pedir, quando faltar campo, que a API seja ampliada "de forma completa".

### 0.1 Fatos novos desde 11/09 (o brief não conhecia)

- **Migração 046 (`order_erp_sync`)** nasceu às 15:22 de 11/09, depois deste brief. É a "foto do que o Control conhece", para o botão *Atualizar no ERP* (venda interna editando pedido já lançado). Ela **já está no caminho da integração**: desde 14/09 `confirmOrderImport` chama `registrarNoErp` depois de gravar o número (`partner.service.ts`, fim da função). Sem a tabela a chamada devolve `sem_tabela` em silêncio. Arquivo pronto: `_tools/SQL-PARA-RODAR-046.sql`. **Medido às 08:5x de 15/09 com `node _tools/conferir-046.mjs` (versão fa3c1ee, que faz GET de verdade): a API NÃO enxergava a tabela em nenhum dos dois bancos (`PGRST205`). Medido de novo às 09:5x com `node _tools/conferir-046-047.mjs`: 046 e 047 visíveis nos DOIS bancos.** A conferência antiga com `head: true` dizia "aplicada" sem a tabela existir — não confie em medição por HEAD. O SQL agora termina com `NOTIFY pgrst, 'reload schema'`; precisa ser colado nos dois bancos e conferido de novo. Não existe 045 (número reservado por mensagem — não assumir livre).
- **Estado dos bancos, medido em 11/09 e 15/09:** colunas de 041, 043 e 044 existem nos DOIS bancos; a 046 e a 047 também, desde a manhã de 15/09 (ver acima). **A 042 (índice único do número do Control) existe na PLUMENE e FALTA na Corpo Sensual** — conferido pelo Yan em 15/09 por `pg_indexes` no SQL Editor. Há 0 números repetidos, então colar o `CREATE UNIQUE INDEX` da 042 na Corpo Sensual é seguro. `SQL-PARA-RODAR-041-NA-PLUMENE.sql` está obsoleto.
- **Passo 2 do §7, medido em 15/09:** a API no Railway está de pé (`/health` responde `production`). Existem também dois endereços da API na Vercel (`setorx-web-api.vercel.app` e `setorx-web.vercel.app`) que respondem **500 FUNCTION_INVOCATION_FAILED** — a função sobe e morre, provavelmente por env ausente (até `/health` dá 500). Só o Railway conta. E no Railway `GET /partner/v1/status` responde **503 PARTNER_API_DISABLED** com e sem chave: `PARTNER_API_KEYS` nunca foi configurada em produção. A integração está, de fato, desligada — o que dá liberdade para endurecer o contrato antes de emitir a primeira chave.
- **Arquivos em edição concorrente:** `orders.service.ts` (1.223 → 1.257 linhas), `partner.service.ts` (319 → 326), `packages/shared/src/types/order.ts`, `tests/supabaseFake.ts` (agora com `upsert`) e o `index.ts` do CRM (1.523 linhas). **Todas as âncoras de linha desses arquivos neste brief estão defasadas.** Localize por nome de função (`grep -n`), não por linha.
- **`tests/atualizar-no-erp.test.ts`** (11/09 15:31) já cobre o caminho feliz de `confirmOrderImport`. Continuam sem teste: `getPartnerOrders`/`mapOrder`/pendências, `requirePartner` (503/401) e os desfechos `ja_confirmado:true`, `conflict` e `not_found`. São 55 arquivos de teste, não 54.

### 0.2 Correções de gravidade alta (mudam decisão ou contrato)

1. **§2.2 faturamento — `invoiced_total` não é "só quando o payload traz valor".** É gravado sempre que a coluna da 027 existe: com o valor quando vem, **NULL quando não vem** e NULL no cancelamento. Reenviar um faturamento sem `valor_faturado` **apaga** o valor gravado antes. A rota também não é idempotente em `invoiced_at` (reenvio sem `faturado_em` move a data para agora). A página pública não pode prometer reenvio seguro sem dizer isso.
2. **§3 item 1 / §4.4 — `invoiced` tem três escritores, não dois:** as duas rotas HTTP mais `_tools/faturar-retroativo.mjs`, que grava direto no Supabase (o próprio brief o cita em §4.4). E `erp_order_id` tem **quatro pontos de escrita** em três caminhos: o financeiro escreve em dois lugares (`updateOrderStatus` no lançamento e `corrigirNumeroErp` na correção, esta sem `synced_at`), mais a API e o `sync.py`.
3. **§7 passo 3 — mudou de conteúdo** (ver 0.1). O que resta: colar a 042 (só o `CREATE UNIQUE INDEX`) na Corpo Sensual; 041, 043, 044, 046 e 047 já estão nos dois bancos.
4. **§8 sobre a 041 — a 041 NÃO é a base do que o ERP empurra.** `POST /partner/v1/clientes` recebe o endereço em pedaços mas achata tudo na coluna de texto `address`; nenhuma coluna da 041 (cep, bairro, cidade, uf, IE, observações) é gravada por essa rota. A página pública não pode prometer campos separados vindos do Control.
5. **§7 passo 5 — `buscarTudo` não serve cru.** `lib/paginacao.ts` **engole** o erro e devolve o que juntou (comportamento trancado por `tests/paginacao.test.ts`). Trocar `getPartnerOrders` por `buscarTudo` regride: hoje erro vira 500; com o helper viraria **200 com lista vazia**, exatamente o "o ERP conclui que o resto não existe". Capturar o `error` dentro do callback, ou criar variante que lance. Ordenar também por `id` (empate em `created_at` quebra `.range()`).
6. **§2.4 — o CRM lê mais colunas de `customers` do que a lista:** além das 11, desde 11/09 lê `last_purchase_at, total_purchased, overdue_amount, inactivity_reason, inactivity_note, inactivity_updated_at` (o "retrato do Control", só quando existem nos dois lados). O `customers.last_purchase_at` que o faturamento do parceiro empurra vira `ultima_compra_erp` no CRM. E `scripts/importar-fabricas.mjs` lê um conjunto MAIOR e diferente de colunas (catálogo, `erp_code`, `code`, fotos), não uma cópia da Edge Function.

### 0.3 Defeitos que o brief não lista (entram no §3)

- **A fila padrão do parceiro entrega pedido já faturado.** A fila é `status='approved' AND erp_order_id IS NULL` e **não filtra `invoiced`**; o carimbo manual de faturado não exige número do Control. Medido em 11/09: dos 21 pedidos da fila da Corpo Sensual, **19 já estavam faturados**. A doc promete "na fila pendente `faturado` vem sempre false" — é falso. O passo 5 precisa acrescentar `invoiced = false` à fila padrão.
- **`orders.price_table_erp_code` nunca é gravada por código nenhum** (só a 002 cria a coluna). O fallback "foto da tabela no pedido" de `mapOrder` é letra morta: todo pedido depende de `price_tables.erp_code`, que está vazio nos dois bancos. Resultado medido: **0 de 66 pedidos importáveis** na CS e 0 de 16 na PLUMENE. A página pública promete que "o pedido fotografa a tabela na criação" — não fotografa. A pergunta 9 do §6 é o portão real da integração.
- **`confirmOrderImport` tem corrida:** o update filtra só por `id` e `company_id`, sem `.is('erp_order_id', null)`; duas confirmações simultâneas com números diferentes passam e a última vence em silêncio. E o `status` é selecionado e nunca usado.
- **Erro nomeado não sai por `throw`:** `app.ts` carimba `INTERNAL_ERROR` em qualquer exceção. O novo 409 do passo 5 precisa ser um `outcome` novo em `ConfirmResult` e um `case` novo no controller; o `switch` do controller não tem `default` (outcome sem `case` deixa a requisição pendurada). O `23505` chega em `error.code` do update, não como exceção.
- **`POST /clientes` apaga o que não veio:** o `update` vai com a linha inteira; payload só com `codigo` e `razao_social` zera `trade_name`, `cnpj`, `rep_erp_id`, `price_table_id`, `whatsapp`, `email`, `address` e põe `blocked=false` (desbloqueia cliente bloqueado). São as colunas que o CRM lê.
- **`sync.py --mode push-orders` também escreve `status='error_erp'`** por PATCH direto (cadastro não mapeável), por fora do `ORDER_STATUS_FLOW`. Pedido em `error_erp` sai da fila e do `incluir=todos` e nunca volta sozinho. E o `GEN_ID` não é transacional: cada falha queima um número do generator compartilhado.
- **`users.erp_rep_id` NÃO entra no payload do pedido** (§1.4 diz que entra): `representante_erp` é `customers.rep_erp_id`. Cliente criado no app sai com pendência de representante mesmo que o rep tenha código.
- **Cache eterno de colunas (§4.3) afeta mais campos** (`numero`, `faturado_em`, `valor_faturado` também) e memoriza qualquer erro de rede como "coluna não existe" — mas **não** as migrações do passo 3 (a justificativa do passo 6 estava errada; a recomendação continua valendo para bancos sem 027/028/029).
- **A página pública:** "três" aparece em três lugares (614-615, 779, 896); carimbo interno "atualizado 21 jul 2026"; URL do Railway fixa em 12 linhas; promete "nada é escrito no seu ERP" (610-611, 833-834); exemplo `PED-00123` não passa na máscara `^[A-Z]{2}\d{1,10}$`; nenhum `code` textual documentado; promete cor real contra a constante `00001`; contrato de estabilidade da v1 (1725-1728) colide com endurecer o confirmar.
- **`/representantes`:** grava `updated_at` sempre (única marca, `users` não tem trigger), `email` só quando vem, `active` só quando `ativo` vem, ignora `razao_social`; a página diz que "liga a carteira" — não liga.
- **`order_status_history` (013) já grava rastro de toda confirmação e faturamento, inclusive os da API** — atribuído ao aprovador. §3 item 8 diz que ninguém escreve auditoria; ninguém *lê*.

### 0.4 Correções menores (fatos certos, detalhe errado)

- `POST /clientes` monta `address` também com `complemento`; aceita `endereco` já em texto.
- O aviso "nenhuma tabela tem erp_code" é condicional, não fixo; o "4" é estado do banco.
- `partner.controller.ts` emite seis códigos (falta `INVALID_BODY`); `docs/API-PARCEIRO.md` só nomeia quatro, numa tabela dentro da seção de cadastros.
- A foto da 044 sai na **primeira edição** depois do rascunho; no faturamento só se ninguém editou antes.
- "Sempre idempotente" vale de 012 em diante; a 002 não é reexecutável.
- `orders_number_seq` é criada com `START WITH 14534`; 14533 é só o `setval`.
- `numeroErp.ts` tem 54 linhas; `partner.router.ts` 32; `order.ts` 234.
- ESTADO.md do CRM é documento vivo: citar por título de bloco, não por linha.
- Exemplo do CRM é `APP-14637`; `#14632` é pedido excluído.
- `tests/faturamento-do-parceiro.test.ts` também tranca "cancelar limpa data e valor"; só testa valor zero, não negativo.
- O comando do §8 sobre `partner/v1` devolve dois comentários, não vazio.
- No CRM: `mapearStatus` faz `invoiced === true` vencer qualquer status (até `rejected`); o catch do insert de clientes não descarta pedidos (caem em "A vincular"); `deleted_orders` é filtrada por `deleted_at` (a falta de trigger é irrelevante ali); peças são reescritas se `orcamento` OU pedido sem itens.

### 0.5 Fase 0 implementada (branch `mudanca/app-control-fase-0`)

O que a auditoria apontou virou código, na worktree `SetorxWeb-control`, ainda **fora do `main`**. Resumo do que mudou — o contrato vivo é `docs/API-PARCEIRO.md` + `apps/web/public/api-parceiro.html` (a mesma especificação nos dois), que já descrevem **nove** rotas; o §2.2 deste brief fala de seis e está defasado.

**O que mudou no app**

- **Canal por empresa** (`companies.canal_*`, migração 048, `apps/api/src/lib/canais.ts`): cada fluxo tem um escritor só. A API de parceiro responde `409 CANAL_FECHADO` nas rotas que gravam enquanto o canal daquela empresa não for `'api'`; `GET /partner/v1/status` devolve `canais`. Padrões = o comportamento de hoje (manual/carga), então **sem a 048 a API fica fechada**.
- **Três rotas novas**, todas só de leitura menos a primeira: `POST /partner/v1/pedidos/:id/conciliar` (dá número ao passivo `sent_erp` sem número), `GET /partner/v1/conciliacao` (só contagens) e `GET /partner/v1/pedidos/excluidos`.
- **Faturamento idempotente**: campo ausente não apaga, `null` limpa, momento sem fuso é ignorado, só `approved`/`sent_erp` fatura, contador `inalterados`, e os campos novos `nota` e `itens` (tabelas `order_invoices` e `order_invoice_items`, 048) — com aviso e sem perder o resto quando a 048 ainda não rodou. Resolve o 0.2.1.
- **Cadastros que não apagam o que não veio** em `POST /clientes` e `/representantes`, com `sem_mudanca`, miolo do código, colunas da 041 gravadas, `legal_name` e o e-mail do Control que **não** troca o login. Resolve o 0.3 (`/clientes` apaga, `/representantes`) e o 0.2.4.
- **Fila sem pedido faturado**, corrida do `confirmOrderImport` fechada (`.is('erp_order_id', null)`), tabela do pedido (`orders.price_table_id`) no `GET /pedidos` e lista inteira com `buscarTudoOuFalhar`. Resolve o resto do 0.3.
- **Rastro**: toda chamada do parceiro em `erp_sync_log` e todo acontecimento do pedido com o Control em `order_erp_events` (048), sem dado de cliente.
- **Tela**: pedido com número do Control não pode ser excluído (`409 ORDER_HAS_ERP_NUMBER`); com `canal_pedido_erp='api'`, lançar no ERP pela tela responde `409 CANAL_API` (corrigir o número continua); com `canal_faturamento='api'`, o botão manual de faturado responde `409 FATURAMENTO_PELO_CONTROL`; edição de peças sem foto do original responde `503 ORIGINAL_NAO_GUARDADO`.
- **Firebird e scripts travados**: o sync TS só roda para empresa com `canal_catalogo='firebird'` / `canal_cadastro='firebird'`; o `sync.py` recusa todo modo que grava sem `ERP_SYNC_PY_LIBERADO=sim` na janela do terminal, e o `push-orders` exige ainda `canal_pedido_erp='sync_py'`; `faturar-retroativo.mjs` exige `--empresa=<uuid>` e só grava com `--aplicar`; `seedDemoOrders` exige empresa explícita.

**O que depende do Yan (nesta ordem)**

1. **Reservar o número 048 por mensagem** entre as sessões antes do merge (regra do CLAUDE.md).
2. **Só na Corpo Sensual:** rodar a consulta de repetidos do cabeçalho de `_tools/SQL-PARA-RODAR-013-042-NA-CS.sql` (deve vir vazia) e colar o arquivo — é a 013 inteira + o índice único da 042, que ainda faltam lá.
3. **Nos dois bancos:** rodar as duas consultas do cabeçalho de `_tools/SQL-PARA-RODAR-048.sql` (`price_column` fora de 1–6 e `erp_code` repetido; as duas devem vir vazias), colar o arquivo e conferir com `node _tools/conferir-048.mjs` e `node _tools/conferir-048.mjs <raiz da PLUMENE>`.
4. **Ler e aprovar o texto publicado** (`docs/API-PARCEIRO.md` e `apps/web/public/api-parceiro.html`): ele vai ao ar no Vercel quando a branch entrar no `main`.
5. **Conferir no Railway e no Vercel** qual serviço é de qual marca antes de publicar a tabela de URLs (Corpo Sensual `setorxweb-production`, PLUMENE `csbapi-production`) e configurar `PARTNER_API_KEYS` com **uma chave por marca**.
6. **Virar canal é um `UPDATE companies SET canal_… = 'api'`** por empresa, no SQL Editor, combinado com o Fábio. Enquanto não virar, a API responde `409 CANAL_FECHADO` e nada muda para quem usa o app hoje.

### 0.6 Respostas do Yan em 16/09/2026

As treze decisões abaixo fecham as perguntas 1, 7, 9, 10, 11, 13, 16 e 20 do §6 e viraram código na mesma branch (`mudanca/app-control-fase-0`, migração 049). O contrato vivo continua sendo `docs/API-PARCEIRO.md` + `apps/web/public/api-parceiro.html`, agora com **dezenove** rotas. Onde este brief disser outra coisa, vale isto:

1. **Um Control por marca; uma chave e uma URL por marca.** A série do número é a da marca: `CS` (Corpo Sensual) e `PL` (PLUMENE). A série de representante que o script e a doc antiga exemplificavam **não existe mais**; a máscara continua duas letras + dígitos.
2. **O lançamento continua sendo um clique do financeiro.** Com `canal_pedido_erp='api'`, "Lançar no Control" não digita número e não responde 409: **solicita** (`orders.erp_requested_at/by`, evento `solicitado_ao_erp`) e a tela consulta o pedido a cada 3 s por até 3 min; quando o número chega pela confirmação, mostra "Parabéns, pedido importado! O número no Control é CS…"; se estourar, "O Control ainda não respondeu. O pedido fica na fila e o número aparece aqui quando chegar". Com canal manual, tudo como hoje.
3. **A fila da API** (`GET /partner/v1/pedidos`) é `approved AND erp_order_id IS NULL AND não faturado AND erp_requested_at IS NOT NULL` (sem a 049, a fila de antes). Campo novo `solicitado_em`; com `incluir=todos`, `alterado_apos_importacao` = o pedido de hoje difere da foto do que o Control conhece (046: peças, desconto, condição, observação). A conta literal `updated_at > erp_order_set_at` foi trocada na revisão de 16/09: a trigger da 013, o faturamento e as notas regravam `updated_at` e todo pedido importado sairia `true`.
4. **O CNPJ é a chave única do cliente entre os sistemas.** No pedido, `cliente.chave` (só dígitos) e `cliente.novo_no_control` quando não há código. "Cliente sem código do ERP" **deixou de ser pendência** — o Control cria o cadastro e devolve o código por `POST /clientes`, casando por CNPJ; a pendência passa a ser "cliente sem CNPJ". Em `POST /clientes` o casamento é primeiro por `cnpj_digits`, depois pelo miolo do código; cliente sem código recebe o que vier.
5. **Um pedido tem uma nota só.** Nota cancelada/devolvida não é avisada: o Control sobe outra por cima. Nota nova (número diferente) **substitui** a anterior (`cancelada_em`, `substituida_por`, evento `nota_substituida`); a tela usa só a nota ativa.
6. **O Control manda tudo pela API e sobrescreve:** tabelas de preço (código, descrição, coluna 1-6, ativo), condições de pagamento (código, descrição, ativo, valor mínimo), produtos e tamanhos, preço por tabela (sobrescreve o do PDF), estoque das duas marcas, retrato do cliente e pendência financeira. **O Firebird está aposentado** (as travas ficam) — `_tools/erp-sync/README.md`.
7. **Sincronização bidirecional:** o Control **puxa** o que mudou no app por `GET /clientes`, `GET /representantes` e `GET /pedidos?incluir=todos`, todos com `?desde=`. Intervalos recomendados na doc: fila a cada 1 min; cadastros e alterações a cada 5 min; faturamento ao carimbar ou a cada 5 min; catálogo/preço/estoque a cada 30 min; retrato 1x por dia; e quando `GET /status` devolver `sincronizar_agora: true`, tudo já — o botão "Pedir sincronização agora" da tela de Integração do app (`companies.sync_solicitado_em`), que o Control limpa com `POST /sincronizacao`.
8. **Bloqueio do Control não trava o representante.** O pedido segue; o financeiro é avisado (o aviso da tela é do Yan). O app guarda `block_reason`, `pendencia_financeira` e `titulos_vencidos` que vierem.
9. **E-mail do Control para representante** vai em `users.erp_email`; o login não muda.
10. **Cores são internas:** nada muda (continuam na observação do item, `cor` sempre `00001`).
11. **Com `canal_faturamento='api'` o botão manual de faturado some/é recusado para todos** (`409 FATURAMENTO_PELO_CONTROL`), não só para pedido com número.
12. **Exclusão de pedido com número do Control é bloqueada para todos, inclusive admin.** Se o Control excluir, ele avisa por `POST /partner/v1/pedidos/:id/excluir { motivo }` e o app exclui (cópia em `deleted_orders` com `deleted_by_name` = nome do parceiro, evento `excluido`, origem `api` — o tipo `excluido_pelo_erp` só existe depois da 049 e o rastro se perderia num banco sem ela). Só vale para pedido que o Control tem: com número dele ou solicitado pelo financeiro (senão `409 ORDER_NOT_IN_CONTROL`).
13. **Comissão é do gerente, não do Control;** representante do pedido = dono da carteira (nada muda).

O que ainda depende do Yan, além dos passos de 0.5: rodar a **049** nos dois bancos **depois** da 048 (`_tools/SQL-PARA-RODAR-049.sql`, conferir com `node _tools/conferir-049.mjs [raiz da PLUMENE]`) — sem ela tudo degrada para o comportamento de hoje; e criar o aviso ao financeiro da decisão 8.

---

## 1. ESTADO ATUAL

### 1.1 O ciclo real hoje é manual, e o código admite isso

O pedido nasce no app, o financeiro (Larissa) aceita, **exporta a planilha oficial do Control**, importa à mão no Control, o Control cunha o número (ex.: `CS17505`), ela volta ao app e **digita** esse número, e depois alguém **carimba faturado** na tela. São três digitações humanas por pedido.

- A planilha é a ponte declarada: `apps/web/src/lib/exportOrders.ts:25` — *"Nada disso conversa com o ERP ainda. A planilha é a ponte enquanto não há integração direta."* Ela sai com representante e cliente **em branco** (`exportOrders.ts:23`), 32 linhas por arquivo (13 a 44), pedido maior vira `.zip`.
- Lançar exige o número digitado: `apps/api/src/modules/orders/orders.service.ts:1177-1190` — sem número válido `ERP_NUMBER_REQUIRED`; número já usado `ERP_NUMBER_IN_USE`; grava `erp_order_id` + `synced_at`.
- Formato do número: `^[A-Z]{2}\d{1,10}$`, normalizado em maiúsculas sem espaço/ponto/hífen/barra (`packages/shared/src/pedidos/numeroErp.ts:12,15-17`). **O app nunca cunha o número.**
- Só financeiro e admin lançam. Gerente barrado em `orders.service.ts:1155-1157`; representante em `1135-1137`.
- O faturado é carimbo manual: `PATCH /orders/:id/invoice` (`orders.router.ts:102-112`), e `setOrderInvoiced` grava **só** `invoiced`, `invoiced_at`, `updated_at` (`orders.service.ts:1077-1085`).
- Existe até script de conserto retroativo porque o carimbo depende de alguém lembrar: `_tools/faturar-retroativo.mjs:4-7`.

### 1.2 A API de Parceiro existe, está no ar, e nunca foi usada

Seis rotas registradas em `apps/api/src/modules/partner/partner.router.ts:21-31`, registradas no mesmo Fastify do app sem prefixo e sem JWT (`apps/api/src/app.ts:115`). Módulo escrito entre 15/07/2026 e 11/09/2026 (10 commits).

Prova de que nunca rodou de verdade:
- `tests/faturamento-do-parceiro.test.ts:8` — *"O ERP do Fábio ainda não usa esta rota."*
- Nenhuma chave emitida: `PARTNER_API_KEYS` está vazia em `apps/api/.env.example:39` e **ausente** do `.env` local (que tem 8 variáveis: PORT, NODE_ENV, JWT_*, SUPABASE_*, CORS_ORIGIN). Sem chave, as 6 rotas respondem **503 PARTNER_API_DISABLED** (`partner.auth.ts:52-60`).
- Nenhuma linha do repositório chama `/partner/v1/...`. Não há script de fumaça, cliente de referência nem coleção de requisições.
- Os 4 commits de 11/09/2026 que tocaram o módulo nasceram de necessidade do **app**, não de pedido do parceiro.
- O CRM registra o mesmo por escrito: `Projeto-CS-SP/central/produto/spec-integracao-erp.md:17-21` classifica a API de Parceiro como "projeto futuro".

### 1.3 A mão inversa (ERP → app) já existe e já rodou

Não é código parado — é integração de **leitura** completa:
- TypeScript: `apps/api/src/erp/firebird/connection.ts` (node-firebird, TCP 3050), `queries.ts` (7 SELECTs contra PRODUTO, ESTOQUE_PRODUTO, CLIENTE, TABELA_PRECO), `erpSyncService.ts` (363 linhas, grava em `price_tables`, `products`, `product_variants`, `product_prices`, `customers`), `jobs/erpSyncScheduler.ts`, rotas `POST /erp/sync/full`, `POST /erp/sync/stock`, `GET /erp/status` (`modules/sync/sync.router.ts:21-37`). Tudo atrás de `ERP_SYNC_ENABLED`, **false por padrão** (`config/env.ts:36`).
- Python: `_tools/erp-sync/sync.py` — é o que de fato rodou contra produção. Provas documentais: `migrations/003_fix_sync_columns.sql:2-5` ("Alinha o schema ao que o ERP sync (sync.py) grava") e `008_sync_unique_keys.sql:5-7` ("por isso re-rodar o sync duplicava").

**De onde vem cada dado hoje:** produtos e estoque do sync Python do Firebird; **preços dos PDFs de 2027** (`_tools/tabelas-2027/carregar.mjs`, com `erp_code` deixado vazio **de propósito** — `carregar.mjs:130`); fotos da pasta de rede MARKETING (`_tools/erp-sync/photos.py`); clientes de cargas de Excel (`_tools/importar-clientes.mjs`) e, continuamente, do `POST /partner/v1/clientes`.

### 1.4 Os vínculos item a item com o ERP já existem

Não é preciso inventar identificação: `products.erp_id` (001:73), `product_variants.erp_sku` no formato `PRODUTO|TAMANHO` com UNIQUE (002:35,41), `price_tables.erp_code` com índice único (002:8,17-19), `customers.erp_id` (001:45 + índice 008:19-20), `customers.rep_erp_id` (002:58), `users.erp_rep_id` (012:45). A API de Parceiro já entrega tudo isso no payload do pedido.

### 1.5 Duas numerações vivas

`orders.order_number` é INTEGER próprio do app, alimentado pela sequence `orders_number_seq` semeada em 14533 (`migrations/012_rep_carteira_e_numero.sql:21-37`) — é o `#14632` da tela. `orders.erp_order_id` é o número do Control (`CS17505`). As duas foram semeadas propositalmente próximas e são independentes; **a única coisa que as amarra hoje é a digitação da Larissa.**

### 1.6 O CRM já lê o app, em produção, desde 09/09/2026

Edge Function `Projeto-CS-SP/supabase/functions/sincronizar-apps/index.ts`, cron de 10 min, chave no Vault, diário na tabela `sincronizacoes`. Registrado em `central/ESTADO.md:7,31-46` (primeira carga: CS +12 pedidos/+4 clientes; PL +13 pedidos/+141 clientes) e nos commits `cfc0d24` (PR #22), `4aef473`/`cdc55ce` (PR #23). Leitura incremental por `updated_at` com 15 min de folga (`index.ts:130,468-481`).

---

## 2. O CONTRATO

### 2.1 Autenticação (vale para as seis rotas)

Header `X-API-Key`. As chaves vivem **só** na env `PARTNER_API_KEYS`, um JSON `[{name, key, company_id}]`, lida crua de `process.env` dentro do módulo — **não passa pelo `config/env.ts`** (`partner.auth.ts:13-36`). Comparação com `timingSafeEqual` (`38-42`). Sem chave configurada: **503 PARTNER_API_DISABLED**. Chave errada ou ausente: **401 PARTNER_UNAUTHORIZED**. O `company_id` da chave amarra o escopo — um parceiro nunca enxerga nem fatura pedido de outra empresa. Não há tabela de chaves, tela de emissão nem rota de administração: o único registro de emissão é *"fale com Yan"* em `apps/web/public/api-parceiro.html:1718-1722`.

### 2.2 Rota por rota

**`GET /partner/v1/status`** (`partner.controller.ts:31-43`)
Devolve `{ ok, parceiro, servidor_hora }`. É o teste de ponta a ponta mais barato com o Fábio — não toca em pedido nenhum.

**`GET /partner/v1/pedidos`** (`partner.controller.ts:46-73`)
Query: `?desde=<ISO>` (data inválida → **400 INVALID_DESDE**) e `?incluir=todos`. Resposta: `{ total, servidor_hora, pedidos[] }`.
Fila padrão: `status='approved' AND erp_order_id IS NULL`; com `incluir=todos` vira `status IN (approved, sent_erp)`; `desde` filtra `updated_at >=`; ordem `created_at` crescente (`partner.service.ts:251-264`). **Não pagina.**

**`POST /partner/v1/pedidos/:id/confirmar`** (`partner.controller.ts:76-114`)
Corpo exige `pedido_erp` (**400 MISSING_PEDIDO_ERP**). Respostas: **404 ORDER_NOT_FOUND**; **409 ORDER_ALREADY_CONFIRMED** com `pedido_erp_atual`; **200 `{ ok, ja_confirmado }`**. Normaliza o número e grava `status='sent_erp'`, `erp_order_id`, `synced_at`, `updated_at` (`partner.service.ts:298,306-315`). É idempotente para o mesmo número.

**`POST /partner/v1/faturamento`** (`partner.controller.ts:122-149`, `partner.faturamento.service.ts`)
Aceita `{faturamento:[...]}`, `{dados:[...]}` ou a lista pura. Máximo **1000** por requisição (**400 BATCH_TOO_LARGE**, `MAX_POR_LOTE` em `partner.controller.ts:17`). Identifica o pedido por `pedido_erp` (preferido) ou pelo nosso `id`, buscando as **duas grafias** do número (normalizada e crua) e sempre dentro do `company_id` da chave (`faturamento.service.ts:82-90`).
É **tolerante**: registro ruim volta em `ignorados` com motivo, o resto grava. Seis motivos: `informe "pedido_erp" ou "id"` (76), `falha ao buscar` (94), `pedido não encontrado nesta empresa` (98), `"faturado_em" não é uma data ISO` (105), `"valor_faturado" precisa ser maior que zero` (111), `falha ao gravar` (142).
Grava `invoiced`, `invoiced_at` e `invoiced_total` (este último só quando o payload traz valor), guarda a foto do pedido original (migração 044) e empurra `customers.last_purchase_at` (`115-133,149-154`).

**`POST /partner/v1/clientes`** (`partner.sync.service.ts`)
Upsert por código do ERP com casamento por **"miolo"** — ignora `#` e zeros à esquerda: `#2225` = `2225` = `02225` (`82-87,216`) — e **adota por CNPJ** o cliente que já existia sem código (`216-227`). Exige `codigo` e `razao_social`; o resto é tolerante. **Nunca apaga cliente** (`232-237`). Grava `address` montado dos pedaços (logradouro/número/bairro/cidade/UF/CEP) e `updated_at` (`212-213`).

**`POST /partner/v1/representantes`** (`partner.sync.service.ts:273-328`)
**Não cria login.** Só atualiza `name`, `email` e `active` de reps que já existem (`role='rep'` **e** `erp_rep_id` não nulo). Os que o ERP tem e o app não voltam na lista `novos` para criação manual; `criados: 0` sempre.

### 2.3 Os campos do pedido (e a semântica travada)

Interface em `partner.service.ts:25-59`, montagem em `194-222`:

`id`, `numero`, `situacao`, `criado_em`, `atualizado_em`, `valor_total`, `observacoes`, `pedido_erp`, `cliente{codigo_erp, cnpj, razao_social, nome_fantasia}`, `representante_erp`, `tabela_preco{codigo_erp, coluna}`, `condicao_pagamento{codigo, descricao}|null`, `desconto_percentual`, `faturado`, `faturado_em`, `valor_faturado`, `itens[]`, `importavel`, `pendencias[]`.

Significados que **não podem mudar** sem renegociar com o Fábio:

| Campo | Significado travado |
|---|---|
| `valor_total` | É `orders.total`, **já com o desconto aplicado** (`orders.service.ts:338-342` e `629-634`). |
| `desconto_percentual` | `orders.discount_percent`, **pontos percentuais** (10 = 10%), `NUMERIC(5,2)` com CHECK 0–100 (`029_desconto_do_pedido.sql:30,42-43`). Coluna ausente → sai 0. |
| preço do item | **Sem desconto** — é o preço de tabela. |
| `cor` do item | **Sempre a constante `'00001'`** (cores sortidas, `partner.service.ts:12,184`). A cor escolhida pelo cliente vai como **texto** no campo `observacao` do item (`177-188`). |
| `observacoes` do pedido | Só o que o representante digitou, **sem** as linhas de cor (`202`) — elas já viajam por item. |
| produto/tamanho | Do `erp_sku` quando tem formato `PRODUTO|TAMANHO`; senão `products.erp_id` + `variants.size` (`166-175`). |
| `condicao_pagamento` | Ausente **não** gera pendência: sai `null` e `importavel: true` assim mesmo (`212-214`). |
| `tabela_preco` | Prefere a "foto" gravada no pedido (`price_table_erp_code`/`price_column`); na falta, a do cliente; coluna padrão **1** (`147-153`). |
| `pedido_erp` | É só o nome JSON de `orders.erp_order_id` (`203`). **Não existe coluna `pedido_erp` em lugar nenhum.** |

`pendencias` tem **CINCO** strings possíveis, deduplicadas, e `importavel = pendencias.length === 0` (`220-221`):
1. `cliente sem código do ERP` (144)
2. `cliente sem representante vinculado no ERP` (145)
3. `pedido sem tabela de preço vinculada no ERP` (153)
4. `item sem vínculo de produto/tamanho com o ERP` (176)
5. `pedido sem itens` (192)

### 2.4 As colunas que o CRM lê — renomear qualquer uma quebra produção em silêncio

A Edge Function não usa view nem API: faz SELECT literal por nome no PostgREST das fontes. Os literais estão em `Projeto-CS-SP/supabase/functions/sincronizar-apps/index.ts`:

- **`customers`** (`:584`): `id, erp_id, name, trade_name, cnpj, blocked, whatsapp, email, rep_erp_id, rep_id, updated_at`
- **`orders`** (`:708-709`): `id, rep_id, customer_id, order_number, status, invoiced, price_table_id, payment_condition_id, guest_name, notes, erp_order_id, created_at, updated_at`
- **`order_items`** (`:743`): `order_id, product_id, variant_id, quantity, unit_price`
- **`products`** (`:746`): `id, sku, name` — `sku` casa com `produtos.codigo` do CRM
- **`product_variants`** (`:754`): `id, size`
- **`price_tables`** (`id, name`) e **`payment_conditions`** (`id, description`) — casamento **por TEXTO**, e o que não existe no CRM é criado na hora (`:517-563`)
- **`users`** (`:574`): `id, name, erp_rep_id`
- **`deleted_orders`** (`:907`): `order_id, order_number, deleted_at, deleted_by_name`

Regras do lado do CRM que a integração precisa respeitar:
- **`faturado` no CRM = `invoiced === true`** (`index.ts:258-264`). O `status` textual só decide `enviado`/`orcamento`/`cancelado`. **Status fora do mapa faz o pedido sumir da sincronização com `ok=true`** — falha silenciosa. Hoje os 7 valores do mapa batem exatamente com o CHECK do app (`015_triagem_do_representante.sql:36-45`).
- **O CRM nunca lê `invoiced_total` nem `invoiced_at`** (grep no repo inteiro: zero). O `total_comprado` do cliente é a soma das peças e ignora desconto.
- O número do ERP vira `pedidos.codigo_erp`; antes dele, a chave provisória é `APP-<order_number>`. A troca é PATCH na mesma linha, sem duplicar (`:790-799,826`).
- Chave estável: `pedidos.origem_app_id = orders.id` (`migracao-sincronizacao-apps.sql:14-16`).
- **`updated_at` é o gatilho.** A migração 013 cria trigger `BEFORE UPDATE` em `products, product_variants, product_prices, customers, orders, price_tables` (`013_protecoes.sql:88-107`). **`order_items` e `deleted_orders` não têm trigger** — mexer só nas peças sem tocar a linha de `orders` é invisível para o CRM (é por isso que `orders.service.ts:831-835` atualiza `orders` depois de trocar itens).
- `products.sku` é o único casamento de produto: `produtos.codigo_erp` existe no CRM e **não é consultado**. Renumerar SKU faz os itens entrarem com `produto_id` nulo.

---

## 3. O QUE FALTA (em ordem de resultado)

**1. Decidir o canal oficial — e matar os outros.** *Esforço: grande (é decisão, não código).*
Hoje **três** caminhos escrevem `orders.erp_order_id`: (a) a digitação do financeiro (`orders.service.ts:1177`), (b) a API de Parceiro (`partner.service.ts:306`), (c) `_tools/erp-sync/sync.py --mode push-orders`, que insere `PEDIDO` e `ITENS_PEDIDO` direto no Firebird (`sync.py:543-567,572-604`). E os três disputam **a mesma fila, query por query**: `partner.service.ts:260` == `sync.py:462-470` == a aba "A lançar" do financeiro (`PaginaPedidos.tsx:116`). Para `invoiced` há **dois** escritores: `POST /partner/v1/faturamento` e `PATCH /orders/:id/invoice`. Enquanto isso não for decidido, ligar a integração produz pedido duplicado no Control com dois números. *Nota de escala: o push-orders não entra no `--mode full` (`sync.py:658-661`), não tem agendador e nem consegue subir nesta máquina (falta `COMPANY_ID` e as DLLs `_tools/firebird-reader/`, pasta que não existe). É bomba armada e desconectada, não processo rodando.*

**2. Aplicar as migrações pendentes nos dois bancos.** *Esforço: pequeno.*
`_tools/SQL-PARA-RODAR-042-043-044.sql:2-6` manda rodar 042/043/044 nos **dois** bancos; `_tools/SQL-PARA-RODAR-041-NA-PLUMENE.sql:2-11` diz que a 041 já está na Corpo Sensual desde 10/09 e falta na PLUMENE (sem ela, CEP/bairro/cidade/UF/IE digitados pelo rep da PLUMENE são **descartados em silêncio**). A **042** é a única trava real contra número do Control repetido (`042_numero_do_control_unico.sql:21-23`) — e o arquivo diz por que ela existe: *"a API de Parceiro grava `erp_order_id` por fora do app, sem checagem nenhuma"*. **Cuidado:** esses arquivos provam a intenção, não o estado do banco. Medir primeiro com `_tools/conferir-pendencias.mjs` (ele pergunta ao banco, não ao arquivo).

**3. Emitir a chave de parceiro.** *Esforço: médio.*
Enquanto não houver `PARTNER_API_KEYS`, o ERP literalmente não consegue conectar (503). Não existe tela, rota nem tabela: é editar a env e reiniciar. A lista fica memoizada em `partner.auth.ts:19-26` — revogar chave vazada depende de restart (no Railway, mexer na env já dispara redeploy). Antes de mandar a chave: confirmar **qual URL está de pé**, porque a API também está pronta para rodar como função serverless na Vercel (`apps/api/api/index.ts`), enquanto a doc aponta o Railway (`docs/API-PARCEIRO.md:19`). E provavelmente é **uma chave por deploy/marca**, não uma só.

**4. Paginar o `GET /partner/v1/pedidos`.** *Esforço: pequeno.*
`partner.service.ts:251-266` não tem `.range()` nem `.limit()`. O PostgREST corta em 1.000 linhas **em silêncio** — o próprio projeto documenta isso em `apps/api/src/lib/paginacao.ts:1-12` e usa `buscarTudo` na porta ao lado (`partner.sync.service.ts:160-163`). Com `incluir=todos` (a reconciliação que a doc recomenda) o ERP conclui, errado, que o resto dos pedidos não existe. `getPriceTableMap` (`228-238`) tem o mesmo problema **e** descarta o erro — mapa vazio faz todo pedido sair com pendência de tabela sem motivo.

**5. Endurecer o `confirmar`.** *Esforço: pequeno, e é o que mais evita telefonema no dia 1.* Cinco defeitos no mesmo handler:
- Não valida **formato** — aceita qualquer string (`298`), enquanto o caminho manual exige `numeroErpValido` (`orders.service.ts:1179`).
- Não checa **duplicidade** antes de gravar; com a 042 aplicada o erro `23505` vira **500 INTERNAL_ERROR** (`app.ts:95-100`). O caminho manual trata (`orders.service.ts:1204-1209`).
- Não olha o **status atual** (lê em `289` e nunca usa): um id errado promove rascunho, recusado ou pedido em triagem direto para `sent_erp`, transição que o `ORDER_STATUS_FLOW` proíbe.
- **404 mentiroso:** `287-294` faz `.single()` e **descarta o `error`** — timeout do Supabase vira `ORDER_NOT_FOUND`, e o robô do ERP conclui que o pedido não existe mais.
- O contrato do caso "número já usado por outro pedido" **não existe** em doc nenhuma (ver Armadilhas).

**6. Dar um caminho para `invoiced_total`.** *Esforço: médio.*
É a única coluna que separa "o que foi pedido" de "o que virou nota" (`027_valor_faturado.sql:5-16`), e sua **única escrita em todo o repositório** é `partner.faturamento.service.ts:123`. Nem a tela nem `_tools/faturar-retroativo.mjs:139` gravam. Consequência medida: `valorDaVenda` devolve `invoiced_total ?? total` (`packages/shared/src/constants/statusDoCliente.ts:79-84`) e é essa função que soma o Painel (`PaginaPainel.tsx:69,78,83`) e a Minha Área. Com a API desligada, `invoiced_total` é NULL em 100% dos pedidos e **o painel mostra o valor do pedido chamando de venda**.

**7. Resolver `erp_code` das tabelas de preço e as condições de pagamento.** *Esforço: médio — é decisão, não campo esquecido.*
`partner.sync.service.ts:133-135,145-149` emite o aviso fixo de que nas 4 tabelas de produção o `erp_code` está vazio, e sem ele todo cliente que o ERP empurra entra sem tabela e o pedido sai com pendência. **Mas está vazio de propósito:** `_tools/tabelas-2027/carregar.mjs:130` — *"Sem erp_code: elas vêm do PDF, não do ERP — o sync não deve sobrescrevê-las"*. Preencher reabre as tabelas à sobrescrita pelo Firebird. A decisão real é: **quem manda no preço, o PDF ou o Control?** Não há rota para o ERP mandar condições de pagamento nem códigos de tabela (as 146 condições entraram de uma vez por Excel, `028_condicoes_de_pagamento.sql`).

**8. Auditoria e observabilidade do parceiro.** *Esforço: médio — metade já está pronta.*
Nenhum registro de qual chave chamou o quê, quando, quantos pedidos levou. O grep por `log.`/`console.` na pasta `partner/` devolve **uma** linha (`partner.auth.ts:32`). **Mas a tabela existe desde a 002:** `erp_sync_log` (`002_erp_schema.sql:69-81`, com índice e RLS, e já está no backup em `_tools/backup.mjs:57`) — e **ninguém escreve nela**. Há dois rastros parciais: o log do Fastify no Railway (`app.ts:37-40`, não sabe o nome do parceiro) e `orders.synced_at`. É a correção de ~20 linhas que transforma "não sei se ele chamou" em consulta SQL.

**9. Homologação.** *Esforço: médio.* Não existe roteiro, ambiente nem seed utilizável. `apps/api/src/jobs/seed.ts` (111 linhas) não cria **um único** campo de ERP, nem variante, nem pedido, nem usuário `financeiro` — mesmo com chave, todo pedido sairia `importavel: false`. A própria página pública admite: *"Não há ambiente de homologação separado: a fila só contém pedidos reais"* (`api-parceiro.html:1702`). Falta também teste de `partner.service.ts` e de `partner.auth.ts` — o dublê já existe (`tests/supabaseFake.ts`), então o custo é baixo.

**10. Casamento de representante por "miolo".** *Esforço: pequeno.* Cliente casa por miolo (`partner.sync.service.ts:216`), representante casa **exato** (`288-289,305`). `0779` e `779` não casam para rep. Agrava: a tela de reps grava `erp_rep_id` com simples `trim()` (`reps.service.ts:286`), e o mapa só carrega `role='rep'` **com** `erp_rep_id` não nulo (`280-285`) — quem não casar cai em `novos` para sempre.

**11. Alinhar o material que vai para o Fábio.** *Esforço: pequeno.* Ver Armadilhas 4.1.

**12. Limite de lote coerente.** *Esforço: pequeno.* Código aceita 1000, doc recomenda 500–1000 (`docs/API-PARCEIRO.md:277`), e o Fastify sobe **sem `bodyLimit`** (default 1 MB; os 3 MB de `app.ts:77-81` são só do parser binário de foto). Lote grande devolve **413 com `code: 'INTERNAL_ERROR'`** — indistinguível de bug do servidor.

**13. `error_erp` e `delivered`: decidir ou remover.** *Esforço: médio.* `error_erp` está no CHECK do banco, no zod e no mapa de fluxo, mas **nenhum array do `ORDER_STATUS_FLOW` o tem como destino** (`orderStatus.ts:38-45`) — nem uma chamada manual chega lá. Mesmo assim ele já conta para a meta do rep (`bonus.ts:80-85`) e já tem cor vermelha na tela. Idem `delivered` (`packages/shared/src/types/order.ts:66-71`: *"Sem fonte ainda — nem o gerente marca, nem o ERP informa"*).

**14. Reconciliação item a item.** *Esforço: grande.* O contrato de faturamento só aceita `valor_faturado` **agregado** (`faturamento.service.ts:109-113`). Para mostrar quais peças foram cortadas, o ERP precisa devolver as **linhas** faturadas. A identificação do item não é o problema (§1.4) — o problema é a volta.

**15. Pedido excluído depois de puxado.** *Esforço: médio.* A exclusão é DELETE de verdade, com cópia em `deleted_orders` (040) e sem rota de restauração. Nada impede excluir pedido em `sent_erp` (`deleteOrder` só barra `invoiced`, `orders.service.ts:534`). Não há rota de cancelamento nem campo "cancelado" no contrato da API — para o robô do Fábio, vira pedido fantasma no Control.

---

## 4. ARMADILHAS

### 4.1 Divergências entre doc e código

- **"São três."** A página pública diz *"São três. Um para testar, um para buscar, um para confirmar"* (`api-parceiro.html:896`) e nunca documenta `POST /clientes` e `POST /representantes` como endpoints — só os cita numa tabela de donos do dado (`:1229-1230`). A página já tem **quatro** blocos de endpoint (901, 922, 1004, 1062), então a frase está errada até dentro do próprio arquivo. `docs/API-PARCEIRO.md` documenta os seis. **É a página que seria enviada ao Fábio.**
- **Doc congelada.** Página e `docs/API-PARCEIRO.md` estão parados no commit `b7eb965` (25/08/2026): não registram a normalização do número (10/09) nem o modo de falha novo criado pelo índice único da 042.
- **"O aplicativo nunca escreve no banco do ERP"** (`docs/API-PARCEIRO.md:16-17`) — enquanto `sync.py --mode push-orders` escreve, inclusive **DDL**: `CREATE GENERATOR` (`sync.py:445-458`). Isso é escrita de esquema no banco de produção do Fábio e precisa ser dito a ele nesses termos.
- **`ESTRUTURA.md` não menciona a API de Parceiro** (grep por `partner`/`parceiro`: zero), omite `push-orders` da lista de modos do sync.py (`:232-233`) e descreve `_tools/firebird-reader/` (`:235`), pasta que não existe no disco. E o `CLAUDE.md:3` manda ler o ESTRUTURA antes de mexer em qualquer coisa.
- **README podre:** manda rodar `docs/schema.sql` (não existe nenhum `schema.sql` no repo), diz SHA-256 quando o seed usa bcrypt, e instrui a "substituir a instância exportada `erpAdapter`" — que é **código morto** (nenhum importador em `apps/api/src`; `FirebirdErpAdapter.sendOrder` é stub que loga *"escrita no ERP não implementada ainda"*, `adapter.ts:41-49`).
- **`Corpo-Sensual-B2B-Relatorio-Tecnico.pdf`** na raiz é trabalho acadêmico do SENAI (julho/2026) e afirma que "o adaptador foi substituído pela integração real com o Firebird" e que há leitura em tempo real. **Não mostrar esse PDF ao Fábio como estado do sistema.**

### 4.2 Erros conhecidos de leitura (já circularam como verdade — não repita)

- **"Não há teste do módulo partner."** Falso. `tests/faturamento-do-parceiro.test.ts` e `tests/parceiro-cadastros.test.ts` existem (os testes moram em `tests/` na raiz, não junto do código). O que **não** tem teste é `GET /pedidos`, `confirmOrderImport` e a autenticação por chave.
- **"A doc promete 409 e o código devolve 500."** Falso, e é pior: o 409 documentado (`API-PARCEIRO.md:180`) é o caso do **mesmo pedido** já confirmado com outro número — esse o código trata. O caso "número já usado por **outro** pedido" **não está documentado em lugar nenhum**. Não é alinhar doc e código: falta **decidir o contrato**.
- **"Não há código aproveitável além da interface do adapter."** Falso: existe integração Firebird de **leitura** inteira e funcional (~800 linhas, §1.3). Falta só a mão de volta.
- **"O push-orders inventa o número do lado do app."** Falso: o `GEN_ID` roda **dentro do Firebird**, sobre o generator do próprio ERP (`GEN_PEDIDO_UNIVERSAL`), e a série `SX` já era usada na fábrica (`_tools/erp-sync/.env.example:19-21`; histórico — a série SX foi descontinuada em 16/09/2026, decisão 1: só `CS` e `PL`). O problema não é número inventado — é **quem cunha**.
- **"O app não tem trigger de `updated_at`."** Falso: a 013 cria trigger em 6 tabelas (§2.4). O que falta é `order_items` e `deleted_orders`.
- **"São 4 pendências"** → são **5**. **"`discount_percent` tem 6 casas"** → é `NUMERIC(5,2)`. **"O faturamento tem 5 motivos de ignorado"** → são **6** (falta `falha ao gravar`, que é o que o torna realmente tolerante).
- **"Todos os scripts de `_tools` têm empresa fixa."** Falso para `conferir-pendencias.mjs`, `conferir-fila-e-tabelas.mjs` e `backup.mjs` — eles não filtram `company_id` e por isso servem para os dois bancos.

### 4.3 O que quebra produção

- **Cache eterno de colunas na rota de pedidos.** `partner.service.ts:119-135` tem detector próprio que memoriza o resultado **para sempre**. Migração aplicada com a API de pé → `condicao_pagamento`, `desconto_percentual` e `faturado` saem nulos/zero **até reiniciar**, sem aviso no payload nem no log. (O faturamento já foi migrado para `lib/detectarColuna.ts`, que guarda o "não existe" por só 30s — commit `3d656be`. **Metade do módulo já está corrigida.**)
- **Cache eterno de chaves.** `partner.auth.ts:22` — trocar/revogar chave exige restart. E se a env estiver vazia, o vazio também fica memorizado.
- **Duas URLs possíveis da mesma API** (Railway e função serverless na Vercel) → significados diferentes para "reiniciar para trocar a chave".
- **Sem rate limit próprio.** Vale só o global de 300 req/min por IP (`app.ts:62-67`), sem allowList. Login, orders, ia e access declaram limite próprio; `partner` não declara nenhum.
- **`POST /clientes` não é tolerante com erro de banco:** `partner.sync.service.ts:234-243` lança e o request inteiro vira 500, perdendo o lote (os anteriores já gravaram). O faturamento, esse sim, é tolerante.
- **`upsertBatch` sem `onConflict`** (`erpSyncService.ts:47-51`) + preço duplicado dentro do lote (mesmo par `product_id, price_table_id`, em **ambos** os scripts: `erpSyncService.ts:217-235` e `sync.py:296-319`). **Não ligue `ERP_SYNC_ENABLED=true` sem corrigir os dois.** E os dois gravam `description: null` em `products` — ligar o sync apaga descrição editada no app (o `image_url` foi protegido por omissão; a descrição não).
- **Teste instável:** `tests/enviar-pra-fabrica.test.ts` estoura o timeout de 5s sob carga da suíte completa e derruba o `pnpm verify` (isolado, passa em ~4,4s). Num repo sem CI, é o tipo de coisa que ensina a ignorar o portão.

### 4.4 Caminhos concorrentes e efeitos colaterais

- **Três escritores de `erp_order_id`, dois de `invoiced`** (§3, item 1).
- **A confirmação da API sequestra a sugestão da tela.** `ultimoNumeroErp` escolhe o último número por `synced_at desc` (`orders.service.ts:959-969`) e a confirmação da API grava `synced_at`. Efeitos: (a) número fora do formato faz `proximoNumeroErp` devolver string vazia e **a sugestão some**; (b) se o ERP usar `SX` (histórico — série descontinuada em 16/09/2026) e a Larissa `CS`, as séries se misturam no mesmo campo e a sugestão sai da série errada (`LancarNoErp.tsx:48,94`). *Detalhe: `corrigirNumeroErp` **não** atualiza `synced_at` (`orders.service.ts:944-948`) — corrigir não traz o pedido para o topo da sugestão.*
- **O faturamento pela API não avisa o representante.** `avisarFaturadoAoRep` é chamado em **um** lugar: `orders.controller.ts:313`, o handler da tela. No dia em que o ERP ligar, o rep deixa de receber a notificação que recebe hoje — regressão silenciosa.
- **`_tools/faturar-retroativo.mjs` fura a foto da 044:** grava direto no Supabase (`:137-141`) sem passar por `setOrderInvoiced`, então não chama `guardarOriginal` nem dispara aviso.
- **Venda interna edita peças em qualquer status.** `orders.service.ts:676-680` roda **antes** do teto geral (`681`): rep com `venda_interna`, no próprio pedido, mexe até o carimbo do faturamento — **inclusive já em `sent_erp`**. E pedido de venda interna nasce `approved` (`031_venda_interna.sql:7-9`) e cai na fila do parceiro como qualquer outro.
- **Portão de status não confere dono.** Em `updateOrderStatus` a checagem de propriedade é só `if (role === 'rep')` (`:1117`) — financeiro, gerente e admin podem pegar o **rascunho** de um rep e aprová-lo direto, pulando a fila.
- **O script usa a `service_role` sem escopo.** `_tools/erp-sync/sync.py:87` — poder total sobre o banco, numa máquina da fábrica. O oposto da chave de parceiro, amarrada a um `company_id`.

### 4.5 O que quebra o CRM

- **Status novo em `orders` faz o pedido sumir da sincronização com `ok=true`** (§2.4). Qualquer estado novo criado pela integração exige mexer no `mapearStatus` da Edge Function **junto**.
- **Marcar "faturado" à mão no CRM sobrevive indefinidamente** e é apagado sem aviso na primeira vez que alguém mexer naquele pedido no app (a rodada é filtrada por `updated_at`). Entre uma coisa e outra, o `total_comprado` fica alto. Os botões manuais ainda existem (`PedidoDetalhePage.tsx:140-164`).
- **Peças só são reescritas no CRM enquanto o pedido está `orcamento` lá** (`index.ts:851-855`), e a comparação é só por **contagem e total** — trocar tamanho mantendo quantidade e valor não dispara nada. Corte de peça (044) **nunca** chega ao CRM, que fica com o pedido maior que o faturado: Dashboard e curva ABC inflados.
- **Push grande de clientes carimba `updated_at` em tudo** (`partner.sync.service.ts:213`) → a rodada seguinte do CRM lê a base inteira de uma vez. **Pausar o cron antes de qualquer carga grande** — e não há trava contra rodadas simultâneas: o código `CLI-nnnn` é calculado em memória contra um `UNIQUE`, e quando o insert estoura o catch (`index.ts:700-704`) **descarta todos os clientes novos da rodada** e os pedidos deles junto.
- **Falha de marca não deixa rastro no diário:** `index.ts:449-466` retorna antes de abrir a linha em `sincronizacoes`. A tela mostra a rodada da **outra** marca como "Última sincronização". Pode ficar dias sem pedido da PLUMENE com o painel dizendo "sincronizado há 3 min".
- **Todo deploy da Edge Function pela tela do Supabase religa o "Verify JWT"** → cron passa a devolver 401 `UNAUTHORIZED_NO_AUTH_HEADER` (`central/integracao-apps.md:87-91`). O deploy é manual, colando o arquivo no painel.
- **`pedidos.codigo_erp` não tem migração versionada** no repo do CRM — foi rodada à mão em 01/09. E `schema.sql:1` se declara "PROPOSTA... ainda não aplicada": **o repo do CRM não descreve produção com confiança.**
- `deleted_orders` é lido **sem paginação** (`getRaw`, `index.ts:907,149-159`) — acima de 1.000 exclusões, parte dos cancelamentos não chega. A sincronização não filtra `company_id` (assume um Supabase por marca) e o recálculo de `total_comprado` **não filtra marca** — mistura CS + PLUMENE no mesmo cliente.
- **Segunda cópia do contrato de colunas:** `Projeto-CS-SP/scripts/importar-fabricas.mjs:470-483` repete os SELECTs e `:128-135` repete o mapeamento de status. Renomear coluna no app quebra a Edge Function **e** o importador — que é justamente a ferramenta de resgate.
- **A chave do cron também é aceita por query string** (`index.ts:1074`, `?chave=`), o que joga o segredo em log de acesso. Dois resíduos da ativação seguem em aberto (`ESTADO.md:192-200`): trocar a `SINCRONIZACAO_CHAVE` exposta num print em 09/09 e testar o botão da tela.

---

## 5. PROTOCOLO DO REPO

**`main` é produção.** Push sobe na hora: web na Vercel, API no Railway. **Não há CI, não há staging, não há `.github/`** (`CLAUDE.md:8-23`).

1. **Único portão: `pnpm verify`** (typecheck + lint + test, 54 arquivos / 606 testes / ~35s). Falhou, não sobe. Se `tests/enviar-pra-fabrica.test.ts` falhar por timeout, rode o arquivo isolado antes de culpar a mudança.
2. **Git** (`CLAUDE.md:48-86`): `git pull --rebase origin main` **antes de editar**; `git status` antes de commitar; `git add` por **caminho explícito** — nunca `git add .` nem `-A`, porque duas conversas dividem a mesma pasta; `git push` na **mesma resposta** do commit.
3. **Mudança grande sai em worktree** — pasta própria + branch própria (`CLAUDE.md:90-117`). `checkout` no mesmo diretório trocaria os arquivos debaixo da outra sessão. Hoje há 3 worktrees abertos.
4. **Número de migração é reservado por mensagem** entre as sessões antes do commit (combinado de 31/08/2026, depois que duas sessões criaram 033/034 ao mesmo tempo). Lista viva no `ESTRUTURA.md` (`CLAUDE.md:155-158`).
5. **Migração roda à mão no SQL Editor do Supabase, nos DOIS bancos** (Corpo Sensual e PLUMENE), sempre idempotente, cabeçalho padrão *"Executar no Supabase SQL Editor. Idempotente."*. **Não existe runner.** São instalações separadas, em estados diferentes (`apps/web/src/lib/marca.ts:4-8`).
6. **Código que depende de migração usa `detectar()`** (`apps/api/src/lib/detectarColuna.ts`: "sim" vale para sempre, "não existe" vale 30s, erro de rede não memoriza) — **nunca** o cache próprio e eterno de `partner.service.ts:119-135`. Ou então só suba o código depois do SQL aplicado (`CLAUDE.md:149-153`).
7. **Estado do banco se mede, não se lê do arquivo.** `node _tools/conferir-pendencias.mjs` (e com a raiz da PLUMENE como `argv[2]`). Cuidado: a conferência da 042 lê `.limit(1000)` sem paginar (`:56-60`) — com mais de 1.000 pedidos numerados ele pode dizer "0 repetidos" e o `CREATE UNIQUE INDEX` falhar mesmo assim.
8. **Toda escrita que mexer em `order_items` precisa tocar a linha de `orders`** — senão o CRM não enxerga (§2.4).
9. **Não renomeie nenhuma coluna da lista do §2.4** sem alterar a Edge Function do CRM **e** `scripts/importar-fabricas.mjs` no mesmo movimento — e lembrar que o deploy da função é manual e religa o Verify JWT.
10. **Testes moram em `tests/` na raiz**, não junto do código. Há dublê pronto do Supabase (`tests/supabaseFake.ts`) usado pelos dois testes de parceiro.

---

## 6. PERGUNTAS PARA O FÁBIO

**Desenho e canal**
1. Fica valendo o modelo publicado — **o seu programa PUXA** os pedidos (`GET /partner/v1/pedidos`), grava no Control e devolve o número (`POST .../confirmar`) — ou você prefere que o app **insira direto no Firebird**, como o script `push-orders` já sabe fazer? Precisamos matar um dos dois: hoje os dois disputam a mesma fila.
2. O Control (ou a máquina onde o Firebird roda) consegue fazer chamada HTTP para a internet — GET e POST em JSON com header customizado? Tem proxy, firewall ou liberação de endereço a fazer?
3. Quem, do seu lado, escreve o programa que consome a API — você, sua equipe ou o fornecedor do Control? Em que linguagem e em que prazo? É essa pessoa que recebe a chave, e por qual canal?
4. O `PARTNER_API_KEYS` chegou a ser configurado em produção alguma vez? Alguém já chamou `GET /partner/v1/status`?
5. Alguém já rodou `sync.py --mode push-orders` em produção? Existe pedido no Firebird com `IDPEDIDO_EXTERNO` preenchido? E o generator `GEN_PEDIDO_UNIVERSAL` já existia no Control, ou foi o nosso script que criou? (Se foi, isso mexeu na numeração das outras séries.)
6. Você aceita que o app leia o Firebird direto por TCP 3050 com usuário somente-leitura, ou a decisão é que o app nunca toca no seu banco — nem para ler? Existe hoje uma máquina na fábrica com acesso ao Firebird que a gente controla (onde um agente rodaria)?

**Numeração**
7. Qual é a série e a máscara do número que você vai devolver? A produção usa `CS17505`; toda a nossa documentação exemplifica com `SX16680`; o script usa `SX`. São séries por marca (CS = Corpo Sensual, PL = Plumene, SX = pedido de representante)? Qual série a integração usa para cada marca? *(Respondida em 16/09/2026, decisão 1: `CS` na Corpo Sensual e `PL` na PLUMENE; a série SX foi descontinuada — as menções a ela neste brief são histórico.)*
8. A numeração é por série ou existe um contador universal compartilhado (o `GEN_PEDIDO_UNIVERSAL`)?

**Cadastros (é aqui que está o gargalo, não no pedido)**
9. O Control consegue nos informar/preencher o código de cada tabela de preço (o `TABELA_PRECO` de 5 caracteres) e qual coluna de preço (1 a 6) cada uma usa? Sem isso, todo cliente que você empurra entra sem tabela e o pedido sai marcado como não importável.
10. Condição de pagamento nova no Control: como o app fica sabendo? Hoje as 146 foram carregadas uma vez e não há rota de atualização.
11. Você consegue passar a mandar clientes e representantes a cada ~10 minutos (`POST /clientes` e `/representantes`), e só o que mudou (por `DATA_UPDATE`)? A carga por Excel continua ou sai?
12. Qual é a **grafia canônica** do código do cliente no Control: `#2225`, `2225` ou `02225`? E a do representante? Precisamos travar uma e converter as outras na entrada.
13. Cliente cadastrado no app que ainda não existe no Control: seu programa cria e devolve o código, ou o pedido espera alguém cadastrar à mão?

**Faturamento e corte de peças**
14. O Control consegue disparar `POST /partner/v1/faturamento` quando a nota sai? É o passo que faz o pedido virar "Aprovado" para o lojista e contar como venda no painel — sem ele, metade do valor da integração se perde.
15. Quando o financeiro corta peças por falta de estoque, o que o Control tem: só o valor final da nota, ou o registro **item a item** do que foi cortado? Disso depende se conseguimos mostrar as peças ou só a diferença em reais.
16. Nota cancelada ou devolvida: como o app fica sabendo? (A rota aceita `faturado: false` para desfazer.)

**Operação**
17. O Control aceita receber a cor escolhida pelo cliente **como texto na observação do item** (ex.: "3M azul / 2G rosa"), com a coluna COR fixa em `00001`? Ou existe grade por cor lá que valeria usar de verdade?
18. A referência que sai da API é a mesma que o Control importa, inclusive no caso da grade grande que vira produto separado (ex.: `0130 PLUS`)?
19. Existe cópia de teste do Control / do Firebird onde a gente homologue sem sujar a numeração real? Se não, aceita homologar com dois ou três pedidos reais pequenos, combinados antes — que dia, que horário, e quem do seu lado acompanha olhando o Control no mesmo minuto?
20. Se um pedido já lançado no Control for excluído por engano no app, o que deve acontecer do lado de lá? Hoje a exclusão é definitiva no app (com cópia em `deleted_orders`) e o número do Control fica órfão.
21. Qual marca integra primeiro — Corpo Sensual ou PLUMENE? São instalações separadas, com bancos em estados diferentes.

---

## 7. PRIMEIRO PASSO SUGERIDO (não depende do Fábio responder nada)

Ordem para a primeira sessão. Nada aqui muda o desenho da integração — só mede, protege e conserta o que está errado em qualquer cenário.

**1. Medir o estado real, antes de escrever qualquer linha.** (~20 min)
```
node _tools/conferir-pendencias.mjs                 # banco da Corpo Sensual
node _tools/conferir-pendencias.mjs <raiz-PLUMENE>  # banco da PLUMENE
node _tools/conferir-fila-e-tabelas.mjs             # fila parada, tabelas sem erp_code, reps sem código
```
Isso responde: quais migrações **de fato** rodaram em cada banco, quantos pedidos estão parados em `approved`/`sent_erp`, se há número do Control repetido (que faria o `CREATE UNIQUE INDEX` da 042 falhar), e quantos representantes ativos estão sem `erp_rep_id`.

**2. Descobrir se a API está ligada em produção** — teste de 1 minuto, sem chave:
`GET https://setorxweb-production.up.railway.app/partner/v1/status` sem header.
**503 PARTNER_API_DISABLED** = a env não existe. **401 PARTNER_UNAUTHORIZED** = existe chave configurada. Repetir contra a URL da função serverless da Vercel, para saber quantas URLs estão vivas.

**3. Aplicar as migrações pendentes** (depois do passo 1 confirmar que não há número repetido): `_tools/SQL-PARA-RODAR-042-043-044.sql` nos dois bancos e `_tools/SQL-PARA-RODAR-041-NA-PLUMENE.sql` na PLUMENE. A 042 é a rede que falta embaixo de tudo que vem depois.

**4. Escrever o teste que não existe** — `tests/partner-pedidos.test.ts`, usando `tests/supabaseFake.ts` como dublê: a fila padrão, o `?desde`, o `?incluir=todos`, as **cinco** pendências, `importavel`, e os quatro desfechos do `confirmar` (ok, já confirmado, 409, 404). Mais `partner.auth.ts` (503 / 401). É a rede de segurança antes de tocar no módulo — e `pnpm verify` é o único portão que existe.

**5. Endurecer o `confirmar` e paginar o `GET /pedidos`** (itens 4 e 5 do §3, na mesma leva):
- `buscarTudo` em `getPartnerOrders` e em `getPriceTableMap`, e parar de descartar o `error` deste último;
- parar de descartar o `error` do `.single()` em `partner.service.ts:287-294` (o 404 mentiroso);
- validar formato com `numeroErpValido`, checar duplicidade antes de gravar, converter `23505` num erro **nomeado** (e escolher o código: sugestão `409 ERP_NUMBER_IN_USE`, igual ao caminho manual), e recusar confirmação de pedido cujo status não permita a transição.
- Documentar esse novo 409 em `docs/API-PARCEIRO.md` **e** na página pública, porque hoje o caso não existe em contrato nenhum.

**6. Trocar o cache eterno de colunas** de `partner.service.ts:119-135` pelo `lib/detectarColuna.ts` — mesma troca que o commit `3d656be` já fez no faturamento. Sem isso, as migrações do passo 3 só valem para a API de Parceiro depois do próximo restart.

**7. Corrigir o material que vai para o Fábio.** `apps/web/public/api-parceiro.html`: trocar o "São três" por seis e documentar `POST /clientes` e `POST /representantes` como endpoints. É o documento que vai ser enviado — hoje ele faria o Fábio implementar metade da integração sem saber que pode alimentar a carteira pela mesma chave.

**8. Registrar a decisão sobre o `push-orders`** — mesmo que a decisão final dependa do Fábio, deixe escrito no repo (README do `_tools/erp-sync/` ou no `ESTRUTURA.md`) que ele **existe**, que **escreve no Firebird**, que **contradiz o contrato publicado** e que **não deve ser executado** até a decisão. Hoje ele é uma arma carregada que o mapa do projeto nem menciona.

**9. Só então abrir a conversa com o Fábio**, com o §6 na mão e o `GET /partner/v1/status` já respondendo — para que a primeira chamada dele funcione na primeira tentativa.
---

## 8. ORDEM DE LEITURA

Confira o estado no banco antes de acreditar em qualquer arquivo (passo 1 do §7).

### Obrigatório

- **`CLAUDE.md`** (app) — Regras da casa antes de qualquer linha: main e producao, nao ha CI nem staging, migracao roda a mao no SQL Editor, numero de migracao e reservado por mensagem e o add e sempre por caminho explicito porque duas sessoes dividem a pasta.
- **`docs/API-PARCEIRO.md`** (app) — E o contrato que foi prometido ao Fabio: as seis rotas, o payload do pedido, os codigos de erro e a frase 'o aplicativo nunca escreve no banco do ERP' que o sync.py desmente.
- **`apps/api/src/modules/partner/partner.router.ts`** (app) — Ponto de entrada da integracao em 31 linhas: as SEIS rotas registradas (status, pedidos, confirmar, faturamento, clientes, representantes) e a ausencia de qualquer preHandler de JWT ou rate limit proprio.
- **`apps/api/src/modules/partner/partner.auth.ts`** (app) — Explica por que a integracao nao funciona hoje: a chave so existe na env PARTNER_API_KEYS, e memorizada no primeiro request (trocar exige reiniciar a API) e sem ela TODAS as rotas respondem 503 PARTNER_API_DISABLED.
- **`apps/api/src/modules/partner/partner.service.ts`** (app) — O coracao do lado do app: a fila (status=approved e erp_order_id nulo), o payload campo a campo, as cinco pendencias que decidem importavel true/false, e o confirmOrderImport que grava o numero sem validar formato, sem checar duplicidade e sem olhar o status atual.
- **`apps/api/src/modules/partner/partner.faturamento.service.ts`** (app) — A segunda metade do ciclo e o UNICO lugar do repositorio que escreve invoiced_total - sem esta rota, todo pedido faturado conta no painel pelo valor do pedido, nao pelo valor da nota.
- **`apps/api/src/modules/orders/orders.service.ts`** (app) — O caminho que roda de verdade hoje: updateOrderStatus exigindo o numero digitado pela Larissa, o bloqueio do gerente, o ERP_NUMBER_IN_USE, a correcao do numero antes da nota, o portao podeMexerNoPedido e o faturamento manual - e o contraste com tudo que a API de parceiro nao valida.
- **`packages/shared/src/pedidos/numeroErp.ts`** (app) — O numero do Control em 55 linhas: formato duas letras + digitos, a normalizacao que transforma 'cs-17379' em 'CS17379', a sugestao do proximo e o aviso de sequencia - decidiu a conversa sobre serie com o Fabio (CS/PL; a SX foi descontinuada em 16/09/2026).
- **`_tools/erp-sync/sync.py`** (app) — O caminho PARALELO e a primeira decisao do chat: o modo push-orders insere PEDIDO e ITENS_PEDIDO direto no Firebird, cunha o numero pelo GEN_PEDIDO_UNIVERSAL e grava sent_erp no Supabase, consumindo exatamente a mesma fila que a API de parceiro entrega ao ERP.
- **`apps/api/src/config/migrations/042_numero_do_control_unico.sql`** (app) — A unica trava real contra numero do Control repetido, e o comentario dela nomeia o problema por escrito ('a API de Parceiro grava erp_order_id por fora, sem checagem nenhuma') - e ainda precisa ser colada nos dois bancos.
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/central/produto/spec-integracao-erp.md`** (crm) — Sao 67 linhas com a regra de ouro que nao pode ser quebrada: o ERP do Fabio e o unico dono do numero, o CRM nao cria pedido e nao cunha numero, e a API de parceiro para o CRM e projeto futuro.
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/supabase/functions/sincronizar-apps/index.ts`** (crm) — O contrato de leitura do CRM: cada coluna listada nos SELECT literais (customers, orders, order_items, products, product_variants, price_tables, payment_conditions, users, deleted_orders) virou contrato de producao, e renomear qualquer uma quebra a sincronizacao em silencio.

### Importante

- **`apps/web/public/api-parceiro.html`** (app) — E o documento que seria entregue ao Fabio, e esta errado: afirma 'Sao tres' endpoints, nunca documenta POST /clientes e /representantes, e manda pedir a chave para o Yan por canal separado.
- **`apps/api/src/modules/partner/partner.sync.service.ts`** (app) — A mao inversa (o ERP empurrando clientes e representantes), com o casamento por 'miolo' do codigo nos clientes, o casamento EXATO nos representantes e o aviso de que nenhuma tabela de preco tem erp_code preenchido.
- **`packages/shared/src/constants/orderStatus.ts`** (app) — Os sete status e o mapa de transicoes: mostra que sent_erp e terminal e que error_erp nao tem NENHUMA transicao de entrada - ou seja, 'o ERP recusou' e um estado impossivel hoje.
- **`packages/shared/src/constants/statusDoCliente.ts`** (app) — Prova que quem promove o pedido a 'Aprovado' aos olhos do lojista e o campo invoiced, e que o valor da venda e invoiced_total quando existe - e por isso que a rota de faturamento do parceiro vale metade da integracao.
- **`apps/web/src/lib/exportOrders.ts`** (app) — A ponte real de hoje: a planilha oficial do Control, com representante e cliente em branco, e a frase 'nada disso conversa com o ERP ainda' escrita no proprio arquivo, mais os avisos do que o operador precisa conferir antes de lancar.
- **`apps/web/src/components/comercial/LancarNoErp.tsx`** (app) — A tela onde a Larissa digita o numero: mostra a sugestao do proximo, o aviso de numero menor que o ultimo e o modo corrigir - e o que vai colidir no dia em que o ERP passar a confirmar sozinho.
- **`apps/api/src/erp/adapter.ts`** (app) — Armadilha para quem procurar 'como o app manda pedido pro ERP': o FirebirdErpAdapter.sendOrder e um stub que loga 'nao implementada ainda' e o objeto inteiro e codigo morto, sem nenhum chamador.
- **`apps/api/src/erp/firebird/queries.ts`** (app) — Prova que alguem ja teve o Firebird do Fabio em maos: SQL real contra PRODUTO, ESTOQUE_PRODUTO, CLIENTE e TABELA_PRECO, incluindo duas queries escritas e nunca usadas (representantes e clientes delta).
- **`apps/api/src/config/env.ts`** (app) — Mostra as variaveis ERP_DB_* e ERP_SYNC_ENABLED (false por padrao) que ligam o sync e as rotas /erp/*, e que PARTNER_API_KEYS nem passa por aqui - a API sobe sem avisar que a integracao esta desligada.
- **`apps/api/.env.example`** (app) — E o inventario do que precisa ser configurado no Railway para a integracao existir, com a linha PARTNER_API_KEYS vazia e o exemplo do JSON comentado logo acima.
- **`apps/api/src/config/migrations/027_valor_faturado.sql`** (app) — Explica em texto por que o pedido e a nota quase nunca batem (o financeiro corta o que faltou no estoque) e que invoiced_total fica NULL ate o ERP informar - e a regra de negocio por tras da rota de faturamento.
- **`apps/api/src/config/migrations/044_pedido_original.sql`** (app) — A foto do pedido antes do corte de pecas; entender que ela e tirada no faturamento e essencial para nao concluir errado que 'nenhuma peca foi cortada' quando o corte aconteceu dentro do Control.
- **`_tools/SQL-PARA-RODAR-042-043-044.sql`** (app) — O SQL pronto para colar nos DOIS bancos, com o aviso de que os tres recursos ficam desligados ate rodar - a 042 e justamente a trava que falta para a integracao subir com rede.
- **`apps/api/src/lib/detectarColuna.ts`** (app) — O padrao que o codigo usa para sobreviver a migracao pendente ('sim' vale para sempre, 'nao existe' vale 30s) - e o contraste com o cache eterno proprio do partner.service.ts, que so se resolve reiniciando a API.
- **`_tools/conferir-pendencias.mjs`** (app) — A ferramenta que responde o que esta APLICADO no banco, e nao o que os arquivos dizem; rode antes de afirmar qualquer coisa sobre 041/042/043/044 nos dois bancos.
- **`_tools/conferir-fila-e-tabelas.mjs`** (app) — Mede em um comando as tres coisas que travam a integracao: pedidos parados por status, tabelas de preco sem erp_code e representantes ativos sem codigo do ERP.
- **`tests/faturamento-do-parceiro.test.ts`** (app) — E onde esta escrito, no proprio codigo, que 'o ERP do Fabio ainda nao usa esta rota', e o que ja esta trancado por teste (escopo por empresa, valor <= 0 recusado, rota rodando antes da migracao 027).
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/central/integracao-apps.md`** (crm) — O runbook da sincronizacao viva: cron de 10 minutos, a exigencia de manter 'Verify JWT' DESLIGADO a cada deploy, e a admissao de que pedido faturado so no ERP nao chega ao CRM hoje.
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/central/ESTADO.md`** (crm) — O estado registrado da ativacao de 09/09 (primeira carga, secrets, cron com ok=true) e os dois residuos ainda em aberto: trocar a SINCRONIZACAO_CHAVE exposta num print e testar o botao da tela.
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/supabase/migracao-sincronizacao-apps.sql`** (crm) — Define pedidos.origem_app_id e o indice unico por (marca_id, origem_app_id), que e a chave estavel que faz a troca de APP-14632 por CS17505 acontecer na mesma linha, sem duplicar pedido.

### Consulta

- **`ESTRUTURA.md`** (app) — O mapa oficial do codigo, util para achar as coisas - mas leia sabendo que ele NAO menciona o modulo partner nem o modo push-orders do sync.py, e cita uma pasta firebird-reader que nao existe no disco.
- **`apps/api/src/modules/partner/partner.controller.ts`** (app) — Os seis handlers com os codigos de erro exatos que o programador do Fabio vai ver (INVALID_DESDE, MISSING_PEDIDO_ERP, ORDER_NOT_FOUND, ORDER_ALREADY_CONFIRMED, BATCH_TOO_LARGE) e o teto de 1000 registros por lote.
- **`tests/parceiro-cadastros.test.ts`** (app) — Mostra o que ja esta trancado na mao inversa: upsert por codigo, tolerancia com motivo, endereco em pedacos e representante que nunca nasce por POST.
- **`apps/api/src/modules/orders/orders.router.ts`** (app) — As rotas e os papeis do lado do app (status, numero-erp, invoice, excluidos), para saber quem pode fazer o que quando a integracao automatica conviver com a mao humana.
- **`apps/api/src/modules/orders/pedidoOriginal.service.ts`** (app) — Os tres gatilhos da foto do pedido original e a regra de que so a primeira vale (rascunho nunca gera foto), caso a conversa com o Fabio va para o corte de pecas item a item.
- **`apps/api/src/config/migrations/041_cadastro_real.sql`** (app) — O cadastro de cliente igual ao do Control (endereco em campos separados, IE, cnpj_digits, erp_linked_by) - e a base do que o ERP empurra por POST /partner/v1/clientes.
- **`apps/api/src/config/migrations/013_protecoes.sql`** (app) — Tem duas coisas que quase ninguem sabe que existem: a trigger que carimba updated_at em orders/customers e a tabela order_status_history, que grava a hora exata de cada mudanca e nunca foi lida por codigo nenhum.
- **`apps/api/src/erp/firebird/erpSyncService.ts`** (app) — O sync TypeScript de leitura (produtos, precos, clientes, estoque) com o defeito latente do upsert sem onConflict - consulte antes de cogitar ligar ERP_SYNC_ENABLED.
- **`apps/api/src/jobs/erpSyncScheduler.ts`** (app) — Prova que da para rodar job periodico no processo do Railway (e o unico setInterval do servidor), caso a integracao precise de um robo que puxe ou vigie a fila.
- **`_tools/erp-sync/.env.example`** (app) — Responde metade das perguntas sobre numeracao antes de perguntar ao Fabio: a serie SX 'ja usada na fabrica' (historico: descontinuada em 16/09/2026) e o GEN_PEDIDO_UNIVERSAL como sequencia unica compartilhada por todas as series.
- **`apps/web/src/modules/pedidos/PaginaPedidos.tsx`** (app) — As filas do financeiro ('A lancar' = approved sem faturar) sao literalmente a mesma fila que a API entrega ao ERP - e onde se ve o conflito entre o robo e a mao da Larissa.
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/src/data/supabase/sincronizacao.ts`** (crm) — Mostra que o resumo da tela le cru o JSON gravado em sincronizacoes.resultado, entao renomear um contador da Edge Function faz a tela mostrar zero sem quebrar nada visivel.
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/src/modules/pedidos/PedidosPage.tsx`** (crm) — A fila 'A vincular' e os cartoes que mostram o codigo_erp (que pode ser a chave provisoria APP-<numero>) - e onde o efeito da integracao aparece para o time do CRM.
- **`C:/Users/Yan/Desktop/Projeto-CS-SP/scripts/importar-fabricas.mjs`** (crm) — Segunda copia do mesmo contrato de colunas do app (e do mapeamento de status), entao qualquer renomeacao no app quebra tambem a ferramenta de resgate.

### Comandos que dão contexto rápido

```bash
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && grep -n "fastify\.\(get\|post\)" apps/api/src/modules/partner/partner.router.ts   # as SEIS rotas da integracao em 10 segundos
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && git log --format="%h %ad %s" --date=short -- apps/api/src/modules/partner/   # os 10 commits da API de parceiro, de 15/07 a 11/09 - nenhum pedido por parceiro real
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && grep -rln "erp_order_id" apps/api/src _tools --include=*.ts --include=*.py --include=*.mjs   # todos os arquivos que tocam o numero do Control (a decisao dos tres escritores)
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && grep -rn "invoiced_total" apps/api/src --include=*.ts   # prova que o unico escritor e partner.faturamento.service.ts:123
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && grep -rn "PARTNER_API_KEYS" apps/api/src apps/api/.env apps/api/.env.example 2>/dev/null   # confirma que nao ha chave emitida no repo (so o .env.example vazio)
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && ls -1 apps/api/src/config/migrations/ | tail -8 && ls -1 _tools/SQL-PARA-RODAR-*.sql   # ultimas migracoes e o SQL que ainda precisa ser colado no Supabase
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && node _tools/conferir-pendencias.mjs   # a VERDADE do banco (nao do arquivo): quais migracoes estao aplicadas; repita passando a raiz da PLUMENE como argumento
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && node _tools/conferir-fila-e-tabelas.mjs   # pedidos parados, tabelas de preco sem erp_code e reps ativos sem codigo do ERP
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && grep -rn "partner/v1" apps _tools tests --include=*.ts --include=*.tsx --include=*.mjs --include=*.py | grep -v "modules/partner"   # prova que NINGUEM dentro do projeto consome a API de parceiro
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && grep -n "push_orders\|INSERT INTO PEDIDO\|GEN_PEDIDO_UNIVERSAL" _tools/erp-sync/sync.py   # localiza o caminho paralelo que escreve direto no Firebird
cd /c/Users/Yan/Desktop/SetorxWeb/SetorxWeb && git log --oneline -10 && git worktree list   # estado do repo e as outras sessoes abertas (main e producao, add sempre por caminho explicito)
git -C /c/Users/Yan/Desktop/Projeto-CS-SP log --oneline -10   # ultimos commits do CRM, incluindo o PR #22/#23 da sincronizacao viva
grep -n "select=\|SELECT_CUSTOMER\|SELECT_ORDER" /c/Users/Yan/Desktop/Projeto-CS-SP/supabase/functions/sincronizar-apps/index.ts   # o contrato de colunas que o CRM le do app - cada nome aqui e producao
grep -rn "partner\|invoiced_total\|order_originals" /c/Users/Yan/Desktop/Projeto-CS-SP/src /c/Users/Yan/Desktop/Projeto-CS-SP/supabase   # mostra que o CRM nao le valor faturado nem pedido original, e so cita a API de parceiro em doc
```
