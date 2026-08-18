# Marca nova no sistema — o que pedir, o que criar, quanto custa

Complementa o [NOVA-FABRICA.md](NOVA-FABRICA.md): lá está o **como fazer** (as rotas,
a planilha). Aqui está o **o que juntar antes** — a lista para levar à marca, a ordem
de execução e o custo real de infraestrutura.

**Arquitetura escolhida: instalação separada (espelho).** A marca nova NÃO entra no
banco nem no endereço da Corpo Sensual. Ela ganha uma instalação própria do mesmo
código: Supabase próprio (na conta Google da marca, plano gratuito), API própria no
Railway, app próprio no Vercel, Gmail próprio de envio. O que as duas marcas dividem
é **só o código** — o mesmo repositório abastece as duas instalações.

Consequências práticas:

- **Separação total de verdade**: bancos diferentes, chaves diferentes, tokens que
  não valem de um lado no outro. Não depende do isolamento por `company_id` (que
  continua existindo, mas vira redundância).
- **Sem risco de vazamento pelo sincronizador do ERP**: o banco novo nem tem os
  dados da CS, e a instalação nova sobe com `ERP_SYNC_ENABLED` desligado.
- **Custo mínimo**: tudo em plano gratuito, exceto possivelmente o Railway (abaixo).
- **O preço escondido**: push no `main` sobe para **as duas marcas**. Bug novo vai
  para as duas; correção também. O `pnpm verify` passa a proteger dois clientes.

---

## Parte 1 — A lista para pedir à marca

Está escrita para ser copiada e mandada. **🔴 = sem isso não roda. 🟡 = pode entrar
depois.**

### 1. Identidade da marca 🔴

| Item | Formato | Para quê |
|---|---|---|
| Nome como deve aparecer no app | texto | topo do app, e-mail do pedido, vitrine |
| Razão social + CNPJ | texto | cadastro e documentos |
| Logo | PNG, fundo branco ou transparente, **mínimo 512×512** | login, topo, ícone do app instalado |
| Cor principal | código hex (ex.: `#0f766e`) | botões e destaques |
| WhatsApp de suporte | número com DDD | botão "preciso de ajuda" do representante |

> A logo entra em três lugares com recortes diferentes (retangular no topo,
> quadrada no ícone do celular). Se vier só o arquivo do cartão de visita, o
> ícone do app sai torto — peça a versão quadrada junto.

### 2. Contas e e-mails 🔴

A instalação é separada, então a marca precisa das **contas dela**:

| Conta | Para quê | Observação |
|---|---|---|
| **Conta Google da marca** | abriga o projeto Supabase (banco + fotos) | já existe — é a que vocês criaram |
| **Gmail remetente** (ex.: `pedidos.marca@gmail.com`) | envia o e-mail de cada pedido | verificação em duas etapas ligada + **senha de app de 16 letras** gerada na conta Google. Não é a senha normal |
| **Login do dono** (ex.: `admin@marca.com.br`) | vira o usuário admin da fábrica no app | pode ser qualquer e-mail; único dentro da instalação |
| **Caixa da fábrica** (ex.: `producao@marca.com.br`) | recebe cópia de cada pedido fechado | pode ser o mesmo Gmail remetente |
| Conta Vercel (grátis) | hospeda o app | pode ser criada com a conta Google da marca |

> Como gerar a senha de app: conta Google → Segurança → Verificação em duas
> etapas (ligar) → Senhas de app → criar → copiar as 16 letras. Sem isso o
> e-mail de pedido não sai.

### 3. Catálogo — a planilha 🔴

Uma linha por referência. Cabeçalho aceita variações de nome:

