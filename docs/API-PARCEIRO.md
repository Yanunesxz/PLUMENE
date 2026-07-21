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
{ "ok": true, "parceiro": "corposensual", "servidor_hora": "2026-07-15T20:13:15.006Z" }
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
      "itens": [
        { "produto": "0015", "tamanho": "EG", "cor": "00001",
          "quantidade": 3, "preco_unitario": 42.9, "valor_total": 128.7 },
        { "produto": "0015", "tamanho": "G", "cor": "00001",
          "quantidade": 2, "preco_unitario": 55.0, "valor_total": 110.0 }
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
| `valor_total` | número | Total do pedido |
| `observacoes` | texto ou null | Anotações do representante |
| `pedido_erp` | texto ou null | Número no ERP (preenchido após a confirmação) |
| `cliente.codigo_erp` | texto | **Código do cliente no seu ERP** (campo CLIENTE) |
| `cliente.cnpj` | texto ou null | CNPJ/CPF para conferência |
| `representante_erp` | texto | **Código do representante no seu ERP** (campo REPRESENTANTE) |
| `tabela_preco.codigo_erp` | texto | **Código da tabela de preço no seu ERP** |
| `tabela_preco.coluna` | inteiro | Coluna de preço usada (1 a 6) |
| `importavel` | booleano | `true` = todos os vínculos com o ERP presentes |
| `pendencias` | lista | O que falta quando `importavel=false` (ex.: cliente sem código) |

### Campos do item

| Campo | Tipo | Descrição |
|---|---|---|
| `produto` | texto | **Referência do produto no seu ERP** (campo PRODUTO) |
| `tamanho` | texto | Tamanho (P, M, G, GG, EG, numeração...) |
| `cor` | texto | Código da cor. `"00001"` = cores sortidas (pedido por tamanho) |
| `quantidade` | inteiro | Quantidade de peças |
| `preco_unitario` | número | Preço unitário praticado |
| `valor_total` | número | Total do item |

**Sobre a cor:** hoje a operação é por *cores sortidas* — o representante pede
por tamanho e a cor vem fixa `"00001"`. O campo já existe por item; quando/se
houver venda por cor específica (ex.: ref. 0800 em preto, branco e rosa), o
código real da cor virá neste campo, sem mudança no formato da API.

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

## Exemplo completo (linha de comando)

```bash
# fila de pedidos
curl -H "X-API-Key: SUA_CHAVE" \
  https://setorxweb-production.up.railway.app/partner/v1/pedidos

# confirmar
curl -X POST -H "X-API-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"pedido_erp\":\"SX16680\"}" \
  https://setorxweb-production.up.railway.app/partner/v1/pedidos/ID_DO_PEDIDO/confirmar
```

## Boas práticas

- Consulte a fila a cada 1–5 minutos (a chamada é leve).
- Grave o pedido no ERP **antes** de confirmar. Se a gravação falhar, não
  confirme — o pedido continua na fila para a próxima tentativa.
- Trate `409` como alerta: significa confirmação duplicada com números
  diferentes (provável falha no controle interno).
- A chave de API é secreta — não coloque em código-fonte compartilhado.

## Dúvidas / suporte

Falar com Yan (responsável pelo sistema de pedidos).
