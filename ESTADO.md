# Estado — Corpo Sensual B2B

Atualizado em 01/10/2026.

## Padrão visual: SystemDesing v0.2.0

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
  (celular) e no rodapé do menu lateral (computador); "Aparelho · Claro ·
  Escuro" no pé de toda tela e no login; chave `tema` no localStorage; script
  de uma linha no `index.html` (não pisca). Logo invertida no escuro.
- Cores fixas que quebravam no escuro trocadas por token (`text-white`,
  `bg-white`, `bg-gray-800` em botão de perigo, toast, faixa de reconexão,
  catálogo, painel e pedidos).
- **Crédito** "Criado por Yan Nunes" em uma linha, no pé das telas e no login.
- `index.html`: `color-scheme` e `theme-color` claro/escuro.

### Etapa 2 — falta (cada item é um PR, tela por tela)

- **Tailwind 3 → 4** com o bloco `@theme` do padrão (apaga a paleta crua e
  renomeia as classes de cor). Mexe em todas as telas de uma vez: fazer em
  worktree, conferir tela por tela, e só então subir.
- Carregar `tokens.css` e `componentes.css` do jsDelivr @v0.2.0 (o
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