| Coluna | Obrigatória | Exemplo |
|---|---|---|
| `referencia` (ou sku, código) | ✅ | `0001` |
| `nome` (ou descrição) | ✅ | `PIJAMA CURTO FEMININO` |
| `preco` (ou valor) | — | `49,90` — sem preço a peça aparece "sob consulta" |
| `tamanhos` (ou grade) | — | `P:10, M:20, G:5` ou só `P, M, G` |
| `estoque` | — | `15` (usado quando `tamanhos` não traz número) |
| `grupo` (ou categoria) | — | `PIJAMAS` |
| `cor` | — | `Azul` |
| `base` (ou modelo) | — | `0172` — junta as cores do mesmo modelo num card só |
| `foto_url` | — | link, se as fotos já estiverem na internet |

Regras que valem a pena avisar antes:
- **Máximo 2000 produtos por importação.** Mais que isso, em lotes.
- **Importar de novo o mesmo código atualiza, não duplica.**
- **Sem tamanho** → o sistema cria um tamanho único `U`, senão a peça não entra em pedido.
- **Reimportar com menos tamanhos não apaga** os que sumiram (proteção contra apagar estoque por engano).
- **Cor:** cada cor é uma linha própria, com referência própria e a mesma `base`.
  Quem não trabalha com cor deixa as duas colunas vazias.
- **Nome da peça diz o público.** Os filtros do catálogo ("Apenas Feminino",
  "Infantil/Juvenil") leem o NOME do produto: peça masculina precisa de
  `MASCULINO`/`MASC.` no nome, infantil de `INFANTIL`, juvenil de `JUVENIL`.
  Peça sem marcação é tratada como feminina — a convenção da casa. Sendo a
  marca também de pijamas, é só seguir o mesmo padrão de nome.

### 4. Fotos dos produtos 🟡

- Um arquivo por referência, **nomeado com a referência**: `0001.jpg`, `MB003.png`.
- Sobem em lote pela tela "Importar produtos" (o navegador reduz cada uma para
  1000px antes de enviar). **Limite de 2 MB por foto** depois da redução.
- Arquivo sem produto correspondente é listado à parte, não quebra o resto.
- Foto por link (`foto_url`) fica no servidor de origem — se o link cair, a
  imagem some. Foto enviada em lote passa a ser do sistema.

O catálogo funciona sem foto, mas vender sem foto no celular é outra coisa.
Se não der para tudo, peça as fotos dos **carros-chefe** primeiro.

### 5. Preços 🔴

- **Quantas tabelas de preço existem?** (à vista / a prazo / por região / por
  volume). Uma planilha de preço por tabela.
- **Tamanho grande custa mais?** O sistema já sabe cobrar mais em
  `EG/EGG/EGGG/XG/XG2/XG3/XG4/48/50/52/54`, mas precisa do **segundo preço** por
  referência. Se não vier, todo tamanho sai pelo preço normal.
- **Quem define o preço do pedido é a tabela do representante** — rep sem tabela
  vê o catálogo e não fecha pedido.

### 6. Representantes 🔴

Uma linha por rep:

| Campo | Obrigatório |
|---|---|
| Nome | ✅ |
| E-mail (vira o login) | ✅ |
| Senha inicial | ✅ |
| CPF | ✅ |
| Tabela de preço dele | ✅ |
| Razão social / telefone | 🟡 |
| Código do rep no sistema atual da fábrica | 🟡 — é o que casa a carteira de clientes |

Perguntar também: **o pedido do rep precisa de aprovação do gerente, ou já entra
aprovado?** E se tem **meta/bônus por mês** (opcional, o sistema tem).

### 7. Clientes (carteira) 🟡

Dá para começar sem: o rep cadastra o cliente na hora da visita. Se a marca tiver
a base pronta, peça em planilha:

`razão social` · `nome fantasia` · `CNPJ` · `e-mail` · `WhatsApp` · `endereço` ·
`limite de crédito` · `tabela de preço` · `código do representante dono` ·
`bloqueado (S/N)` e o motivo.

> O **CNPJ é a chave**: é por ele que a carga casa cliente com representante e
> evita duplicado. Planilha sem CNPJ vira base duplicada em três meses.

### 8. Condições de pagamento 🟡

Lista de `código` + `descrição` (ex.: `1 · À VISTA`, `15 · 60 DIAS`). O código é a
identidade, não o texto — pode haver descrição repetida com códigos diferentes.
Sem a lista, o campo fica em branco no pedido e a fábrica preenche na mão.

