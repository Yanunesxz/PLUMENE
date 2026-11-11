# Estado — Corpo Sensual B2B

Atualizado em 01/10/2026.

## Padrão visual: SystemDesing v0.5.2

- Sistema de **cliente**: Corpo Sensual (cor principal: preto do monograma; a
  PLUMENE, que roda o mesmo código, também segue o padrão com a cor dela —
  falta o Yan mandar o hex).
- Quem usa: ~28 representantes na rua (celular) + escritório (financeiro,
  gerente, admin, venda interna) no computador + lojas com login.
- **Menu no celular: abas** (o que já existia, mantido a pedido do Yan).

### Etapa 1 — no ar (01/10/2026)

Feito sem trocar nenhuma classe de tela, para não quebrar nada em produção:

- Fonte **Manrope** em tudo (pacote `@fontsource-variable/manrope`, dentro do
  app — ele trabalha offline). Saíram Inter e Bodoni.
- **Cores do padrão** nos tokens que o app já usava (`--background`, `--card`,
  `--primary`…): neutros preto/branco/cinza e status `#116329 / #7A5200 /
  #B3121F` (claro) e `#3FB950 / #D29922 / #FF7B72` (escuro).
- **Tema claro e escuro**: começa igual ao aparelho; lua/sol na barra do topo
  (celular) e no canto do usuário do menu lateral (computador) — e só ali,
  pedido do Yan (01/10/2026). Chave `tema` no localStorage; `public/tema.js` chamado
  no `index.html` (não pisca). Logo invertida no escuro.
- Cores fixas que quebravam no escuro trocadas por token (`text-white`,
  `bg-white`, `bg-gray-800` em botão de perigo, toast, faixa de reconexão,
  catálogo, painel e pedidos).
- Sem a linha "Criado por Yan Nunes": o Yan pediu para tirar (01/10/2026).
- `index.html`: `color-scheme` e `theme-color` claro/escuro.

### Segurança da v0.5.2 — no ar com o PR `claude/padrao-v0.5.2` (11/11/2026)

- `apps/web/vercel.json` com os cabeçalhos do padrão e **CSP**: só o próprio
  site, a API no Railway, ViaCEP e o Supabase (fotos). Domínio novo chamado do
  navegador entra na CSP no mesmo PR que o usa.
- Nada de script dentro do HTML: tema em `public/tema.js`, script da página
  `/api-parceiro` em `public/api-parceiro.js`.
- CI (`.github/workflows/ci.yml`): tipos, lint, testes, build, `pnpm audit`,
  gitleaks e trava de chave com prefixo `VITE_`. Dependabot ligado.
- Falta: atualizar os pacotes com falha alta/crítica que o `pnpm audit` acusa
  (a maior parte na API: fastify, @fastify/jwt, zod, nodemailer; no web, o
  `xlsx`, que não tem correção no npm) — até lá o passo do CI fica vermelho.
- Falta (regra da v0.4.1): a tela de trabalho está travada em `max-w-6xl`
  (`AppLayout.tsx` e vitrine pública). Destravar e conferir tela por tela em
  1280px e 1920px.

### Etapa 2 — falta (cada item é um PR, tela por tela)

- **Tailwind 3 → 4** com o bloco `@theme` do padrão (apaga a paleta crua e
  renomeia as classes de cor). Mexe em todas as telas de uma vez: fazer em
  worktree, conferir tela por tela, e só então subir.
- Carregar `tokens.css` e `componentes.css` do jsDelivr @v0.5.2 (linhas com
  `integrity` e `crossorigin` no PADRAO-YAN-NUNES.md, seção 5) (o
  `componentes.css` estiliza `body` e `h1–h4` globalmente — junto com a etapa
  acima).
- Casca com `.yn-sidebar`, `.yn-nav`, `.yn-tabbar` (menu recolhível no
  computador).
- Componentes `.yn-*`: kanban, timeline, banner, combobox, grade tamanho × cor,
  decisão com motivo, `.yn-empty[data-state="error"]`, "Sem dados".
- Raios (`rounded-2xl` → 10px), itálico e textos de 10–11px (mínimo 12px):
  67 ocorrências, mais da metade em `components/comercial`.
- Página pública do pedido (`PaginaPedidoPublico.tsx`): tem tema escuro feito à
  mão, com cores próprias — trocar pelos tokens.
