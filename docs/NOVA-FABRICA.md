# Guia — Colocar uma fábrica nova no sistema

O sistema é **multi-fábrica**: várias empresas usam a mesma API, cada uma com o
catálogo, os representantes e os pedidos **isolados** (uma nunca vê a outra). A
separação é por `company_id` em todas as tabelas.

- A **Corpo Sensual** é a primeira fábrica e continua igual: catálogo vindo do
  ERP (Firebird) pelo agente de sincronização. Nada muda pra ela.
- **Fábricas novas** que não têm/não querem integração de ERP entram por aqui:
  você cadastra a empresa e joga o catálogo por planilha.

- **URL base (produção):** `https://setorxweb-production.up.railway.app`

---

## Passo 1 — Cadastrar a fábrica (você, dono do sistema)

Cria de uma vez: a empresa + uma tabela de preço padrão + o **usuário admin** da
fábrica. É uma rota da **plataforma**, protegida pela sua chave secreta
(`PLATFORM_ONBOARD_KEY`, configurada no Railway). **Essa chave é só sua — nunca
passe para a fábrica.**

```bash
curl -X POST https://setorxweb-production.up.railway.app/companies/onboard \
  -H "Content-Type: application/json" \
  -H "x-platform-key: SUA_CHAVE_DE_PLATAFORMA" \
  -d '{
    "company_name": "Moda Bella Confecções",
    "admin_name":   "Dona Bella",
    "admin_email":  "admin@modabella.com",
    "admin_password": "senha-forte-aqui"
  }'
```

Resposta (201):

```json
{
  "data": {
    "company_id": "…",
    "price_table_id": "…",
    "admin_email": "admin@modabella.com"
  }
}
```

Pronto — a fábrica já existe e o admin dela já consegue entrar no app com esse
e-mail e senha.

> O **e-mail é único no sistema inteiro** (entre todas as fábricas). Se já
> existir, a resposta é `409`. Escolha e-mails próprios da fábrica.

---

## Passo 2 — Importar o catálogo (o admin da fábrica, ou você)

Duas formas — o resultado é o mesmo:

### a) Pela tela (mais simples)

1. Entrar no app como **admin** da fábrica.
2. Menu → **Importar produtos**.
3. **Baixar a planilha modelo**, preencher e subir (`.xlsx` ou `.csv`).
4. Conferir a **prévia** (linhas com erro ficam marcadas e não sobem) → **Importar**.

Colunas da planilha (o cabeçalho aceita variações):

| Coluna | Obrigatória | Exemplo |
|---|---|---|
| `referencia` (ou sku/código) | ✅ | `0001` |
| `nome` (ou descrição) | ✅ | `PIJAMA CURTO FEMININO` |
| `preco` (ou valor) | — | `49,90` |
| `tamanhos` (ou grade) | — | `P:10, M:20, G:5` **ou** `P, M, G` |
| `estoque` | — | `15` (usado quando `tamanhos` não traz o número) |
| `foto_url` | — | `https://.../0001.jpg` |
| `grupo` (ou categoria) | — | `PIJAMAS` |
| `cor` | — | `Azul` |
| `base` (ou modelo) | — | `0172` |

**Cores (opcional):** se a fábrica tem o mesmo modelo em cores diferentes, mande
cada cor como uma **linha própria** (referência própria), com a **mesma `base`**
e a `cor` preenchida:

```
referencia   nome                  cor     base
0172-AZUL    CAMISOLA MODELO 0172  Azul    0172
0172-CINZA   CAMISOLA MODELO 0172  Cinza   0172
```

No catálogo elas viram **um card só** com as bolinhas de cor (estilo Mercado
Livre); o representante escolhe a cor e o tamanho. Cada cor tem sua própria grade
e estoque. Quem **não** usa cor (como a Corpo Sensual) deixa `cor`/`base` vazios —
funciona como hoje ("cores sortidas"). A **cor da bolinha** é calculada
automaticamente a partir da foto no upload.

### b) Pela API (para carga automatizada)

Login como admin → pega o `token` → chama a importação:

```bash
curl -X POST https://setorxweb-production.up.railway.app/products/import \
  -H "Authorization: Bearer SEU_TOKEN_DE_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{
    "products": [
      { "sku": "0001", "name": "PIJAMA CURTO", "price": 49.9,
        "sizes": [ {"size":"P","stock":10}, {"size":"M","stock":20} ] },
      { "sku": "0002", "name": "CAMISOLA", "price": 39.9 }
    ]
  }'
```

Resposta traz um resumo (criados/atualizados, tamanhos, preços) e avisos.

### c) Fotos dos produtos (em lote)

Depois de importar os produtos, na mesma tela **Importar produtos** há a seção
**"Fotos dos produtos (em lote)"**:

1. Escolher **vários arquivos de uma vez**, nomeados pela referência do produto —
   ex.: `0001.jpg`, `0002.png`, `MB003.jpg`.
2. O navegador **reduz cada foto** (máx. 1000px, JPEG) e envia; o sistema guarda
   na **CDN** (nuvem) e já liga a foto ao produto de mesmo código.

- Casa pelo **nome do arquivo = referência** (sem a extensão). `0001.jpg` → produto `0001`.
- Arquivo sem produto correspondente aparece em "sem produto" (não quebra o resto).
- Reenviar a mesma referência **substitui** a foto.
- Limite de **2 MB por foto** (a redução no navegador já deixa bem abaixo disso).
- Diferente do link (`foto_url`), aqui a imagem passa a ser **do sistema** — não
  depende de servidor externo e carrega rápido pela CDN.

Pela API (equivalente da tela): `POST /products/fotos?sku=0001` (admin), com a
imagem já redimensionada **no corpo como binário** (`Content-Type: image/jpeg`).

---

## Regras e limites (leia antes de rodar)

- **Idempotente:** importar de novo o mesmo `sku` **atualiza** (não duplica).
  A chave é a `referencia` (sku) dentro da empresa.
- **Sem preço** → o produto aparece como "sob consulta".
- **Sem tamanhos** → é criado um tamanho único `U` (senão o produto não entraria
  num pedido).
- **Reimportar com menos tamanhos NÃO remove** os que sumiram (eles continuam
  ativos). Isso é proposital, para não apagar estoque por engano.
- **Não misture** import manual com o sync de ERP na **mesma** empresa — um pode
  sobrescrever o outro. Corpo Sensual usa ERP; fábricas novas usam import.
- **Fotos por link (`foto_url`)** ficam no servidor de quem enviou (não são
  copiadas para a CDN). Se o link cair, a imagem quebra.
- **Máximo 2000 produtos por importação** (rode em lotes se tiver mais).

---

## Depois de importar

- Cadastrar os **representantes** da fábrica (menu Representantes, como admin/gerente).
- Cada rep recebe uma **tabela de preço** — sem ela, ele vê o catálogo mas não
  fecha pedido (o preço vem da tabela do rep). A importação preenche a
  **TABELA PADRÃO**; se a fábrica usar mais de uma tabela, ajuste os preços por lá.
- A partir daí a fábrica usa o sistema igual à Corpo Sensual: catálogo, pedidos,
  aprovação e comissões — tudo isolado.

---

## Configuração necessária (uma vez, no Railway)

- `PLATFORM_ONBOARD_KEY` — a chave que libera o Passo 1. Sem ela, `/companies/onboard`
  responde `503` (onboarding desligado).
- Rodar a migração **`010_company_cascade.sql`** no Supabase SQL Editor (permite
  excluir uma fábrica limpo, sem travar por chave estrangeira).