### 9. Como o pedido chega na fábrica 🔴

A pergunta mais importante da lista, e a que costuma ser esquecida:

- **Como a fábrica lança o pedido hoje?** Papel, WhatsApp, planilha, sistema?
- Se usa um sistema, **qual**? Ele importa planilha? **Peça o arquivo modelo de
  importação** (`.xlsx`) que ele aceita.
- Se não usa nada: o pedido chega por **e-mail + página do pedido** (já pronto) e
  a fábrica separa por ali.

> A exportação que existe hoje é o formulário oficial do **Control**, da Corpo
> Sensual. Serve para outra fábrica **só se ela usar o mesmo Control**. Caso
> contrário é trabalho de código — ou o pedido sai por e-mail/página mesmo.

---

## Parte 2 — Ordem de execução (do nosso lado)

| # | Passo | Depende de |
|---|---|---|
| 1 | **Código: marca configurável por instalação** — nome, logo, cor e textos saem
das telas e viram configuração de build (mais o manifest do PWA e o cabeçalho do
e-mail). É o que permite o mesmo repositório vestir duas marcas | item 1 da Parte 1 |
| 2 | **Supabase da marca**: na conta Google dela, criar o projeto (plano Free) e
rodar as migrações `001` → `029` **na ordem**, no SQL Editor | conta Google |
| 3 | **API no Railway**: projeto novo apontando o mesmo repositório (o `Dockerfile`
e o `railway.toml` já servem). Envs novas: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
(do projeto da marca), `JWT_SECRET` **novo e longo**, `PLATFORM_ONBOARD_KEY` novo,
`CORS_ORIGIN` (endereço do Vercel da marca), `EMAIL_USER`/`EMAIL_APP_PASSWORD`/
`EMAIL_FROM_NAME`, `APP_PUBLIC_URL`. **`ERP_SYNC_ENABLED` fica de fora** (padrão
desligado) | passo 2 |
| 4 | **App no Vercel**: conta da marca, importar o repositório, raiz `apps/web`,
env `VITE_API_URL` = endereço do Railway do passo 3 + as variáveis de marca do
passo 1 | passos 1 e 3 |
| 5 | `POST /companies/onboard` **na API nova** com a chave nova → cria empresa +
TABELA PADRÃO + admin | passos 3 e 4 |
| 6 | Criar as demais tabelas de preço, se houver mais de uma | item 5 |
| 7 | Importar produtos pela tela (ou pela API, em lote) | item 3 |
| 8 | Subir as fotos em lote | item 4 |
| 9 | Carregar as condições de pagamento | item 8 |
| 10 | Cadastrar os representantes e distribuir as tabelas | item 6 |
| 11 | Carregar a carteira de clientes | item 7 |
| 12 | **Teste de ponta a ponta:** login do rep → catálogo → pedido → aprovação →
e-mail → página pública → app instalado no celular | tudo acima |

Passos 2 a 11 levam horas, não semanas — o que demora é a marca juntar o material
da Parte 1 (e o passo 1, que é o trabalho de código).

---

## Parte 3 — Infraestrutura e custo (tudo separado, tudo no gratuito)

Preços consultados em **17/08/2026**, dólar a ~R$ 5,15. Conferir na contratação.

### A instalação da marca

| Serviço | Papel | Plano | Custo |
|---|---|---|---|
| **Supabase** (conta Google da marca) | banco + fotos | Free: 500 MB de banco, 1 GB de fotos, 5 GB de tráfego/mês | **R$ 0** |
| **Vercel** (conta da marca) | o app do representante | Hobby, endereço `marca.vercel.app` | **R$ 0** |
| **Railway** | a API | ver as duas opções abaixo | **R$ 0 a R$ 26/mês** |
| **Gmail** (conta da marca) | envio dos pedidos | conta comum + senha de app, até ~500 e-mails/dia | **R$ 0** |
| Domínio próprio (opcional) | `app.marca.com.br` | Registro.br — funciona no Vercel Hobby | ~R$ 40/ano |

