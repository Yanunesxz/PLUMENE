# Regras de trabalho — Corpo Sensual B2B

Leia antes de mexer em qualquer coisa. Mapa do código em [ESTRUTURA.md](ESTRUTURA.md),
o que o sistema faz em [SOBRE-O-PROJETO.md](SOBRE-O-PROJETO.md).

---

## 🚨 `main` é produção

Não existe CI, não existe staging. Todo push no `main` sobe **na hora** para os
representantes que estão usando o app em campo:

- `apps/web` → Vercel
- `apps/api` → Railway

O único portão que existe é local. **Antes de qualquer push no `main`:**

```bash
pnpm verify
```

(`typecheck` + `lint` + `test`). Falhou? Não sobe. Não tem "eu conserto depois" —
depois já está no celular do vendedor.

---

## 📍 O repositório é a pasta de dentro

```
Desktop\SetorxWeb\           ← NÃO é repositório. Só um invólucro.
└── SetorxWeb\               ← o repositório é AQUI (git, package.json, apps/)
```

Todo comando git roda de `Desktop\SetorxWeb\SetorxWeb`. Se `git status` responder
`not a git repository`, você está na pasta errada — desça uma.

Nunca rode `git init` na pasta de fora. Já existiu um repositório vazio ali que
enxergava o projeto inteiro como untracked; foi desativado (`_git-vazio-pode-apagar`).

---

## 🔁 O protocolo de commit (obrigatório)

Existem **duas conversas do Claude trabalhando neste mesmo projeto, na mesma pasta
em disco.** Elas não se enxergam. O que impede uma de atropelar a outra é este
protocolo — siga inteiro, sempre, mesmo para mudança de uma linha.

### 1. Antes de editar qualquer arquivo

```bash
git -C SetorxWeb pull --rebase origin main
```

Sem isso você trabalha em cima de código velho. **O `git status` mente sobre o
remoto até você buscar** — já aconteceu de o local dizer "ahead 1" com o commit
já publicado no GitHub. Só `fetch`/`pull` diz a verdade.

### 2. Antes de commitar

```bash
git -C SetorxWeb status
```

Olhe a lista inteira. Apareceu arquivo que **você** não tocou? É edição em
andamento da outra conversa. Não commite junto — commite só os seus caminhos.

### 3. Comitando

```bash
git -C SetorxWeb add caminho/do/arquivo.ts outro/arquivo.tsx
git -C SetorxWeb commit -m "feat(area): o que mudou em português"
```

**Nunca `git add .` e nunca `git add -A`.** Numa pasta compartilhada por duas
conversas, isso varre junto o trabalho pela metade da outra e sobe quebrado
para produção. Sempre caminho explícito.

### 4. Logo depois de commitar

```bash
git -C SetorxWeb push origin main
```

**Na mesma resposta em que comitou.** Commit parado no local é a origem de todo
atropelo: a outra conversa não tem como saber que ele existe. Se não dá para
subir (teste quebrado, mudança incompleta), então não era hora de commitar.

---

## 🌿 Mudança grande = worktree, não branch

Branch **não** isola duas conversas que dividem a mesma pasta: um `git checkout`
troca os arquivos debaixo da outra conversa no meio do trabalho dela.

Trabalho longo (refatoração, feature que leva horas, mexida em várias telas) sai
em uma **pasta própria**, com branch própria, no mesmo repositório:

```bash
git -C SetorxWeb worktree add ../SetorxWeb-grande -b mudanca/nome-da-coisa
```

Isso cria `Desktop\SetorxWeb-grande` com a branch `mudanca/nome-da-coisa`. As duas
conversas passam a ter arquivos separados em disco e nenhuma pisa na outra.
Produção fica intocada até a branch entrar no `main`.

Quando terminar e `pnpm verify` passar:

```bash
git -C SetorxWeb pull --rebase origin main
git -C SetorxWeb merge mudanca/nome-da-coisa
pnpm verify
git -C SetorxWeb push origin main
git -C SetorxWeb worktree remove ../SetorxWeb-grande
```

**Divisão combinada:** correções rápidas e pontuais vão direto no `main` seguindo
o protocolo acima. Mudança em escala vai para worktree.

---

## ✍️ Mensagem de commit

Padrão já usado no histórico: `tipo(area): frase em português, sem acento`.

```
feat(pedidos): o representante escolhe a tabela de preco do pedido
fix(pedidos): a referencia vai sem o E, que e a que o Control conhece
chore(web): rota /exemplo-pedido para a pagina de exemplo
docs(estrutura): a 023 na lista de migracoes
```

Descreva o que mudou para o **usuário do sistema**, não para o compilador.

---

## ⚠️ Coisas que nunca sobem

Já cobertas pelo `.gitignore`, mas confira antes de commitar:

- `.env`, `_tools/erp-sync/.env` — credenciais
- `*.FDB` / `*.GDB` — banco do ERP
- `backups/` — dados de cliente e hash de senha
- `node_modules/`, `dist/`

---

## 🗄️ Banco (Supabase)

Migration é arquivo numerado em `apps/api/src/config/migrations/`, rodado à mão no
SQL Editor do Supabase. **O código pode subir antes da migration rodar** — então
mudança que depende de coluna nova usa guarda `detectar*()` no serviço, ou só vai
para o `main` depois do SQL aplicado. A lista viva está no ESTRUTURA.md — este
arquivo não repete o número da última de propósito, porque desatualiza.

**Número de migração é reservado POR MENSAGEM entre as sessões antes do commit**
(combinado de 31/08/2026, depois que duas sessões criaram 033/034 ao mesmo
tempo). Confira o maior número no ESTRUTURA.md E avise as outras sessões qual
você vai usar.