**As duas opções do Railway** (é o único serviço sem plano gratuito permanente):

- **Opção A — projeto novo na conta que já existe** *(recomendada)*: a assinatura
  Hobby de US$ 5/mês já está paga pela CS e inclui US$ 5 de consumo; a segunda API
  é leve e tende a caber no crédito. Custo extra: **R$ 0**, ou o excedente de
  consumo (unidades de reais). As duas APIs ficam na mesma fatura.
- **Opção B — conta Railway própria da marca**: separação também na cobrança.
  **+US$ 5/mês ≈ R$ 26/mês.**

### Total

| Arranjo | Custo mensal |
|---|---|
| Tudo gratuito + API na conta Railway atual (opção A) | **R$ 0** |
| Tudo gratuito + conta Railway própria (opção B) | **~R$ 26/mês** |
| Domínio próprio, se quiserem | +R$ 40/ano (~R$ 3/mês) |

### As letras miúdas dos planos gratuitos

- **Supabase Free pausa o projeto após ~7 dias sem uso.** Com representante usando
  todo dia não acontece; numa implantação que ficar parada, o banco "dorme" e
  precisa ser religado no painel (um clique). Não perde dados.
- **Supabase Free não tem backup automático.** O `_tools/backup.mjs` já existe —
  agendar para rodar também contra o banco da marca.
- **Vercel Hobby é formalmente para uso não comercial.** É o mesmo arranjo que a
  CS já usa; se a Vercel um dia cobrar enquadramento, o Pro custa US$ 20/mês.
- **Gmail comum aguenta ~500 e-mails/dia.** Muito acima do volume de pedidos
  esperado; se um dia passar, Resend/SES são gratuitos até ~3 mil/mês.
- **Limites do Free são POR PROJETO** — a marca tem os 500 MB / 1 GB dela,
  inteiros, sem dividir com a CS.

---

## Parte 4 — O que ainda precisa ser feito no código

Trabalho nosso, antes de a instalação da marca poder subir:

1. **Marca configurável por instalação** — hoje "Corpo Sensual" está escrito em
   ~12 telas, na logo (`public/logo.png`), no nome do app instalado (manifest do
   PWA) e no cabeçalho do e-mail. Vira configuração de build (variáveis `VITE_*`
   no Vercel + envs na API). **É o único bloqueio de verdade.**
2. **Exportação por instalação** — o botão da planilha do Control aparece para
   qualquer gerente; na instalação da marca ele precisa sumir (ou virar o formato
   do sistema dela, se houver — ver item 9 da Parte 1).

Coisas que a instalação separada **resolveu sozinha** (não precisam mais de
código): a trava do sincronizador do ERP (o banco novo não tem ERP), o remetente
do e-mail por marca (cada API tem suas envs) e os filtros do catálogo (a marca
também é de pijamas — as convenções de nome servem).

Não precisa mexer: pedidos, aprovação, faturamento, offline, acesso da loja,
convite, vitrine, importação de produtos, fotos, metas — tudo já funciona.

---

## Parte 5 — Quatro armadilhas

1. **Push no `main` sobe para as duas marcas.** As duas instalações apontam o
   mesmo repositório: o `pnpm verify` passa a proteger dois clientes, e mudança
   arriscada merece worktree em dobro.
2. **Dois apps no mesmo celular.** Rep que atender as duas marcas instala dois
   ícones (cada endereço é um PWA próprio) e tem um login em cada — as contas não
   se falam. Como os bancos são separados, o mesmo e-mail **pode** existir nos
   dois lados sem conflito.
3. **Não misture importação manual com sincronização de ERP na mesma instalação** —
   um sobrescreve o outro. Na instalação da marca, o sync do ERP nem sobe.
4. **Sem tabela de preço, o representante não fecha pedido.** É o erro nº 1 de
   cadastro: o rep entra, vê o catálogo, monta o pedido e trava no fim.
