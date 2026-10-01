# Padrão Yan Nunes — instruções para a IA

> **Para a IA que recebeu este arquivo:** você vai criar ou alterar um sistema, site ou tela da **YAN NUNES — Sistemas & Consultoria**. Siga tudo o que está aqui. Se o pedido conflitar com uma regra, avise e pergunte antes de seguir; não improvise.
>
> Versão **0.2.0** · Fonte oficial: https://github.com/Yanunesxz/SystemDesing · Vitrine: https://systemdesing.vercel.app

---

## 0. Antes de começar, confirme

Pergunte só o que **não** estiver claro no pedido:

1. É **produto da Yan Nunes** ou **sistema de um cliente**?
2. Se for de cliente: **nome do cliente** e **cor principal** dele (hexadecimal, ex.: `#D7263D`).
3. Qual o **nome do sistema ou produto** (ex.: "Yan Nunes CRM", "Pedidos Acme")?
4. Onde vai rodar: **web** (navegador) ou **app** (celular)? Quem usa trabalha **no escritório** (menu gaveta no celular) ou **na rua** (abas embaixo, e precisa funcionar sem internet)?
5. Qual o **tipo de negócio**? Se for um destes, siga também o domínio (leia o link; se não conseguir abrir, peça o arquivo):
   - Representantes e pedidos B2B: https://raw.githubusercontent.com/Yanunesxz/SystemDesing/main/docs/dominios/representantes.md
   - CRM comercial: https://raw.githubusercontent.com/Yanunesxz/SystemDesing/main/docs/dominios/crm.md
   - Atendimento / SAC: https://raw.githubusercontent.com/Yanunesxz/SystemDesing/main/docs/dominios/atendimento.md
   - Loja e marketplaces: https://raw.githubusercontent.com/Yanunesxz/SystemDesing/main/docs/dominios/ecommerce.md

**Stack padrão** (use se o pedido não disser outra): React + Vite + TypeScript `strict` + Tailwind 4 + `lucide-react` + Supabase (Postgres com RLS, Auth, Storage privado, Edge Functions), front na Vercel. API própria em Node + Fastify só quando houver integração pesada. Testes com Vitest.

---

## 1. A marca (contexto)

- **YAN NUNES — Sistemas & Consultoria.** Sistemas sob medida, CRM, sistemas para representantes de vendas, sistemas de produção, automações e consultoria.
- **Posicionamento:** entende a operação da empresa e transforma problemas em soluções tecnológicas.
- **Atributos:** rápido, excelente, certeiro. Visual **tecnológico, sério e atual**: simples, moderno, preto, branco e cinza.
- **Produtos próprios** se chamam "Yan Nunes" + uma palavra: Yan Nunes CRM, Yan Nunes Sales, Yan Nunes Production.
- **Nunca:** visual colorido, degradê, brilho, sombra pesada, cara de "empresa de informática genérica" ou de template pronto.

---

## 2. Fonte: Manrope em tudo

| Peso | Onde usar |
|---|---|
| **Bold 700** | Títulos, números de destaque, logo ("YAN") |
| **SemiBold 600** | Subtítulos, ênfase no meio do texto |
| **Medium 500** | Menus, botões, rótulos, navegação, cabeçalho de tabela, etiquetas |
| **Regular 400** | Texto, descrições, tabelas, campos |

- **Proibido itálico.** A Manrope não tem itálico. Destaque é por peso.
- **Números em tabelas e indicadores com largura fixa** (`font-variant-numeric: tabular-nums`).
- Tamanhos permitidos: 12, 14, 16, 18, 20, 24 e 30px. Tabelas e formulários usam **14px**. 36 e 48px só em site e página de apresentação, nunca dentro de sistema.
- Rótulos pequenos (título de card, cabeçalho de tabela) em **MAIÚSCULAS**, 12px, Medium, espaçamento entre letras de 0.12em.
- Web: Google Fonts, `family=Manrope:wght@400..700`. App: pacote do Google Fonts da plataforma (ex.: `google_fonts` no Flutter).

---

## 3. Cores

**Regra:** só preto, branco e cinza. As únicas outras cores permitidas são **as de status** e **a cor principal do cliente**.

### Neutros

| Função | Tema claro | Tema escuro |
|---|---|---|
| Fundo da página | `#FFFFFF` | `#000000` |
| Fundo secundário (menu lateral, cabeçalho de tabela) | `#F5F5F5` | `#101010` |
| Card | `#FFFFFF` | `#202020` |
| Borda | `#E5E5E5` | `#3A3A3A` |
| Borda de campo | `#D4D4D4` | `#4A4A4A` |
| Texto | `#000000` | `#F5F5F5` |
| Texto secundário | `#5C5C5C` | `#A3A3A3` |
| Decoração (linhas, ícones) | `#808080` | `#808080` |

> O cinza `#808080` **nunca** é usado em texto: reprova no contraste.

### Status (iguais em todo sistema)

| Significado | Tema claro | Tema escuro | Exemplos |
|---|---|---|---|
| Sucesso / concluído | `#116329` | `#3FB950` | Entregue, pago, ativo, meta batida |
| Em andamento | `#0550AE` | `#58A6FF` | Faturado, enviado, em produção |
| Atenção | `#7A5200` | `#D29922` | Aguardando, atrasado, pendente |
| Erro / perda | `#B3121F` | `#FF7B72` | Cancelado, recusado, erro |

### Cor principal

| Situação | Botão principal e item ativo do menu | Texto em cima |
|---|---|---|
| Produto Yan Nunes, tema claro | `#000000` | `#FFFFFF` |
| Produto Yan Nunes, tema escuro | `#FFFFFF` | `#000000` |
| Sistema de cliente | **cor do cliente** | branco ou preto, o que der mais contraste (mínimo 4,5:1) |

A cor do cliente aparece **só** no botão principal, no item ativo do menu e em destaques de seleção. **Nunca** em texto corrido, títulos, status ou no rodapé "Criado por".
Se a cor do cliente sumir no fundo preto do tema escuro (contraste abaixo de 3:1 com `#000000`), use uma versão mais clara dela no tema escuro.

---

## 4. Ícones: Lucide

- **Só Lucide** (https://lucide.dev). Nunca emoji como ícone, Font Awesome, Material Icons ou ícone de outra família.
- **Traço 1,75.** Tamanho **16px** em botões e campos, **20px** no menu, **24px** em destaque.
- Cor: a mesma do texto ao lado (`currentColor`).
- Botão só com ícone sempre tem `aria-label` (ex.: `aria-label="Filtrar"`).
- Web: `<i data-lucide="search"></i>` + script da seção 5. React (Lovable, v0): `lucide-react`, `<Search size={16} strokeWidth={1.75} />`. App: o pacote Lucide da plataforma.
- Ícones mais usados: `users` (clientes), `shopping-cart` (pedidos), `package` (produtos), `factory` (produção), `truck` (entrega), `file-text` (documentos), `chart-column` (relatórios), `search`, `filter`, `plus`, `download`, `upload`, `settings`, `bell`, `calendar`, `plug` (integrações), `refresh-cw` (sincronizar).

---

## 5. Web: como montar a tela

### Carregue sempre isto no `<head>`

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<!-- Tema escolhido pela pessoa, aplicado antes de a tela aparecer (não pisca) -->
<script>
  try { var t = localStorage.getItem("tema"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Yanunesxz/SystemDesing@v0.2.0/ui/tokens.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Yanunesxz/SystemDesing@v0.2.0/ui/componentes.css">
<script src="https://cdn.jsdelivr.net/npm/lucide@1.49.0/dist/umd/lucide.min.js" defer></script>
<script>addEventListener("DOMContentLoaded", () => lucide.createIcons());</script>

<!-- Só em sistema de cliente: -->
<style>
  :root { --color-brand: #D7263D; --color-brand-contrast: #FFFFFF; }
</style>
```

> Se os links do jsDelivr não carregarem, copie os dois CSS do **Anexo** deste documento para arquivos do projeto.

### Regras de código

- **Nunca** escreva cor, fonte ou tamanho fixo. Use as variáveis (`var(--color-text)`, `var(--space-4)`...) e as classes `yn-*`.
- Tema claro e escuro funcionam sozinhos (seguem o aparelho). Para forçar: `<html data-theme="dark">` ou `"light"`.
- Espaçamentos só da escala: 4, 8, 12, 16, 20, 24, 32, 48, 64px (`--space-1` a `--space-16`).

### Estrutura de um sistema

Todo sistema tem a mesma casca. Quem usa um sistema da Yan Nunes acha tudo no mesmo lugar no próximo.

```
┌───────────────┬───────────────────────────────────────────────┐
│ .yn-sidebar   │ .yn-banner   (só quando há aviso da tela toda)  │
│               ├───────────────────────────────────────────────┤
│ marca     [⇤] │ .yn-topbar   [☰]  título            ação  [☾]  │
│ [empresa ▾]   ├───────────────────────────────────────────────┤
│               │ .yn-content                                   │
│ .yn-nav       │   o conteúdo da tela (até 1280px de largura)  │
│  Visão geral  │                                               │
│  Pedidos  (3) │                                               │
│  CADASTROS    │                                               │
│  Clientes     │                                               │
│               ├───────────────────────────────────────────────┤
│ [JR] Juliana  │ .yn-credit   Criado por Yan Nunes             │
└───────────────┴───────────────────────────────────────────────┘
```

| Peça | Classe | Para que serve | Quando usar |
|---|---|---|---|
| Casca | `.yn-shell` | Menu à esquerda, conteúdo à direita | Sempre |
| Menu lateral | `.yn-sidebar` | Fica parado enquanto a página rola; rola sozinho se for comprido | Sempre |
| Linha de cima do menu | `.yn-sidebar__head` > `.yn-sidebar__brand` + `.yn-sidebar__toggle` | Assinatura do produto ou nome do cliente; botão de recolher | Sempre |
| Contexto | `.yn-menu.yn-menu--block` > `.yn-context` | Trocar de empresa, filial, loja ou equipe | Só se a pessoa trabalha em mais de uma |
| Navegação | `.yn-nav` | Páginas do sistema. Atual com `aria-current="page"`, grupos com `.yn-nav__label`, pendências com `.yn-count` | Sempre; até 8 itens por grupo |
| Usuário | `.yn-sidebar__user` | Avatar, nome, papel e menu (perfil, sair) | Sistema com login |
| Fundo da gaveta | `.yn-scrim` | Escurece a tela atrás do menu aberto no celular | Modelo gaveta |
| Coluna principal | `.yn-main` | Tudo à direita do menu | Sempre |
| Faixa no topo | `.yn-banner` | Modo demonstração, sem internet, versão nova, integração parada | Só quando acontece |
| Barra do topo | `.yn-topbar` | Botão do menu (`.yn-nav-toggle`, só aparece no celular), título (`.yn-eyebrow` + `h1`), a ação principal e o botão de tema | Sempre |
| Conteúdo | `.yn-content` | A tela em si, em grade com 24px entre blocos | Sempre |
| Crédito | `.yn-credit` | "Criado por Yan Nunes", uma linha pequena | Sistema de cliente |
| Abas embaixo | `.yn-tabbar` | Menu do celular no modelo abas | Modelo abas |

**Copie esta estrutura** (modelo gaveta; as diferenças do modelo abas estão nos comentários):

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <!-- o bloco "Carregue sempre isto no <head>", acima -->
  <title>Pedidos · Nome do Sistema</title>
</head>
<body>
<div class="yn-shell">                <!-- modelo abas: class="yn-shell yn-shell--tabs" -->

  <!-- 1. MENU LATERAL -->
  <aside class="yn-sidebar" id="menu" aria-label="Menu">
    <div class="yn-sidebar__head">
      <!-- Produto Yan Nunes: -->
      <div class="yn-sidebar__brand"><span>Yan <span class="yn-light">Nunes</span></span><span class="yn-sidebar__product">CRM</span></div>
      <!-- Sistema de cliente: <div class="yn-sidebar__brand">Nome do Cliente</div> -->
      <button class="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon yn-sidebar__toggle" type="button" aria-label="Recolher menu" aria-expanded="true"><i data-lucide="panel-left"></i></button>
    </div>

    <!-- Só se a pessoa trabalha em mais de uma empresa, filial ou loja -->
    <details class="yn-menu yn-menu--block">
      <summary class="yn-context">
        <span class="yn-context__mark">AC</span>
        <span class="yn-context__text"><span class="yn-context__label">Empresa</span><span class="yn-context__name">Acme Matriz</span></span>
        <i data-lucide="chevrons-up-down"></i>
      </summary>
      <div class="yn-menu__list"><button type="button">Acme Filial Sul</button></div>
    </details>

    <nav class="yn-nav" aria-label="Menu principal">
      <a href="/" aria-current="page" title="Visão geral"><i data-lucide="layout-grid"></i>Visão geral</a>
      <a href="/pedidos" title="Pedidos"><i data-lucide="shopping-cart"></i>Pedidos <span class="yn-count">3</span></a>
      <p class="yn-nav__label">Cadastros</p>
      <a href="/clientes" title="Clientes"><i data-lucide="users"></i>Clientes</a>
    </nav>

    <div class="yn-sidebar__user">
      <span class="yn-avatar">JR</span>
      <span class="yn-sidebar__user-text"><span class="yn-sidebar__user-name">Juliana R.</span><span class="yn-sidebar__user-role">Gerente</span></span>
      <details class="yn-menu">
        <summary class="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon" aria-label="Opções da conta"><i data-lucide="ellipsis-vertical"></i></summary>
        <div class="yn-menu__list yn-menu__list--up">
          <a href="/configuracoes"><i data-lucide="settings"></i>Configurações</a>
          <button type="button"><i data-lucide="log-out"></i>Sair</button>
        </div>
      </details>
    </div>
  </aside>
  <div class="yn-scrim" aria-hidden="true"></div>   <!-- modelo abas: não tem -->

  <!-- 2. COLUNA PRINCIPAL -->
  <div class="yn-main">
    <!-- Faixa só quando há aviso para a tela inteira:
    <div class="yn-banner" data-tone="warning" role="status"><i data-lucide="wifi-off"></i><p>Sem internet. Os pedidos ficam guardados e sobem quando a conexão voltar.</p></div> -->

    <header class="yn-topbar">
      <!-- modelo abas: sem este botão -->
      <button class="yn-btn yn-btn--ghost yn-btn--icon yn-nav-toggle" type="button" aria-label="Abrir menu" aria-controls="menu" aria-expanded="false"><i data-lucide="menu"></i></button>
      <div>
        <p class="yn-eyebrow">Vendas</p>
        <h1>Pedidos</h1>
      </div>
      <button class="yn-btn yn-btn--primary" type="button"><i data-lucide="plus"></i>Novo pedido</button>
      <button class="yn-btn yn-btn--ghost yn-btn--icon" type="button" data-alternar-tema aria-label="Alternar tema claro e escuro">
        <i data-lucide="moon" class="yn-only-light"></i><i data-lucide="sun" class="yn-only-dark"></i>
      </button>
    </header>

    <main class="yn-content">
      <!-- conteúdo da tela -->
    </main>

    <!-- Obrigatório em sistema de cliente -->
    <footer class="yn-credit">Criado por <a href="https://github.com/Yanunesxz" rel="noopener" target="_blank">Yan Nunes</a></footer>
  </div>

  <!-- Só no modelo abas: 3 a 5 destinos; o resto vai em "Mais" (folha de baixo .yn-sheet)
  <nav class="yn-tabbar" aria-label="Menu principal">
    <a href="/" aria-current="page"><i data-lucide="house"></i>Início</a>
    <a href="/clientes"><i data-lucide="users"></i>Clientes</a>
    <a href="/pedidos"><i data-lucide="shopping-cart"></i>Pedidos<span class="yn-count">2</span></a>
    <button type="button"><i data-lucide="ellipsis"></i>Mais</button>
  </nav> -->
</div>
<script src="sistema.js"></script>  <!-- o script abaixo -->
</body>
</html>
```

**O script da casca** (`sistema.js`): gaveta no celular, menu recolhido no computador e troca de tema. Em React, a mesma lógica vira estado (`navAberta`, `menuRecolhido`) e os atributos `data-nav`, `data-sidebar` no `.yn-shell`.

```js
const raiz = document.documentElement;
const casca = document.querySelector(".yn-shell");
const abrirMenu = document.querySelector(".yn-nav-toggle");
const recolher = document.querySelector(".yn-sidebar__toggle");

/* Gaveta (celular): abre pelo botão; fecha no fundo escuro, no Esc e ao escolher um item */
function definirGaveta(aberta) {
  if (aberta) casca.dataset.nav = "open"; else delete casca.dataset.nav;
  abrirMenu?.setAttribute("aria-expanded", String(aberta));
  if (aberta) casca.querySelector(".yn-nav a")?.focus();
}
abrirMenu?.addEventListener("click", () => definirGaveta(casca.dataset.nav !== "open"));
document.querySelector(".yn-scrim")?.addEventListener("click", () => definirGaveta(false));
casca.querySelectorAll(".yn-nav a").forEach(a => a.addEventListener("click", () => definirGaveta(false)));
addEventListener("keydown", e => {
  if (e.key === "Escape" && casca.dataset.nav === "open") { definirGaveta(false); abrirMenu.focus(); }
});

/* Menu recolhido (computador): a escolha fica guardada */
function definirRecolhido(sim) {
  if (sim) casca.dataset.sidebar = "collapsed"; else delete casca.dataset.sidebar;
  recolher?.setAttribute("aria-expanded", String(!sim));
  recolher?.setAttribute("aria-label", sim ? "Abrir menu" : "Recolher menu");
  try { localStorage.setItem("menu-recolhido", sim ? "1" : ""); } catch (e) {}
}
try { if (localStorage.getItem("menu-recolhido")) definirRecolhido(true); } catch (e) {}
recolher?.addEventListener("click", () => definirRecolhido(casca.dataset.sidebar !== "collapsed"));

/* Tema: "light", "dark" ou "" (igual ao aparelho) */
function temaEscuroAgora() {
  return raiz.dataset.theme ? raiz.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function definirTema(valor) {
  if (valor) raiz.dataset.theme = valor; else delete raiz.dataset.theme;
  try { valor ? localStorage.setItem("tema", valor) : localStorage.removeItem("tema"); } catch (e) {}
}
document.querySelector("[data-alternar-tema]")?.addEventListener("click", () => definirTema(temaEscuroAgora() ? "light" : "dark"));
```

### Menu no celular: dois modelos

| Modelo | Para quem | Como monta |
|---|---|---|
| **Gaveta** (padrão) | Quem trabalha no escritório: CRM, SAC, financeiro, produção | `.yn-shell` + botão `.yn-nav-toggle` na barra do topo + `.yn-scrim`. Aberta = `data-nav="open"` no `.yn-shell`. Fecha ao tocar fora, no Esc e ao escolher um item. Ao abrir, o foco vai para o primeiro item; ao fechar, volta para o botão. |
| **Abas embaixo** | Quem trabalha na rua: representante, entregador, vistoria | `.yn-shell.yn-shell--tabs` + `<nav class="yn-tabbar">` com **3 a 5** destinos (ícone + nome curto). O resto vai em "Mais", que abre uma folha de baixo (`.yn-sheet`). Botão flutuante (`.yn-fab`) e avisos sobem acima das abas sozinhos. |

No computador os dois são iguais: menu lateral fixo, que recolhe para só ícones (`data-sidebar="collapsed"`; cada link leva `title` com o nome). Telas completas para copiar: https://github.com/Yanunesxz/SystemDesing/tree/main/ui/exemplos (abertas na vitrine, seção **Telas completas**).

### Tema claro e escuro (obrigatório)

**Todo sistema tem modo claro e modo escuro.** Sem exceção: sistema interno, de cliente, app de rua, painel de TV, site.

1. **Começa igual ao aparelho.** Sem `data-theme` no `<html>`, o CSS segue o celular ou o computador.
2. **A pessoa pode trocar:** botão de lua/sol na barra do topo (`data-alternar-tema`, na estrutura acima) e, em Configurações, a escolha **Aparelho · Claro · Escuro**:
   ```html
   <div class="yn-segmented" role="group" aria-label="Tema">
     <button type="button" aria-pressed="true" onclick="definirTema('')"><i data-lucide="monitor"></i>Aparelho</button>
     <button type="button" aria-pressed="false" onclick="definirTema('light')"><i data-lucide="sun"></i>Claro</button>
     <button type="button" aria-pressed="false" onclick="definirTema('dark')"><i data-lucide="moon"></i>Escuro</button>
   </div>
   ```
3. **A escolha fica guardada** no `localStorage` (chave `tema`). Com login, guarde também no perfil para valer em outro aparelho.
4. **Não pisca ao abrir:** o script de uma linha do `<head>` aplica a escolha antes de a tela aparecer. Em React, ele fica no `index.html`, nunca num componente.
5. **Só tokens.** O escuro vem dos tokens: proibido `.dark .bg-white {…}`, remapear a paleta do framework ou escrever cor fixa. Logo e gráfico em imagem têm versão para fundo escuro.
6. **Toda tela é conferida nos dois temas** antes de entregar.

### Responsivo

**Mobile primeiro:** desenhe para 375px e depois aproveite o espaço maior.

| Faixa | Largura | O que acontece |
|---|---|---|
| Celular | até 768px | Menu vira gaveta ou abas embaixo; uma coluna; 16px de margem lateral; título menor; ações da barra do topo descem para a linha de baixo |
| Tablet e notebook pequeno | 769px a 960px | Menu lateral fixo (recolha se apertar); ficha 360 ainda empilhada; grades se ajustam sozinhas |
| Computador | acima de 960px | Tudo lado a lado; o conteúdo para em 1280px |
| Tela de toque | qualquer largura com dedo (`pointer: coarse`) | Tudo que se aperta tem 44px; campos com letra de 16px (abaixo disso o iPhone dá zoom sozinho) |

Só existem os cortes de **768px** e **960px**; o resto se ajusta sozinho com grade `auto-fit`. Os componentes `yn-*` já fazem tudo isso.

| Peça | Computador | Celular |
|---|---|---|
| Menu | Lateral fixo, recolhível | Gaveta (☰) ou abas embaixo |
| Barra do topo | Título e ações na mesma linha | Título menor; ações descem |
| Indicadores | Até 4 por linha | 1 ou 2 por linha |
| Tabela | Completa | Rola de lado no `.yn-table-wrap`, ou vira cards com `.yn-table--stack` + `data-label` em cada `td` |
| Filtros rápidos | Quebram linha | Uma linha que rola de lado |
| Quadro (kanban) | Colunas lado a lado | Rola de lado, uma coluna por vez |
| Caixa de mensagens | Lista e conversa juntas | Lista **ou** conversa (`data-view="thread"` na `.yn-inbox`), com botão de voltar |
| Ficha 360 | Resumo fixo à esquerda | Resumo em cima, abas embaixo |
| Formulário longo | Título da seção à esquerda | Seções empilhadas; botões do rodapé ocupam a largura |
| Folha de baixo | Janela no meio | Sobe de baixo, com alça |
| Botão flutuante | Evite | Carrinho ou "novo pedido" no canto de baixo |
| Grade de produtos | Quantos couberem | 2 por linha |

Regras:

1. **Nunca rolagem lateral na página.** Só rola de lado o que foi feito para isso: tabela larga, quadro, grade de tamanho e cor, filtros rápidos e abas.
2. **Grade sem corte fixo:** `grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr))`.
3. **Altura de tela:** `100dvh`, não `100vh`.
4. **Coisa presa embaixo** soma `env(safe-area-inset-bottom)` (os componentes já fazem; a página precisa de `viewport-fit=cover`).
5. **Nunca bloqueie o zoom** (`user-scalable=no` é proibido). A tela funciona com zoom de 200%.
6. **Imagem** com `max-width: 100%` e proporção fixa (`aspect-ratio`).
7. **Texto longo** (nome, e-mail, endereço) quebra com `overflow-wrap: anywhere` ou corta com reticências e mostra tudo no detalhe.
8. **A ação principal fica visível no celular:** no topo, no rodapé fixo do formulário ou no botão flutuante. Nunca escondida num menu.
9. **Teste** em 375px, 390–430px, 768px, 1280px e 1440px, no claro e no escuro: sem rolagem lateral, menu abrindo e fechando, botões com 44px no celular.

### Componentes

| Componente | HTML |
|---|---|
| Botão principal (**um por tela**) | `<button class="yn-btn yn-btn--primary">Salvar</button>` |
| Botão secundário | `<button class="yn-btn yn-btn--secondary">Cancelar</button>` |
| Botão discreto | `<button class="yn-btn yn-btn--ghost">Detalhes</button>` |
| Botão de perigo | `<button class="yn-btn yn-btn--danger">Excluir</button>` |
| Card | `<section class="yn-card">...</section>` |
| Indicador | `<div class="yn-card yn-kpi"><p class="yn-eyebrow">Vendas do mês</p><p class="yn-kpi__value">R$ 248.930,50</p><span class="yn-kpi__delta yn-kpi__delta--up">+12,4% vs. mês anterior</span></div>` |
| Tabela | `<div class="yn-table-wrap"><table class="yn-table">...</table></div>`; valores com `<td class="yn-num">` |
| Etiqueta de status | `<span class="yn-badge" data-tone="success">Ativo</span>` (`success`, `info`, `warning`, `danger`) |
| Campo | `<div class="yn-field"><label class="yn-label" for="cnpj">CNPJ</label><input class="yn-input" id="cnpj"><span class="yn-hint">Só números.</span></div>` |
| Rótulo pequeno | `<p class="yn-eyebrow">Pedidos no mês</p>` |
| Texto secundário | `<span class="yn-muted">...</span>` |
| Botão só com ícone | `<button class="yn-btn yn-btn--secondary yn-btn--icon" aria-label="Filtrar"><i data-lucide="filter"></i></button>` |
| Botão pequeno (card, quadro, linha) | `<button class="yn-btn yn-btn--secondary yn-btn--sm">Ligar</button>` (no celular volta a ter 44px) |
| Botão carregando | `<button class="yn-btn yn-btn--primary" aria-busy="true" disabled>Salvando</button>` |
| Campo com erro | `<input class="yn-input" aria-invalid="true" aria-describedby="e1"><span class="yn-error" id="e1">Informe um e-mail válido.</span>` |
| Campo com ícone | `<div class="yn-input-wrap"><i data-lucide="search"></i><input class="yn-input" type="search"></div>` |
| Caixa de seleção / opção única | `<label class="yn-check"><input type="checkbox"> Enviar NF por e-mail</label>` |
| Chave liga/desliga | `<label class="yn-check"><input type="checkbox" role="switch" class="yn-switch"> Avisar no WhatsApp</label>` |
| Avatar / categoria / contador | `<span class="yn-avatar">CM</span>` · `<span class="yn-chip">Atacado</span>` · `<span class="yn-count" data-tone="danger">3</span>` |
| Filtro rápido | `<div class="yn-chips"><button class="yn-chip" aria-pressed="true">Atrasados <span class="yn-count">3</span></button></div>` |
| Prazo | `<span class="yn-deadline" data-state="late"><i data-lucide="clock-alert"></i>Atrasado 1 dia</span>` (`soon`, `late`, `done`, `paused`; o texto diz o estado) |
| Escolha de visão ou tema | `<div class="yn-segmented" role="group" aria-label="Ver como"><button aria-pressed="true">Lista</button><button aria-pressed="false">Quadro</button></div>` |
| Busca com lista | `<div class="yn-combobox"><input class="yn-input" role="combobox" aria-expanded="false" aria-controls="l1"><ul class="yn-listbox" role="listbox" id="l1"><li role="option" aria-selected="false">Mercado São Jorge <span class="yn-listbox__meta">Curitiba · PR</span></li></ul></div>`: setas movem, Enter escolhe, Esc fecha; sem resultado, `.yn-listbox__empty` oferece cadastrar |
| Abas | `<div class="yn-tabs" role="tablist"><button class="yn-tab" role="tab" aria-selected="true">Resumo</button>...</div>` |
| Trilha / paginação | `<nav class="yn-breadcrumb"><ol><li><a>Clientes</a></li>...</ol></nav>` · `<nav class="yn-pagination">...<button aria-current="page">3</button></nav>` |
| Dica | `<button class="yn-btn yn-btn--secondary yn-tooltip" data-tooltip="Atualizado há 2 min">...</button>` |
| Menu de ações | `<details class="yn-menu"><summary class="yn-btn yn-btn--secondary">Ações</summary><div class="yn-menu__list"><button>Editar</button></div></details>` |
| Sanfona | `<details class="yn-accordion"><summary>Pergunta</summary><p>Resposta</p></details>` |
| Aviso na tela | `<div class="yn-alert" data-tone="success"><i data-lucide="circle-check"></i><div><strong class="yn-alert__title">Pedido salvo</strong>O faturamento já recebeu.</div></div>` |
| Faixa no topo da tela | `<div class="yn-banner" data-tone="warning" role="status"><i data-lucide="wifi-off"></i><p>Sem internet...</p></div>` (sem `data-tone` = faixa preta do modo demonstração) |
| Aviso rápido | `<div class="yn-toast-region" aria-live="polite"><div class="yn-toast">Pedido salvo.</div></div>` |
| Janela / painel lateral / folha de baixo | `<dialog class="yn-modal">`, `<dialog class="yn-drawer">` ou `<dialog class="yn-sheet">` (sobe de baixo no celular), abertos com `showModal()`; dentro, `.yn-dialog__header` e `.yn-dialog__footer`; ações da folha em `.yn-sheet__actions` |
| Progresso / carregando | `<progress class="yn-progress" value="65" max="100"></progress>` · `<span class="yn-spinner"></span>` · `<div class="yn-skeleton"></div>` |
| Estado vazio | `<div class="yn-empty"><span class="yn-empty__icon"><i data-lucide="inbox"></i></span><p class="yn-empty__title">Nenhum pedido ainda</p><p>Explica o próximo passo.</p></div>` |
| Falha ao carregar | `<div class="yn-empty" data-state="error" role="alert">` + ícone `cloud-off`, "Não deu para carregar...", botão "Tentar de novo" e `<span class="yn-empty__code">Código PED-503</span>` |
| Indicador sem base | `<p class="yn-kpi__value yn-kpi__value--empty">Sem dados</p>` (nunca 0 ou NaN) |
| Etapas | `<ol class="yn-steps"><li class="yn-step" data-state="done"><span class="yn-step__dot"></span><div><p class="yn-step__title">Faturado</p><p class="yn-step__meta">NF 18.204</p></div></li></ol>` (`done`, `current`, `pending`) |
| Envio de arquivos | `<label class="yn-dropzone">...<input type="file" hidden></label>` + uma `<div class="yn-file">` por arquivo |
| Tabela que vira cards no celular | `<table class="yn-table yn-table--stack">` + `<td data-label="Cliente">` em cada célula (a primeira vira o título do card) |
| Ficha de dados | `<dl class="yn-dl"><div><dt>CNPJ</dt><dd>12.345.678/0001-90</dd></div></dl>` (`.yn-dl--rows` = um por linha; `dd` vazio mostra "—") |
| Histórico | `<ol class="yn-timeline"><li class="yn-timeline__item" data-tone="success"><span class="yn-timeline__icon"><i data-lucide="phone"></i></span><div><p class="yn-timeline__head"><strong>Carlos M.</strong> ligou <time class="yn-timeline__time">10:42</time></p><p class="yn-timeline__quote">Texto</p></div></li></ol>` (mais novo em cima) |
| Quadro (funil, produção) | `<div class="yn-kanban"><section class="yn-kanban__col"><div class="yn-kanban__head"><h2 class="yn-kanban__title">Proposta</h2><span class="yn-count">3</span><span class="yn-kanban__total">R$ 18.400,00</span></div><article class="yn-kanban__card">...<div class="yn-kanban__actions">← Abrir →</div></article></section></div>`; colunas `data-lane="won"`/`"lost"` para ganho e perdido. **Todo card se move pelas setas**, não só arrastando |
| Mensagens (WhatsApp, SAC) | `.yn-inbox` > `.yn-inbox__list` (itens `.yn-inbox__item`) + `.yn-thread` > `.yn-thread__head`, `.yn-thread__body` com `.yn-bubble` (`data-from="them"`, `"me"`, `"note"` nota interna, `"system"`; `data-state="failed"`), `.yn-composer` |
| Catálogo | `<div class="yn-catalog"><article class="yn-product"><div class="yn-product__media"><img alt=""></div><div class="yn-product__body"><p class="yn-product__name">...</p><p class="yn-product__meta">Cód. 10482 · 38 em estoque</p><p class="yn-product__price">R$ 142,80</p></div></article></div>` (`data-stock="out"` sem estoque) |
| Quantidade | `<div class="yn-qty"><button aria-label="Diminuir">−</button><input inputmode="numeric" aria-label="Quantidade"><button aria-label="Aumentar">+</button></div>` |
| Grade tamanho × cor | `<div class="yn-grade-wrap"><table class="yn-grade">` com `<input inputmode="numeric" placeholder="0" aria-label="Preto, M">` por célula; sem estoque = `disabled`; total em `.yn-grade__total` |
| Botão flutuante | `<a class="yn-fab" href="/carrinho"><i data-lucide="shopping-cart"></i>Carrinho <span class="yn-count">3</span></a>` (só no celular, um por tela) |
| Decisão (aprovar/reprovar) | `<div class="yn-decision"><div class="yn-decision__head">...</div><dl class="yn-dl">fatos</dl><div class="yn-decision__actions">Reprovar · Aprovar</div></div>`; reprovar abre janela com motivo obrigatório |
| Próximo passo | `<div class="yn-next" data-state="late"><span class="yn-next__icon"><i data-lucide="phone"></i></span><div class="yn-next__body"><p class="yn-next__title">Ligar para...</p><p class="yn-next__meta">Hoje, 14:00</p></div><button class="yn-btn yn-btn--secondary">Registrar</button></div>` |
| Ficha 360 | `<div class="yn-split"><aside class="yn-split__aside">resumo</aside><div>próximo passo + abas</div></div>` |
| Gráfico de barras | `<ul class="yn-bars"><li class="yn-bars__row" style="--value: 86"><span class="yn-bars__label">Carlos M.</span><span class="yn-bars__track"><span class="yn-bars__fill"></span></span><span class="yn-bars__value">R$ 82,4 mil</span></li></ul>`; em pé: `.yn-columns` > `.yn-columns__col` (`--value`) > `.yn-columns__bar`. Sempre com `<details class="yn-as-table"><summary>Ver como tabela</summary>...</details>` |
| Ranking | `<ol class="yn-ranking"><li aria-current="true"><span class="yn-avatar">CM</span><span class="yn-ranking__name">Carlos M. (você)</span><span class="yn-ranking__value">R$ 82.400,00</span></li></ol>` |
| Régua de meta | `<div class="yn-meter" data-state="behind" style="--value: 62; --expected: 70"><div class="yn-meter__head">...</div><div class="yn-meter__track"><span class="yn-meter__fill"></span><span class="yn-meter__mark"></span></div><div class="yn-meter__legend">...</div></div>` (`behind`, `ahead`, `done`) |
| Formulário longo | `<section class="yn-form-section"><div class="yn-form-section__intro"><h2>Empresa</h2><p>...</p></div><div class="yn-form-grid">campos (`.yn-field--full` ocupa a linha)</div></section>` + `<div class="yn-form-footer"><span class="yn-form-footer__status" data-dirty>Alterações não salvas</span>Cancelar · Salvar</div>` |

Os cards de indicador ficam em grade: `display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));`

### React + Tailwind 4 (Lovable, v0, Bolt, Claude Code)

1. Coloque os links do `<head>` (acima) no `index.html`, **incluindo o script de uma linha do tema** (num componente ele pisca), e use as classes `yn-*` em `className` quando servirem.
2. No CSS principal (ex.: `src/index.css`), logo depois de `@import "tailwindcss";`, cole **exatamente** este bloco. Ele apaga a paleta do Tailwind (`bg-blue-500` e afins deixam de existir) e cria as cores do padrão:

```css
@theme inline {
  --color-*: initial;

  --color-page: var(--color-bg);
  --color-panel: var(--color-surface);
  --color-raised: var(--color-surface-raised);
  --color-line: var(--color-border);
  --color-line-strong: var(--color-border-strong);
  --color-ink: var(--color-text);
  --color-muted: var(--color-text-muted);
  --color-decor: var(--color-silver);

  --color-primary: var(--color-brand);
  --color-primary-hover: var(--color-brand-hover);
  --color-primary-subtle: var(--color-brand-subtle);
  --color-on-primary: var(--color-brand-contrast);

  --color-tone-success: var(--color-success);
  --color-tone-info: var(--color-info);
  --color-tone-warning: var(--color-warning);
  --color-tone-danger: var(--color-danger);

  --color-ring: var(--color-focus);

  --font-*: initial;
  --font-sans: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;

  --radius-*: initial;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-full: 999px;
}
```

3. Use só estas classes de cor: `bg-page` (fundo), `bg-panel` (menu, cabeçalho de tabela), `bg-raised` (card), `border-line`, `border-line-strong` (campo), `text-ink`, `text-muted`, `text-decor`, `bg-primary` + `text-on-primary` + `hover:bg-primary-hover` (botão principal), `bg-primary-subtle`, `text-tone-success|info|warning|danger` e `bg-tone-*/10` (status), `outline-ring` (foco). Raios: `rounded-sm|md|lg|full`.
4. O espaçamento do Tailwind já é de 4 em 4px: use a escala normal (`p-4`, `gap-6`).
5. **Proibido:** cor crua (`#2563eb`, `bg-blue-600`), `rounded-xl`/`2xl`, `shadow-xl`, `text-[11px]`, remapear a paleta para fazer o tema escuro. O tema escuro e a cor do cliente já vêm dos tokens.
6. A casca é a mesma da seção "Estrutura de um sistema": `<div className="yn-shell" data-nav={navAberta ? "open" : undefined} data-sidebar={recolhido ? "collapsed" : undefined}>`. O tema troca com a mesma função `definirTema` (em `src/lib/tema.ts`). Ícones: `lucide-react` com `strokeWidth={1.75}`; o botão de tema usa `<Moon className="yn-only-light" />` e `<Sun className="yn-only-dark" />`.

**shadcn/ui:** se o projeto já usa, aponte as variáveis dele para os tokens: `--background: var(--color-bg)`, `--foreground: var(--color-text)`, `--card: var(--color-surface-raised)`, `--muted: var(--color-surface)`, `--muted-foreground: var(--color-text-muted)`, `--border: var(--color-border)`, `--input: var(--color-border-strong)`, `--primary: var(--color-brand)`, `--primary-foreground: var(--color-brand-contrast)`, `--destructive: var(--color-danger)`, `--ring: var(--color-focus)`, `--radius: 0.375rem`.

---

## 6. App (celular) ou outra tecnologia

Use as tabelas da seção 3 e estas medidas:

| Elemento | Especificação |
|---|---|
| Botão | 40px de altura, 16px de padding lateral, borda arredondada 6px, texto 14px Medium |
| Campo | 40px de altura, 12px de padding lateral, borda 1px (borda de campo), arredondada 6px, texto 14px Regular |
| Card | Borda 1px, arredondada 10px, padding 20px |
| Tabela | Célula com 12px vertical e 16px lateral; cabeçalho 12px Medium, maiúsculas, fundo secundário |
| Etiqueta de status | 12px Medium, totalmente arredondada, texto na cor do status, fundo com 12% da mesma cor, bolinha de 6px antes do texto |
| Menu lateral | 248px de largura (64px recolhido, só ícones), fundo secundário. No celular: gaveta que desliza da esquerda (até 300px) ou abas embaixo |
| Abas embaixo | 64px de altura + área segura do aparelho; 3 a 5 destinos, ícone de 20px e nome de 12px; o atual com fundo suave atrás do ícone |
| Área de toque | 44px em tudo que se aperta |
| Tema | Claro e escuro obrigatórios: começa igual ao aparelho, com opção de trocar guardada no aparelho |
| Foco do teclado | Contorno de 2px na cor do texto, afastado 2px |

---

## 7. Regras de interface

1. **Um botão principal por tela.** O resto é secundário ou discreto.
2. **Mobile primeiro.** Funciona em 375px de largura, sem rolagem lateral (seção 5, Responsivo).
3. **Contraste mínimo de 4,5:1** em todo texto.
4. **Bordas pouco arredondadas** (4 a 10px). Nada de bolha.
5. **Sem degradê, brilho, sombra pesada, emoji como ícone** ou ilustração genérica.
6. **Tema claro e escuro em todo sistema, sem exceção.** Começa igual ao aparelho, tem botão para trocar e a escolha fica guardada (seção 5).
7. **Estado vazio explica o próximo passo:** "Nenhum pedido ainda. Lance o primeiro em Novo pedido."
8. **Falha ≠ vazio ≠ sem dado:** erro ao carregar mostra "Não deu para carregar" + "Tentar de novo"; lista vazia mostra o próximo passo; métrica sem base mostra "Sem dados" (nunca 0 ou NaN).
9. **Texto mínimo de 12px**, um `h1` por tela, botão só com ícone com `aria-label`, foco sempre visível, sem itálico.
10. **Área de toque de 44px** no celular (botão, campo, item de lista).
11. **Modal:** Esc fecha; clicar fora só fecha modal de leitura; pergunta antes de descartar o que foi digitado; trava os botões enquanto grava; foco no primeiro campo.
12. **Formulário longo:** seções, botões de ação fixos no rodapé, aviso ao sair sem salvar.
13. **Estado na URL:** aba, filtro e página atuais ficam no endereço, para o link funcionar quando compartilhado.
14. **Faixa no topo** para: modo demonstração, sem internet, versão nova disponível.

---

## 8. Textos

- Português do Brasil, tratando por "você". Frase curta, **verbo no começo** ("Salvar pedido", "Ver clientes").
- Fale da **operação** do usuário, não da tecnologia.
- Sem jargão nem exagero ("solução inovadora", "revolucionário").

| Situação | Errado | Certo |
|---|---|---|
| Sucesso | "Operação realizada com sucesso!" | "Pedido salvo." |
| Erro | "Erro inesperado." | "Não deu para salvar: o CNPJ está incompleto." |
| Vazio | "Nenhum registro encontrado." | "Nenhum cliente ainda. Cadastre o primeiro em Novo cliente." |
| Confirmação | "Tem certeza?" | "Excluir o pedido #4821? Isso não pode ser desfeito." |

---

## 9. Dados

| Dado | Como guardar | Como mostrar |
|---|---|---|
| Dinheiro | Inteiro em **centavos** (`bigint`), campo `*_cents` (`12990`) | `R$ 129,90` |
| Data e hora | `timestamptz`, campo `*_at` | `01/10/2026 14:30`, sempre com `timeZone: "America/Sao_Paulo"` explícito |
| Só data | `date` `AAAA-MM-DD`, campo `*_on`; ler como data **local** | `01/10/2026` |
| Código humano | `PREFIXO-0001` gerado por sequência no banco (`ORD-1205`) | Igual |
| Telefone | Só dígitos com 55 + DDD (`5511987654321`) | `(11) 98765-4321` |
| CPF / CNPJ / CEP | Texto, só dígitos | Com máscara |
| Sim/Não | `true` / `false`, campo `is_*` ou `has_*` | "Sim" / "Não" |
| ID de outro sistema | Texto em `external_id` + origem em `source` | — |

- Código (variáveis, funções, tabelas, campos) em **inglês**, `snake_case`. Tudo que o usuário lê, em **português**.
- Toda tabela do banco tem `id` (uuid), `created_at` e `updated_at` (por gatilho). Responsável é chave estrangeira (`owner_id`), nunca nome em texto.
- Status são uma lista fechada em inglês (`awaiting_payment`, `paid`...), com rótulo em português na tela e a cor da seção 3. A conta usa o **código**, nunca o rótulo.
- **Fato não é status:** faturado, entregue, pago são carimbos (`invoiced_at`, `delivered_at`). Recusado ≠ cancelado. Encerrar com desfecho negativo exige **motivo de lista fechada**.
- **Preço, desconto e total sempre recalculados no servidor.** Nunca conta com ponto flutuante no TypeScript: calcule em centavos.
- **Trava otimista:** gravar com o `updated_at` lido; se mudou, avisar "Outra pessoa alterou este registro".
- **Histórico:** mudança de status por gatilho, edição com antes/depois, cópia em `jsonb` antes de excluir.
- **Nunca inventar dado:** o que falta aparece como "A cadastrar".
- O Supabase devolve no máximo **1.000 linhas** sem avisar: pagine, e filtre no banco, nunca baixando tudo para o navegador.
- Horário útil e prazos calculados num módulo só, com fuso de São Paulo explícito.

---

## 10. Segurança, integrações e projeto

**Segurança**

- **RLS obrigatória em toda tabela, por papel e por dono.** A tela esconder o botão não é segurança: qualquer pessoa logada chama a API direto. Proibido "logado = acesso a tudo".
- Ninguém altera o **próprio** papel ou permissões (coluna protegida). Chave `service_role` só no servidor, nunca com prefixo `VITE_`.
- Funções no servidor conferem a sessão **e** o papel no banco antes de agir.
- **Nunca guardar senha no navegador**, nem em hash. Senha provisória mostrada uma vez, troca no primeiro acesso.
- Arquivos em bucket **privado**, exibidos por URL assinada. Foto ou documento de cliente nunca em bucket público.
- Webhook com segredo no **cabeçalho** ou HMAC, nunca na URL. CORS restrito. `vercel.json` com cabeçalhos de segurança.
- IA recebe o **mínimo** de dado pessoal; ela sugere, nunca responde sozinha ao cliente.
- Senhas, tokens e chaves **só em variável de ambiente**. Nunca no código, no README ou colados no chat. O `.env` nunca vai para o Git.
- Nunca registrar em log token, CPF ou telefone completo.
- Marketing só para quem autorizou (`marketing_opt_in = true`), conforme a LGPD.
- Webhook responde na hora e processa depois. Tudo pode ser repetido sem duplicar dados (atualiza se existe, cria se não existe).
- Cada dado tem um sistema dono (estoque, clientes, preços); os outros só leem dele.
- Integração com ERP: consulta incremental (`?since=`), lote máximo, erro sempre `{error, code, statusCode}`, log sem dado pessoal, tela de saúde da integração.
- WhatsApp: API oficial por padrão; Evolution API (não oficial) só com o risco registrado e número dedicado.

**Projeto**

- Camadas: tela → `actions` (grava + registra na linha do tempo + avisa) → store/api. Leitura que calcula fica em funções puras com teste.
- **Modo demonstração:** sem as variáveis do Supabase, o sistema roda com dados em memória, abre vazio, e mostra dados de exemplo inventados com `VITE_SAMPLE_DATA=true`.
- **Aviso de versão nova** com `/version.json`. App de quem trabalha na rua funciona sem internet, com fila que reenvia sem duplicar.
- Migrações `AAAAMMDDHHMMSS_nome.sql`, versão única, idempotentes e com instrução de como reverter.
- Scripts gravam só com `--executar` e nunca imprimem dado pessoal.
- Mantenha `ESTADO.md` atualizado em todo PR e as decisões em `docs/decisoes/`.

**Sistema de loja** (Mercado Livre, Shopee, loja virtual): siga também https://github.com/Yanunesxz/SystemDesing/blob/main/docs/dominios/ecommerce.md. SKU no formato `CAT-MODELO-COR-TAM`. Nunca contatar comprador de marketplace fora da plataforma.

---

## 11. Antes de entregar, confira

- [ ] Manrope carregada, sem itálico, pesos certos (Bold títulos, Medium botões e menus, Regular texto).
- [ ] Ícones só do Lucide, traço 1,75; botão só com ícone tem `aria-label`.
- [ ] Nenhuma cor fora da seção 3; nenhuma cor ou tamanho fixo no código; nenhum componente inventado quando existe um `yn-*` que resolve.
- [ ] Um botão principal por tela, na cor principal.
- [ ] Tema claro e escuro: segue o aparelho, tem botão de trocar, a escolha fica guardada e a tela não pisca ao abrir.
- [ ] Responsivo: conferido em 375px, 768px e 1280px, sem rolagem lateral; menu do celular no modelo certo (gaveta ou abas); 44px de toque.
- [ ] Valores alinhados à direita com números de largura fixa.
- [ ] Textos no tom da seção 8.
- [ ] Sistema de cliente: cor do cliente só nos lugares permitidos e rodapé "Criado por Yan Nunes" (uma linha pequena, cinza).
- [ ] Dinheiro em centavos, datas com fuso de São Paulo explícito, segredos em variável de ambiente.
- [ ] RLS testada: logado com cada papel, tentei ler e alterar pela API o que não devia, e foi negado.
- [ ] Falha, vazio e sem dados têm telas diferentes.
- [ ] Modo demonstração funciona sem banco.
- [ ] `ESTADO.md` atualizado.

---

## Anexo — CSS do padrão

Use só se os links do jsDelivr (seção 5) não carregarem. É o mesmo conteúdo, versão 0.2.0.

### ui/tokens.css

```css
/*
 * SystemDesing — design tokens v0.2.0
 * Yan Nunes · Sistemas & Consultoria
 * https://github.com/Yanunesxz/SystemDesing
 *
 * TRÊS PARTES
 *  0. PALETA DA MARCA: os valores brutos (preto, branco, cinzas).
 *     Os sistemas não usam direto; usam os tokens --color-* da base.
 *  1. BASE (fixa em todo sistema): fonte Manrope, neutros, cores de status,
 *     espaçamento e bordas. Não muda por cliente.
 *  2. TEMA (muda por cliente): só --color-brand e --color-brand-contrast.
 *     Sem cliente, vale o tema Yan Nunes (preto no claro, branco no escuro).
 *     Para um cliente, carregue DEPOIS deste arquivo um tema-cliente.css
 *     (modelo em templates/tema-cliente.css, gerador na vitrine: index.html).
 *
 * O tema padrão usa :where() (peso zero no CSS) de propósito: qualquer
 * :root do tema do cliente vence, no claro e no escuro.
 *
 * Fonte: carregue a Manrope no <head> (ver docs/02-visual.md).
 */

/* ---------- 0. PALETA DA MARCA ---------- */
:root {
  --yn-black: #000000;     /* preto da marca */
  --yn-white: #FFFFFF;     /* branco da marca */
  --yn-gray-900: #202020;  /* cinza escuro da marca */
  --yn-gray-500: #808080;  /* cinza médio da marca: reprova como texto (3,95:1 no branco) */

  /* Tons de apoio da interface */
  --yn-gray-950: #101010;
  --yn-gray-800: #3A3A3A;
  --yn-gray-700: #4A4A4A;
  --yn-gray-600: #5C5C5C;
  --yn-gray-400: #A3A3A3;
  --yn-gray-300: #D4D4D4;
  --yn-gray-200: #E5E5E5;
  --yn-gray-100: #F5F5F5;
}

/* ---------- 1. BASE ---------- */
:root {
  color-scheme: light;

  /* Neutros */
  --color-bg: var(--yn-white);
  --color-surface: var(--yn-gray-100);
  --color-surface-raised: var(--yn-white);
  --color-border: var(--yn-gray-200);
  --color-border-strong: var(--yn-gray-300);
  --color-text: var(--yn-black);
  --color-text-muted: var(--yn-gray-600);
  --color-silver: var(--yn-gray-500); /* só decoração: linhas, ícones, crédito. Nunca texto pequeno. */

  /* Status: iguais em todo sistema, não mudam por cliente */
  --color-success: #116329;
  --color-warning: #7A5200;
  --color-danger: #B3121F;
  --color-info: #0550AE;

  /* Foco do teclado: sempre na cor do texto, visível com qualquer cor de cliente */
  --color-focus: var(--color-text);

  /* Tipografia: Manrope em tudo (marca, site e sistema).
     Bold/SemiBold: logo, títulos, destaques
     Medium: menus, botões, rótulos, navegação
     Regular: texto, descrições, tabelas
     Manrope não tem itálico: destaque é por peso. */
  --font-sans: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;

  --text-xs: 0.75rem;   /* 12px */
  --text-sm: 0.875rem;  /* 14px: padrão de tabela e formulário */
  --text-base: 1rem;    /* 16px */
  --text-lg: 1.125rem;  /* 18px */
  --text-xl: 1.25rem;   /* 20px */
  --text-2xl: 1.5rem;   /* 24px */
  --text-3xl: 1.875rem; /* 30px */
  --text-4xl: 2.25rem;  /* 36px: só em site e apresentação, nunca dentro de sistema */
  --text-5xl: 3rem;     /* 48px: só em site e apresentação, nunca dentro de sistema */

  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  --tracking-tight: -0.02em; /* títulos */
  --tracking-wide: 0.12em;   /* rótulos em maiúsculas, como "SISTEMAS & CONSULTORIA" */

  --leading-tight: 1.2;
  --leading-normal: 1.5;

  /* Espaçamento: escala de 4px */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* Bordas: pouco arredondadas, visual sóbrio */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-full: 999px;

  /* Sombras */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);

  /* Movimento */
  --duration-fast: 120ms;
  --duration-normal: 200ms;

  /* Layout de painel */
  --sidebar-width: 248px;
  --sidebar-collapsed-width: 64px; /* menu recolhido: só ícones */
  --topbar-height: 56px;
  --tabbar-height: 64px;           /* abas embaixo, no celular */
  --content-max: 1280px;

  /* Área mínima de toque no celular (botão, campo, item de lista) */
  --touch-min: 44px;
}

/* ---------- 2. TEMA PADRÃO: Yan Nunes ---------- */
:where(:root) {
  --color-brand: var(--yn-black);
  --color-brand-contrast: var(--yn-white);
}

/* Derivados do tema: calculados a partir da cor do cliente. Não sobrescreva. */
:root {
  --color-brand-hover: color-mix(in oklab, var(--color-brand), var(--color-brand-contrast) 15%);
  --color-brand-edge: color-mix(in oklab, var(--color-brand), var(--color-text) 20%);
  --color-brand-subtle: color-mix(in oklab, var(--color-brand) 10%, var(--color-bg));
}

/* ---------- TEMA ESCURO ---------- */
/* Segue o sistema operacional, a menos que a página force data-theme="light" */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;

    --color-bg: var(--yn-black);
    --color-surface: var(--yn-gray-950);
    --color-surface-raised: var(--yn-gray-900);
    --color-border: var(--yn-gray-800);
    --color-border-strong: var(--yn-gray-700);
    --color-text: var(--yn-gray-100);
    --color-text-muted: var(--yn-gray-400);
    --color-silver: var(--yn-gray-500);

    --color-success: #3FB950;
    --color-warning: #D29922;
    --color-danger: #FF7B72;
    --color-info: #58A6FF;

    --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.4);
    --shadow-md: 0 4px 12px rgb(0 0 0 / 0.5);
  }

  :where(:root:not([data-theme="light"])) {
    --color-brand: var(--yn-white);
    --color-brand-contrast: var(--yn-black);
  }
}

/* Tema escuro forçado pela página: <html data-theme="dark"> */
:root[data-theme="dark"] {
  color-scheme: dark;

  --color-bg: var(--yn-black);
  --color-surface: var(--yn-gray-950);
  --color-surface-raised: var(--yn-gray-900);
  --color-border: var(--yn-gray-800);
  --color-border-strong: var(--yn-gray-700);
  --color-text: var(--yn-gray-100);
  --color-text-muted: var(--yn-gray-400);
  --color-silver: var(--yn-gray-500);

  --color-success: #3FB950;
  --color-warning: #D29922;
  --color-danger: #FF7B72;
  --color-info: #58A6FF;

  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.5);
}

:where(:root[data-theme="dark"]) {
  --color-brand: var(--yn-white);
  --color-brand-contrast: var(--yn-black);
}
```

### ui/componentes.css

```css
/*
 * SystemDesing — componentes de painel v0.2.0
 * Yan Nunes · Sistemas & Consultoria
 *
 * Requer ui/tokens.css carregado ANTES.
 * Todas as classes começam com "yn-". Exemplos de uso na vitrine (index.html)
 * e telas completas em ui/exemplos/.
 *
 * Pesos da Manrope: Bold/SemiBold em títulos e destaques, Medium em menus,
 * botões e rótulos, Regular em texto e tabelas.
 */

/* ---------- Base ---------- */
body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  margin: 0;
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  text-wrap: balance;
}

h1 { font-size: var(--text-2xl); }
h2 { font-size: var(--text-lg); }
h3, h4 { font-size: var(--text-base); }

/* Manrope não tem itálico: o navegador só entortaria a letra. Destaque é por peso. */
em, i, cite {
  font-style: normal;
  font-weight: var(--weight-semibold);
}

a {
  color: inherit;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
}

:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Ícones: Lucide (lucide.dev). <i data-lucide="search"></i> + lucide.createIcons().
   Traço sempre 1,75. Tamanho padrão 16px; .yn-icon-20 no menu, .yn-icon-24 em destaque. */
svg.lucide {
  width: 16px;
  height: 16px;
  flex: none;
  stroke-width: 1.75;
}

svg.lucide.yn-icon-20 { width: 20px; height: 20px; }
svg.lucide.yn-icon-24 { width: 24px; height: 24px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
}

/* ---------- Texto ---------- */
/* Rótulo em maiúsculas com espaçamento largo — eco do "SISTEMAS & CONSULTORIA" do logo */
.yn-eyebrow {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.yn-muted {
  color: var(--color-text-muted);
}

/* Mostrar só num tema. Botão de tema: <i data-lucide="moon" class="yn-only-light"></i><i data-lucide="sun" class="yn-only-dark"></i> */
.yn-only-dark { display: none !important; }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .yn-only-light { display: none !important; }
  :root:not([data-theme="light"]) .yn-only-dark { display: revert !important; }
}

:root[data-theme="dark"] .yn-only-light { display: none !important; }
:root[data-theme="dark"] .yn-only-dark { display: revert !important; }

/* Número em coluna: largura fixa e alinhado à direita */
.yn-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

/* ---------- Botões ---------- */
.yn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 40px;
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--duration-fast), border-color var(--duration-fast);
}

.yn-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Principal: a única coisa na cor do cliente. Um por tela. */
.yn-btn--primary {
  background: var(--color-brand);
  border-color: var(--color-brand-edge);
  color: var(--color-brand-contrast);
}

.yn-btn--primary:hover:not(:disabled) {
  background: var(--color-brand-hover);
}

.yn-btn--secondary {
  background: var(--color-surface-raised);
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.yn-btn--secondary:hover:not(:disabled),
.yn-btn--ghost:hover:not(:disabled) {
  background: var(--color-surface);
}

.yn-btn--ghost {
  background: transparent;
  color: var(--color-text);
}

.yn-btn--danger {
  background: transparent;
  border-color: currentColor;
  color: var(--color-danger);
}

/* Só ícone: sempre com aria-label */
.yn-btn--icon {
  width: 40px;
  padding: 0;
}

/* Pequeno: dentro de card, linha de tabela ou quadro. No celular volta a ter 44px. */
.yn-btn--sm {
  gap: 6px;
  min-height: 32px;
  padding: 0 var(--space-3);
}

.yn-btn--sm.yn-btn--icon { width: 32px; padding: 0; }

/* Carregando: <button class="yn-btn ..." aria-busy="true" disabled>Salvando</button> */
.yn-btn[aria-busy="true"] {
  cursor: progress;
  opacity: 0.85;
}

.yn-btn[aria-busy="true"]::before {
  content: "";
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: yn-spin 0.7s linear infinite;
}

/* ---------- Card ---------- */
.yn-card {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
}

/* ---------- Indicador (KPI) ---------- */
.yn-kpi {
  display: grid;
  gap: var(--space-2);
  align-content: start;
}

.yn-kpi__value {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
  font-variant-numeric: tabular-nums;
}

.yn-kpi__delta {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.yn-kpi__delta--up { color: var(--color-success); }
.yn-kpi__delta--down { color: var(--color-danger); }

/* ---------- Tabela ---------- */
.yn-table-wrap {
  overflow-x: auto;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.yn-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.yn-table th {
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-wide);
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.yn-table tbody tr:last-child td { border-bottom: 0; }
.yn-table tbody tr:hover { background: var(--color-surface); }
.yn-table .yn-num { text-align: right; }

/* Tabela que vira cards no celular: .yn-table--stack + data-label em cada célula.
   <td data-label="Cliente">Mercado São Jorge</td>. A primeira célula vira o título do card. */
@media (max-width: 768px) {
  .yn-table--stack thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .yn-table--stack tbody tr { display: grid; padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
  .yn-table--stack tbody tr:last-child { border-bottom: 0; }

  .yn-table--stack td {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-1) var(--space-4);
    border-bottom: 0;
    white-space: normal;
    text-align: right;
  }

  .yn-table--stack td::before {
    content: attr(data-label);
    flex: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    text-align: left;
    color: var(--color-text-muted);
  }

  .yn-table--stack td:first-child::before,
  .yn-table--stack td:not([data-label])::before { content: none; }
  .yn-table--stack td:not([data-label]) { justify-content: flex-end; }
  .yn-table--stack td:first-child { justify-content: flex-start; font-weight: var(--weight-semibold); text-align: left; }
}

/* ---------- Etiqueta de status ---------- */
/* Use o status unificado de docs/03-dados.md: <span class="yn-badge" data-status="paid">Pago</span> */
.yn-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: color-mix(in oklab, currentColor 12%, transparent);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-badge::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.yn-badge[data-status="awaiting_payment"],
.yn-badge[data-status="cancel_requested"],
.yn-badge[data-tone="warning"] { color: var(--color-warning); }

.yn-badge[data-status="paid"],
.yn-badge[data-status="invoiced"],
.yn-badge[data-status="ready_to_ship"],
.yn-badge[data-status="shipped"],
.yn-badge[data-tone="info"] { color: var(--color-info); }

.yn-badge[data-status="delivered"],
.yn-badge[data-tone="success"] { color: var(--color-success); }

.yn-badge[data-status="cancelled"],
.yn-badge[data-status="returned"],
.yn-badge[data-tone="danger"] { color: var(--color-danger); }

/* ---------- Formulário ---------- */
.yn-field {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.yn-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.yn-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 40px;
  padding: 0 var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.yn-input:focus-visible {
  outline-offset: 0;
  border-color: var(--color-focus);
}

.yn-hint {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.yn-input::placeholder {
  color: var(--color-text-muted);
  opacity: 1;
}

.yn-input:disabled {
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.yn-input[aria-invalid="true"] {
  border-color: var(--color-danger);
}

textarea.yn-input {
  min-height: 96px;
  padding: 10px var(--space-3);
  line-height: var(--leading-normal);
  resize: vertical;
}

/* Mensagem de erro do campo: <span class="yn-error" id="email-erro">...</span> + aria-describedby */
.yn-error svg { width: 14px; height: 14px; }

.yn-error {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--color-danger);
}

/* Campo com ícone: <div class="yn-input-wrap"><i data-lucide="search"></i><input class="yn-input"></div> */
.yn-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.yn-input-wrap > svg {
  position: absolute;
  left: var(--space-3);
  color: var(--color-text-muted);
  pointer-events: none;
}

.yn-input-wrap > .yn-input {
  padding-left: 36px;
}

/* ---------- Seleção ---------- */
.yn-fieldset {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.yn-fieldset > legend {
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

/* Caixa de seleção e opção única: <label class="yn-check"><input type="checkbox"> Texto</label> */
.yn-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  cursor: pointer;
}

.yn-check input:not(.yn-switch) {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-brand);
  cursor: inherit;
}

.yn-check:has(input:disabled) {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

/* Chave liga/desliga: <input type="checkbox" role="switch" class="yn-switch"> */
.yn-switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  margin: 0;
  background: var(--color-border-strong);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background-color var(--duration-fast);
}

.yn-switch::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--yn-white);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-fast);
}

.yn-switch:checked { background: var(--color-brand); }
.yn-switch:checked::before { transform: translateX(16px); background: var(--color-brand-contrast); }

.yn-range {
  width: 100%;
  margin: 0;
  accent-color: var(--color-brand);
}

/* ---------- Pessoas e categorias ---------- */
.yn-avatar {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-text);
}

.yn-avatar-group { display: flex; }
.yn-avatar-group .yn-avatar { box-shadow: 0 0 0 2px var(--color-surface-raised); }
.yn-avatar-group .yn-avatar + .yn-avatar { margin-left: -6px; }

/* Categoria ou filtro ativo: <span class="yn-chip">Atacado</span> */
.yn-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--color-text);
  white-space: nowrap;
}

.yn-chip button {
  display: inline-grid;
  place-items: center;
  margin: 0 -4px 0 0;
  padding: 2px;
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  cursor: pointer;
}

.yn-chip button:hover { color: var(--color-text); }
.yn-chip button svg { width: 14px; height: 14px; }

/* Filtro rápido (liga/desliga): <button class="yn-chip" aria-pressed="true">Atrasados <span class="yn-count">3</span></button> */
button.yn-chip {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

button.yn-chip:hover { border-color: var(--color-border-strong); }

.yn-chip[aria-pressed="true"] {
  background: var(--color-brand);
  border-color: var(--color-brand-edge);
  color: var(--color-brand-contrast);
}

/* Fila de filtros rápidos: rola de lado no celular */
.yn-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

@media (max-width: 768px) {
  .yn-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .yn-chips::-webkit-scrollbar { display: none; }
}

/* Contador: <span class="yn-count">12</span>. data-tone="danger" para atrasado ou não lido. */
.yn-count {
  display: inline-grid;
  flex: none;
  place-items: center;
  box-sizing: border-box;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--color-text);
}

.yn-count[data-tone="danger"] {
  background: var(--color-danger);
  border-color: transparent;
  color: var(--color-bg);
}

.yn-chip .yn-count { min-width: 18px; height: 18px; margin-right: -4px; }

.yn-chip[aria-pressed="true"] .yn-count {
  background: transparent;
  border-color: currentColor;
  color: inherit;
}

/* ---------- Navegação ---------- */
.yn-breadcrumb ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.yn-breadcrumb li + li::before {
  content: "›";
  margin-right: var(--space-2);
  color: var(--color-silver);
}

.yn-breadcrumb a { color: inherit; text-decoration: none; }
.yn-breadcrumb a:hover { color: var(--color-text); text-decoration: underline; }
.yn-breadcrumb [aria-current="page"] { font-weight: var(--weight-medium); color: var(--color-text); }

/* Abas: <div role="tablist" class="yn-tabs"><button role="tab" class="yn-tab" aria-selected="true">...</button></div> */
.yn-tabs {
  display: flex;
  gap: var(--space-6);
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
}

.yn-tab {
  margin-bottom: -1px;
  padding: 10px 0;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  color: var(--color-text-muted);
  cursor: pointer;
}

.yn-tab:hover { color: var(--color-text); }
.yn-tab[aria-selected="true"] { border-bottom-color: var(--color-text); color: var(--color-text); }

/* Escolha entre 2 a 4 opções que mudam a visão: tema (Aparelho, Claro, Escuro), Lista ou Quadro.
   <div class="yn-segmented" role="group" aria-label="Tema"><button type="button" aria-pressed="true">Claro</button>...</div> */
.yn-segmented {
  display: inline-flex;
  gap: 2px;
  max-width: 100%;
  padding: 2px;
  overflow-x: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.yn-segmented button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 var(--space-3);
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  color: var(--color-text-muted);
  cursor: pointer;
}

.yn-segmented button:hover { color: var(--color-text); }

.yn-segmented button[aria-pressed="true"] {
  background: var(--color-surface-raised);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--color-border);
  color: var(--color-text);
}

.yn-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.yn-pagination a,
.yn-pagination button {
  display: inline-grid;
  place-items: center;
  min-width: 32px;
  height: 32px;
  padding: 0 var(--space-2);
  background: none;
  border: 0;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  text-decoration: none;
  color: var(--color-text);
  cursor: pointer;
}

.yn-pagination a:hover,
.yn-pagination button:hover { background: var(--color-surface); }

.yn-pagination [aria-current="page"] {
  background: var(--color-brand);
  color: var(--color-brand-contrast);
}

/* ---------- Dica, menu e sanfona ---------- */
/* Dica: <button class="yn-btn yn-btn--icon yn-tooltip" data-tooltip="Exportar" aria-label="Exportar"> */
.yn-tooltip { position: relative; }

.yn-tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 10;
  padding: 6px 10px;
  background: var(--color-text);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0;
  text-transform: none;
  white-space: nowrap;
  color: var(--color-bg);
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  transition: opacity var(--duration-fast);
}

.yn-tooltip:hover::after,
.yn-tooltip:focus-visible::after { opacity: 1; }

/* Menu de ações: <details class="yn-menu"><summary class="yn-btn yn-btn--secondary">Ações</summary><div class="yn-menu__list">...</div></details> */
.yn-menu {
  position: relative;
  display: inline-block;
}

.yn-menu > summary { list-style: none; }
.yn-menu > summary::-webkit-details-marker { display: none; }

.yn-menu__list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  display: grid;
  min-width: 180px;
  padding: var(--space-1);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.yn-menu__list button,
.yn-menu__list a {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 10px;
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  text-decoration: none;
  color: var(--color-text);
  cursor: pointer;
}

.yn-menu__list button:hover,
.yn-menu__list a:hover { background: var(--color-surface); }

.yn-menu__list .yn-menu__item--danger { color: var(--color-danger); }

/* Sanfona: <details class="yn-accordion"><summary>Pergunta</summary><p>Resposta</p></details> */
.yn-accordion { border-bottom: 1px solid var(--color-border); }

.yn-accordion > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 14px 0;
  list-style: none;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.yn-accordion > summary::-webkit-details-marker { display: none; }

.yn-accordion > summary::after {
  content: "+";
  font-size: var(--text-lg);
  font-weight: var(--weight-regular);
  line-height: 1;
  color: var(--color-text-muted);
}

.yn-accordion[open] > summary::after { content: "−"; }

.yn-accordion > :not(summary) {
  margin: 0 0 14px;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

/* ---------- Avisos e sobreposições ---------- */
/* Aviso: <div class="yn-alert" data-tone="success" role="status"><i data-lucide="circle-check"></i><div><strong class="yn-alert__title">Título</strong>Texto</div></div> */
.yn-alert {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: 14px var(--space-4);
  background: color-mix(in oklab, currentColor 10%, transparent);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.yn-alert > svg { margin-top: 2px; }

.yn-alert__title {
  display: block;
  font-weight: var(--weight-semibold);
}

.yn-alert[data-tone="success"] { color: var(--color-success); }
.yn-alert[data-tone="info"] { color: var(--color-info); }
.yn-alert[data-tone="warning"] { color: var(--color-warning); }
.yn-alert[data-tone="danger"] { color: var(--color-danger); }

/* Aviso rápido: <div class="yn-toast-region" aria-live="polite"><div class="yn-toast">...</div></div> */
.yn-toast-region {
  position: fixed;
  right: var(--space-4);
  bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  z-index: 50;
  display: grid;
  gap: var(--space-2);
  max-width: min(360px, calc(100vw - 32px));
}

.yn-toast {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-text);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-bg);
  animation: yn-rise var(--duration-normal) ease-out;
}

/* Janela e painel lateral: <dialog class="yn-modal"> e <dialog class="yn-drawer"> com showModal() */
.yn-modal,
.yn-drawer {
  box-sizing: border-box;
  padding: var(--space-6);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.yn-modal {
  width: min(480px, calc(100vw - 32px));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.yn-drawer {
  inset: 0 0 0 auto;
  width: min(400px, 100vw);
  height: 100%;
  max-height: none;
  margin: 0;
  border-width: 0 0 0 1px;
}

.yn-modal::backdrop,
.yn-drawer::backdrop { background: rgb(0 0 0 / 0.45); }

.yn-dialog__header h2 { font-size: var(--text-lg); }

.yn-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.yn-dialog__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-6);
}

/* Barra de progresso: <progress class="yn-progress" value="65" max="100">65%</progress> */
.yn-progress {
  appearance: none;
  display: block;
  width: 100%;
  height: 6px;
  overflow: hidden;
  background: var(--color-border);
  border: 0;
  border-radius: var(--radius-full);
}

.yn-progress::-webkit-progress-bar { background: var(--color-border); border-radius: var(--radius-full); }
.yn-progress::-webkit-progress-value { background: var(--color-text); border-radius: var(--radius-full); }
.yn-progress::-moz-progress-bar { background: var(--color-text); border-radius: var(--radius-full); }

.yn-spinner {
  display: inline-block;
  flex: none;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: yn-spin 0.7s linear infinite;
}

/* Carregando conteúdo: <div class="yn-skeleton" style="width: 60%"></div> */
.yn-skeleton {
  height: 12px;
  background: var(--color-border);
  border-radius: var(--radius-sm);
  animation: yn-pulse 1.4s ease-in-out infinite;
}

/* ---------- Peças de sistema ---------- */
/* Estado vazio: sempre diz o próximo passo */
.yn-empty {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}

.yn-empty__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  color: var(--color-text-muted);
}

.yn-empty__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
}

.yn-empty p:not(.yn-empty__title) {
  max-width: 36ch;
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

/* Falha ao carregar: não é vazio. Diz o que houve e oferece "Tentar de novo".
   <div class="yn-empty" data-state="error" role="alert">... */
.yn-empty[data-state="error"] .yn-empty__icon {
  background: color-mix(in oklab, var(--color-danger) 10%, var(--color-bg));
  border-color: color-mix(in oklab, var(--color-danger) 30%, var(--color-bg));
  color: var(--color-danger);
}

/* Código do erro para o suporte (nunca a mensagem técnica inteira) */
.yn-empty__code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

/* Indicador sem base para calcular: "Sem dados", nunca 0 ou NaN */
.yn-kpi__value--empty {
  font-size: var(--text-lg);
  color: var(--color-text-muted);
}

/* Etapas: <ol class="yn-steps"><li class="yn-step" data-state="done|current|pending">...</li></ol> */
.yn-steps {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.yn-step {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  padding-bottom: var(--space-5);
}

.yn-step:last-child { padding-bottom: 0; }

.yn-step::before {
  content: "";
  position: absolute;
  top: 28px;
  bottom: 4px;
  left: 11.5px;
  width: 1px;
  background: var(--color-border-strong);
}

.yn-step:last-child::before { display: none; }

.yn-step__dot {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  box-sizing: border-box;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 50%;
  color: var(--color-text-muted);
}

.yn-step__dot svg { width: 14px; height: 14px; }

.yn-step[data-state="done"] .yn-step__dot {
  background: var(--color-text);
  border-color: var(--color-text);
  color: var(--color-bg);
}

.yn-step[data-state="current"] .yn-step__dot {
  border: 2px solid var(--color-text);
  color: var(--color-text);
}

.yn-step p { margin: 0; }
.yn-step__title { font-size: var(--text-sm); font-weight: var(--weight-medium); }
.yn-step[data-state="pending"] .yn-step__title { color: var(--color-text-muted); }

.yn-step__meta {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

/* Arquivos */
.yn-dropzone {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: var(--space-6) var(--space-4);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  text-align: center;
  color: var(--color-text-muted);
}

.yn-dropzone strong { font-weight: var(--weight-semibold); color: var(--color-text); }
.yn-dropzone[data-dragging] { background: var(--color-surface); border-color: var(--color-text); }

.yn-file {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

.yn-file:last-child { border-bottom: 0; }
.yn-file p { margin: 0; }
.yn-file .yn-progress { margin-block: 6px 4px; }
.yn-file[data-state="error"] > svg,
.yn-file[data-state="error"] .yn-file__meta { color: var(--color-danger); }
.yn-file__name { overflow: hidden; font-weight: var(--weight-medium); text-overflow: ellipsis; white-space: nowrap; }
.yn-file__meta { font-size: var(--text-xs); color: var(--color-text-muted); }

/* Atalho de teclado: <kbd class="yn-kbd">Ctrl K</kbd> */
.yn-kbd {
  padding: 1px 6px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

/* Só para leitor de tela: some da tela, continua lido */
.yn-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ---------- Busca com lista (combobox) ---------- */
/* <div class="yn-combobox">
     <input class="yn-input" role="combobox" aria-expanded="true" aria-controls="lista" aria-autocomplete="list">
     <ul class="yn-listbox" role="listbox" id="lista"><li role="option" aria-selected="false">...</li></ul>
   </div>
   A lista aparece quando o campo tem aria-expanded="true". Setas movem, Enter escolhe, Esc fecha. */
.yn-combobox { position: relative; }

.yn-listbox {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  z-index: 20;
  max-height: 280px;
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  list-style: none;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.yn-combobox:has([role="combobox"][aria-expanded="false"]) .yn-listbox { display: none; }

.yn-listbox [role="option"] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
}

.yn-listbox [role="option"]:hover,
.yn-listbox [role="option"][data-active] { background: var(--color-surface); }
.yn-listbox [role="option"][aria-selected="true"] { background: var(--color-brand-subtle); font-weight: var(--weight-semibold); }
.yn-listbox [role="option"][aria-disabled="true"] { color: var(--color-text-muted); cursor: not-allowed; }

/* Trecho que bate com a busca: destaque por peso, nunca por cor */
.yn-listbox mark { background: none; font-weight: var(--weight-bold); color: inherit; }

.yn-listbox__meta {
  flex: none;
  font-size: var(--text-xs);
  font-weight: var(--weight-regular);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.yn-listbox__group {
  padding: var(--space-2) 10px var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.yn-listbox__empty {
  display: grid;
  justify-items: start;
  gap: var(--space-2);
  padding: var(--space-3) 10px;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

/* ---------- Prazo e faixa no topo ---------- */
/* Prazo: o texto diz o estado, a cor só reforça.
   <span class="yn-deadline" data-state="late"><i data-lucide="clock"></i>Atrasado 2 h</span>
   data-state: ok (padrão), soon (vence logo), late (atrasado), done (cumprido), paused (parado, fora do horário) */
.yn-deadline {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-deadline svg { width: 14px; height: 14px; }
.yn-deadline[data-state="soon"] { color: var(--color-warning); }
.yn-deadline[data-state="late"] { font-weight: var(--weight-semibold); color: var(--color-danger); }
.yn-deadline[data-state="done"] { color: var(--color-success); }

/* Faixa no topo da tela inteira: modo demonstração, sem internet, versão nova, manutenção.
   Primeiro filho de .yn-main (ou do body). Sem data-tone = faixa invertida (modo demonstração).
   <div class="yn-banner" data-tone="warning" role="status"><i data-lucide="wifi-off"></i><p>...</p><button class="yn-btn yn-btn--sm yn-btn--secondary">...</button></div> */
.yn-banner {
  --yn-banner-tone: var(--color-bg);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-6);
  background: var(--color-text);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-bg);
}

.yn-banner p { flex: 1 1 240px; margin: 0; }

.yn-banner[data-tone] {
  background: color-mix(in oklab, var(--yn-banner-tone) 12%, var(--color-bg));
  border-bottom: 1px solid color-mix(in oklab, var(--yn-banner-tone) 35%, var(--color-bg));
  color: var(--color-text);
}

.yn-banner[data-tone] > svg { color: var(--yn-banner-tone); }
.yn-banner[data-tone="success"] { --yn-banner-tone: var(--color-success); }
.yn-banner[data-tone="info"] { --yn-banner-tone: var(--color-info); }
.yn-banner[data-tone="warning"] { --yn-banner-tone: var(--color-warning); }
.yn-banner[data-tone="danger"] { --yn-banner-tone: var(--color-danger); }

/* ---------- Quadro (kanban) ---------- */
/* Funil de vendas, produção, tarefas. Colunas rolam de lado.
   Todo card também se move sem arrastar: botões ← → (teclado e celular). Fechar como ganho ou perdido
   vai para as colunas data-lane="won" e "lost"; o card guarda a etapa em que estava. */
.yn-kanban {
  display: grid;
  grid-auto-columns: minmax(260px, 1fr);
  grid-auto-flow: column;
  gap: var(--space-4);
  padding-bottom: var(--space-2);
  overflow-x: auto;
  scroll-snap-type: x proximity;
}

.yn-kanban__col {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  scroll-snap-align: start;
}

.yn-kanban__col[data-lane="won"] { border-top: 2px solid var(--color-success); }
.yn-kanban__col[data-lane="lost"] { border-top: 2px solid var(--color-danger); }

.yn-kanban__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-1) var(--space-1);
}

.yn-kanban__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.yn-kanban__total {
  margin-left: auto;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-kanban__card {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.yn-kanban__card[data-dragging] { opacity: 0.5; }
.yn-kanban__col[data-drop-target] { border-color: var(--color-text); }
.yn-kanban__card p { margin: 0; }
.yn-kanban__card-title { font-weight: var(--weight-semibold); }

.yn-kanban__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.yn-kanban__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.yn-kanban__empty {
  padding: var(--space-4) var(--space-2);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  text-align: center;
  color: var(--color-text-muted);
}

/* ---------- Histórico ---------- */
/* Quem fez o quê e quando (ligação, mudança de etapa, nota, mensagem). Mais novo em cima.
   <ol class="yn-timeline"><li class="yn-timeline__item" data-tone="success">
     <span class="yn-timeline__icon"><i data-lucide="phone"></i></span>
     <div><p class="yn-timeline__head"><strong>Carlos M.</strong> ligou <time class="yn-timeline__time">hoje 10:42</time></p>
     <p class="yn-timeline__body">Texto</p></div></li></ol> */
.yn-timeline {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.yn-timeline__item {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: var(--space-3);
  padding-bottom: var(--space-5);
}

.yn-timeline__item:last-child { padding-bottom: 0; }

.yn-timeline__item::before {
  content: "";
  position: absolute;
  top: 36px;
  bottom: 4px;
  left: 15.5px;
  width: 1px;
  background: var(--color-border);
}

.yn-timeline__item:last-child::before { display: none; }

.yn-timeline__icon {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  color: var(--color-text-muted);
}

.yn-timeline__item[data-tone="success"] .yn-timeline__icon { color: var(--color-success); }
.yn-timeline__item[data-tone="info"] .yn-timeline__icon { color: var(--color-info); }
.yn-timeline__item[data-tone="warning"] .yn-timeline__icon { color: var(--color-warning); }
.yn-timeline__item[data-tone="danger"] .yn-timeline__icon { color: var(--color-danger); }

.yn-timeline__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  margin: 0;
  padding-top: 5px;
  font-size: var(--text-sm);
}

.yn-timeline__head strong { font-weight: var(--weight-semibold); }

.yn-timeline__time {
  margin-left: auto;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-timeline__body {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

/* Trecho citado (nota, mensagem, motivo) */
.yn-timeline__quote {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--color-text);
}

/* ---------- Mensagens (WhatsApp, SAC) ---------- */
/* Caixa de entrada: lista de conversas + conversa aberta.
   No celular mostra uma coisa por vez: data-view="thread" na .yn-inbox abre a conversa. */
.yn-inbox {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  min-height: 480px;
  overflow: hidden;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.yn-inbox__list {
  display: grid;
  align-content: start;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border-right: 1px solid var(--color-border);
}

.yn-inbox__item {
  display: grid;
  grid-template-areas: "avatar name time" "avatar preview count";
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 2px var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  text-decoration: none;
  color: var(--color-text);
  cursor: pointer;
}

.yn-inbox__item:hover { background: var(--color-surface); }

.yn-inbox__item[aria-current="true"] {
  background: var(--color-brand-subtle);
  box-shadow: inset 3px 0 0 var(--color-brand);
}

.yn-inbox__item > .yn-avatar { grid-area: avatar; align-self: start; }
.yn-inbox__item > .yn-count { grid-area: count; justify-self: end; }

.yn-inbox__name {
  grid-area: name;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yn-inbox__time {
  grid-area: time;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-inbox__preview {
  grid-area: preview;
  overflow: hidden;
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-inbox__item[data-unread] .yn-inbox__preview { font-weight: var(--weight-medium); color: var(--color-text); }

.yn-thread {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.yn-thread__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.yn-thread__title { flex: 1 1 160px; min-width: 0; }
.yn-thread__title p { margin: 0; }
.yn-thread__back { display: none; }

.yn-thread__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  overflow-y: auto;
  background: var(--color-surface);
}

/* Separador de dia: "Hoje", "Ontem", "12/09" */
.yn-thread__day {
  align-self: center;
  padding: 2px 10px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

/* Balão: data-from="them" (cliente, padrão), "me" (equipe), "note" (nota interna, não vai para o cliente), "system" */
.yn-bubble {
  align-self: flex-start;
  box-sizing: border-box;
  max-width: min(75%, 520px);
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.yn-bubble p { margin: 0; }

.yn-bubble[data-from="me"] {
  align-self: flex-end;
  background: var(--color-brand-subtle);
  border-color: color-mix(in oklab, var(--color-brand) 25%, var(--color-bg));
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
}

.yn-bubble[data-from="note"] {
  align-self: stretch;
  max-width: none;
  background: color-mix(in oklab, var(--color-warning) 10%, var(--color-bg));
  border: 1px dashed color-mix(in oklab, var(--color-warning) 45%, var(--color-bg));
  border-radius: var(--radius-md);
}

.yn-bubble[data-from="system"] {
  align-self: center;
  background: none;
  border: 0;
  font-size: var(--text-xs);
  text-align: center;
  color: var(--color-text-muted);
}

.yn-bubble__author {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: 2px;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
}

/* Hora e situação: relógio (enviando), check (enviada), check-check (lida), circle-alert (falhou) */
.yn-bubble__meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
  margin-top: 2px;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.yn-bubble__meta svg { width: 14px; height: 14px; }
.yn-bubble[data-state="failed"] { border-color: var(--color-danger); }
.yn-bubble[data-state="failed"] .yn-bubble__meta { color: var(--color-danger); }

/* Caixa de escrever: anexar + texto + enviar */
.yn-composer {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-raised);
  border-top: 1px solid var(--color-border);
}

.yn-composer .yn-input { flex: 1; }

.yn-composer textarea.yn-input {
  min-height: 40px;
  max-height: 160px;
  padding-block: 9px;
  resize: none;
}

@media (max-width: 768px) {
  .yn-inbox { grid-template-columns: minmax(0, 1fr); }
  .yn-inbox__list { border-right: 0; }
  .yn-inbox:not([data-view="thread"]) .yn-thread { display: none; }
  .yn-inbox[data-view="thread"] .yn-inbox__list { display: none; }
  .yn-thread__back { display: inline-flex; }
  .yn-bubble { max-width: 88%; }
}

/* ---------- Folha de baixo ---------- */
/* <dialog class="yn-sheet"> com showModal(). No celular sobe de baixo; no computador vira janela.
   Para ações rápidas e escolhas curtas. Formulário longo vai para uma tela. */
.yn-sheet {
  box-sizing: border-box;
  width: min(480px, calc(100vw - 32px));
  max-height: 85vh;
  max-height: 85dvh;
  padding: var(--space-6);
  overflow-y: auto;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  color: var(--color-text);
}

.yn-sheet::backdrop { background: rgb(0 0 0 / 0.45); }

@media (max-width: 768px) {
  .yn-sheet {
    inset: auto 0 0;
    width: 100%;
    max-width: none;
    margin: 0;
    padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
    border-width: 1px 0 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    animation: yn-sheet-up var(--duration-normal) ease-out;
  }

  /* Alça */
  .yn-sheet::before {
    content: "";
    display: block;
    width: 36px;
    height: 4px;
    margin: calc(var(--space-3) * -1) auto var(--space-4);
    background: var(--color-border-strong);
    border-radius: var(--radius-full);
  }
}

/* Lista de ações dentro da folha */
.yn-sheet__actions {
  display: grid;
  margin: 0 calc(var(--space-2) * -1);
}

.yn-sheet__actions button,
.yn-sheet__actions a {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-min);
  padding: 0 var(--space-2);
  background: none;
  border: 0;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  text-decoration: none;
  color: var(--color-text);
  cursor: pointer;
}

.yn-sheet__actions button:hover,
.yn-sheet__actions a:hover { background: var(--color-surface); }

/* ---------- Catálogo e pedido ---------- */
/* Grade de produtos: 2 por linha no celular */
.yn-catalog {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
  gap: var(--space-4);
}

.yn-product {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.yn-product__media {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  background: var(--color-surface);
  color: var(--color-silver);
}

.yn-product__media img { width: 100%; height: 100%; object-fit: cover; }
.yn-product[data-stock="out"] .yn-product__media { opacity: 0.5; }

.yn-product__body {
  display: grid;
  flex: 1;
  align-content: start;
  gap: var(--space-2);
  padding: var(--space-3);
}

.yn-product__body p { margin: 0; }

.yn-product__name {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.yn-product__meta {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.yn-product__price {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}

.yn-product__price s {
  margin-left: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-regular);
  color: var(--color-text-muted);
}

/* Quantidade: <div class="yn-qty"><button aria-label="Diminuir">−</button><input inputmode="numeric" aria-label="Quantidade"><button aria-label="Aumentar">+</button></div> */
.yn-qty {
  display: inline-flex;
  box-sizing: border-box;
  height: 40px;
  overflow: hidden;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
}

.yn-qty button {
  display: grid;
  place-items: center;
  width: 40px;
  padding: 0;
  background: none;
  border: 0;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
}

.yn-qty button:hover:not(:disabled) { background: var(--color-surface); }
.yn-qty button:disabled { opacity: 0.4; cursor: not-allowed; }

.yn-qty input {
  width: 48px;
  min-width: 0;
  padding: 0;
  background: none;
  border: 0;
  border-inline: 1px solid var(--color-border);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--color-text);
  appearance: textfield;
}

.yn-qty input::-webkit-inner-spin-button,
.yn-qty input::-webkit-outer-spin-button { margin: 0; appearance: none; }
.yn-qty input:focus-visible { outline-offset: -2px; }

/* Grade (tamanho × cor): uma quantidade por célula. Célula sem estoque fica desabilitada.
   <div class="yn-grade-wrap"><table class="yn-grade">...<td><input inputmode="numeric" placeholder="0" aria-label="P, Preto"></td> */
.yn-grade-wrap { overflow-x: auto; }

.yn-grade {
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.yn-grade th {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  text-align: center;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-grade th[scope="row"] { text-align: left; color: var(--color-text); }
.yn-grade td { padding: var(--space-1); text-align: center; }

.yn-grade input {
  box-sizing: border-box;
  width: 56px;
  height: 36px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--color-text);
}

.yn-grade input::placeholder { color: var(--color-text-muted); opacity: 1; }
.yn-grade input:not(:placeholder-shown) { border-color: var(--color-text); font-weight: var(--weight-semibold); }
.yn-grade input:focus-visible { outline-offset: 0; }

.yn-grade input:disabled {
  background: var(--color-surface);
  border-style: dashed;
  cursor: not-allowed;
}

.yn-grade__total { font-weight: var(--weight-semibold); }

/* Botão flutuante (carrinho, novo pedido no celular): um por tela, sempre com texto ou aria-label.
   <a class="yn-fab" href="/carrinho"><i data-lucide="shopping-cart"></i>Carrinho <span class="yn-count">3</span></a> */
.yn-fab {
  position: fixed;
  right: var(--space-4);
  bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  z-index: 30;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  box-sizing: border-box;
  min-width: 56px;
  min-height: 56px;
  padding: 0 var(--space-5);
  background: var(--color-brand);
  border: 1px solid var(--color-brand-edge);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-decoration: none;
  color: var(--color-brand-contrast);
  cursor: pointer;
}

.yn-fab:hover { background: var(--color-brand-hover); }
.yn-fab svg.lucide { width: 20px; height: 20px; }

.yn-fab .yn-count {
  background: var(--color-brand-contrast);
  border-color: transparent;
  color: var(--color-brand);
}

/* Espaço no fim da tela para o botão flutuante não cobrir o último item */
body:has(> .yn-fab) .yn-content { padding-bottom: calc(56px + var(--space-8)); }

/* ---------- Decisão e ficha de dados ---------- */
/* Pedido de aprovação (desconto, crédito, cancelamento): o que está em jogo, os fatos e duas saídas.
   Reprovar ou devolver sempre pede motivo (janela com campo obrigatório). */
.yn-decision {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-warning);
  border-radius: var(--radius-lg);
}

.yn-decision__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

.yn-decision__head p { margin: 0; }

.yn-decision__title {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
}

.yn-decision__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

/* Ficha de dados: <dl class="yn-dl"><div><dt>CNPJ</dt><dd>12.345.678/0001-90</dd></div></dl>
   Campo sem valor mostra "—" sozinho. .yn-dl--rows = um por linha, rótulo à esquerda. */
.yn-dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  gap: var(--space-3) var(--space-6);
  margin: 0;
}

.yn-dl > div { min-width: 0; }

.yn-dl dt {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--color-text-muted);
}

.yn-dl dd {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.yn-dl dd:empty::before { content: "—"; color: var(--color-text-muted); }

.yn-dl--rows { grid-template-columns: minmax(0, 1fr); gap: 0; }

.yn-dl--rows > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding-block: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.yn-dl--rows > div:last-child { border-bottom: 0; }
.yn-dl--rows dt { font-size: var(--text-sm); font-weight: var(--weight-regular); }
.yn-dl--rows dd { margin: 0; text-align: right; }

/* ---------- Gráficos sem biblioteca ---------- */
/* Barras deitadas (ranking de produto, venda por representante). --value de 0 a 100.
   Todo gráfico tem ao lado <details class="yn-as-table"> com os mesmos números em tabela. */
.yn-bars {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.yn-bars__row {
  display: grid;
  grid-template-columns: minmax(72px, 30%) minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  font-size: var(--text-sm);
}

.yn-bars__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.yn-bars__track {
  height: 10px;
  overflow: hidden;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.yn-bars__fill {
  display: block;
  width: calc(min(var(--value, 0), 100) * 1%);
  height: 100%;
  background: var(--color-text);
  border-radius: var(--radius-sm);
}

.yn-bars__value {
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

/* Colunas em pé (venda por dia, por mês). --value de 0 a 100 em cada coluna. */
.yn-columns {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--space-2);
}

.yn-columns__col {
  display: grid;
  grid-template-rows: var(--chart-height, 160px) auto;
  gap: 6px;
  justify-items: center;
  min-width: 0;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.yn-columns__bar {
  align-self: end;
  width: min(100%, 32px);
  height: calc(min(var(--value, 0), 100) * 1%);
  min-height: 2px;
  background: var(--color-text);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

/* Tom das barras: status, ou data-tone="muted" para previsão e período que ainda não fechou */
:is(.yn-bars__row, .yn-columns__col)[data-tone="success"] :is(.yn-bars__fill, .yn-columns__bar) { background: var(--color-success); }
:is(.yn-bars__row, .yn-columns__col)[data-tone="warning"] :is(.yn-bars__fill, .yn-columns__bar) { background: var(--color-warning); }
:is(.yn-bars__row, .yn-columns__col)[data-tone="danger"] :is(.yn-bars__fill, .yn-columns__bar) { background: var(--color-danger); }
:is(.yn-bars__row, .yn-columns__col)[data-tone="muted"] :is(.yn-bars__fill, .yn-columns__bar) { background: var(--color-border-strong); }

/* "Ver como tabela": <details class="yn-as-table"><summary>Ver como tabela</summary><div class="yn-table-wrap">...</div></details> */
.yn-as-table > summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-text-muted);
  cursor: pointer;
}

.yn-as-table > summary::-webkit-details-marker { display: none; }
.yn-as-table > summary:hover { color: var(--color-text); text-decoration: underline; }
.yn-as-table[open] > summary { margin-bottom: var(--space-3); }

/* ---------- Ranking e régua de meta ---------- */
/* <ol class="yn-ranking"><li><span class="yn-avatar">CM</span><span class="yn-ranking__name">Carlos M.</span><span class="yn-ranking__value">R$ 82.400,00</span></li></ol>
   A posição vem da ordem da lista. aria-current="true" marca "você". */
.yn-ranking {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: yn-rank;
}

.yn-ranking > li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px var(--space-2);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--text-sm);
  counter-increment: yn-rank;
}

.yn-ranking > li:last-child { border-bottom: 0; }

.yn-ranking > li::before {
  content: counter(yn-rank);
  flex: none;
  width: 20px;
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--color-text-muted);
}

.yn-ranking > li:nth-child(-n + 3)::before { color: var(--color-text); }
.yn-ranking > li[aria-current="true"] { background: var(--color-brand-subtle); border-radius: var(--radius-md); }

.yn-ranking__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yn-ranking__value { font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Régua de meta: quanto fez, onde deveria estar hoje e quanto falta.
   <div class="yn-meter" data-state="behind" style="--value: 62; --expected: 70">
     <div class="yn-meter__track"><span class="yn-meter__fill"></span><span class="yn-meter__mark"></span></div> ...
   data-state: behind (abaixo do esperado), ahead (acima), done (bateu) */
.yn-meter {
  display: grid;
  gap: var(--space-2);
}

.yn-meter__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}

.yn-meter__head p { margin: 0; }

.yn-meter__value {
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--tracking-tight);
}

.yn-meter__track {
  position: relative;
  height: 10px;
  margin-block: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.yn-meter__fill {
  display: block;
  width: calc(min(var(--value, 0), 100) * 1%);
  height: 100%;
  background: var(--color-text);
  border-radius: inherit;
}

/* Marca do "esperado hoje" */
.yn-meter__mark {
  position: absolute;
  top: -5px;
  bottom: -5px;
  left: calc(min(var(--expected, 0), 100) * 1%);
  width: 2px;
  margin-left: -1px;
  background: var(--color-text-muted);
  border-radius: 1px;
}

.yn-meter[data-state="behind"] .yn-meter__fill { background: var(--color-warning); }
.yn-meter[data-state="ahead"] .yn-meter__fill,
.yn-meter[data-state="done"] .yn-meter__fill { background: var(--color-success); }

.yn-meter__legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

/* ---------- Ficha 360 e próximo passo ---------- */
/* Ficha de cliente, pedido ou caso: resumo fixo à esquerda, detalhe em abas à direita.
   <div class="yn-split"><aside class="yn-split__aside">...</aside><div>abas</div></div> */
.yn-split {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
}

.yn-split__aside {
  position: sticky;
  top: var(--space-6);
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

@media (max-width: 960px) {
  .yn-split { grid-template-columns: minmax(0, 1fr); }
  .yn-split__aside { position: static; }
}

/* Próximo passo: a ação que o usuário deve fazer agora, no topo da ficha.
   data-state="late" quando passou da hora. */
.yn-next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-4);
  background: var(--color-brand-subtle);
  border: 1px solid color-mix(in oklab, var(--color-brand) 30%, var(--color-bg));
  border-radius: var(--radius-lg);
}

.yn-next__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  background: var(--color-brand);
  border-radius: var(--radius-md);
  color: var(--color-brand-contrast);
}

.yn-next__body { flex: 1 1 200px; min-width: 0; }
.yn-next__body p { margin: 0; }
.yn-next__title { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.yn-next__meta { margin-top: 2px; font-size: var(--text-sm); color: var(--color-text-muted); }

.yn-next[data-state="late"] {
  background: color-mix(in oklab, var(--color-danger) 8%, var(--color-bg));
  border-color: color-mix(in oklab, var(--color-danger) 35%, var(--color-bg));
}

.yn-next[data-state="late"] .yn-next__icon { background: var(--color-danger); color: var(--color-bg); }

/* ---------- Formulário longo ---------- */
/* Seções com título à esquerda e campos à direita; no celular, um embaixo do outro.
   <section class="yn-form-section"><div class="yn-form-section__intro"><h2>Dados do cliente</h2><p>...</p></div><div class="yn-form-grid">campos</div></section>
   Campo que ocupa a linha toda: .yn-field.yn-field--full */
.yn-form-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--space-4) var(--space-8);
  padding-block: var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.yn-form-section:first-child { padding-top: 0; }
.yn-form-section__intro :is(h2, h3) { font-size: var(--text-base); }

.yn-form-section__intro p {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.yn-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: var(--space-4);
}

.yn-form-grid > .yn-field--full { grid-column: 1 / -1; }

@media (max-width: 768px) {
  .yn-form-section { grid-template-columns: minmax(0, 1fr); }
}

/* Rodapé fixo com as ações: sempre à vista. Mostra "Alterações não salvas" e trava o botão enquanto grava. */
.yn-form-footer {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-6) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
}

.yn-form-footer__status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.yn-form-footer__status[data-dirty] { font-weight: var(--weight-medium); color: var(--color-warning); }

@media (max-width: 768px) {
  .yn-form-footer { padding-inline: var(--space-4); }
  .yn-form-footer .yn-btn { flex: 1; }
  .yn-form-footer__status { flex-basis: 100%; }
}

/* ---------- Animações ---------- */
@keyframes yn-spin { to { transform: rotate(360deg); } }
@keyframes yn-pulse { 50% { opacity: 0.45; } }
@keyframes yn-rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes yn-sheet-up { from { transform: translateY(100%); } }

/* ---------- Layout de painel ---------- */
/* Computador: menu lateral fixo (pode recolher para só ícones com data-sidebar="collapsed" no .yn-shell).
   Celular, dois modelos:
   - Gaveta (padrão, sistemas de escritório): botão .yn-nav-toggle na barra do topo abre o menu por cima,
     com .yn-scrim atrás. Aberto = data-nav="open" no .yn-shell.
   - Abas embaixo (apps de rua: representante, entregador, vistoria): .yn-shell--tabs + .yn-tabbar
     com 3 a 5 destinos. O resto vai em "Mais". */
.yn-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100dvh;
}

.yn-sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  box-sizing: border-box;
  height: 100vh;
  height: 100dvh;
  padding: var(--space-5) var(--space-3);
  overflow-y: auto;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

/* Linha de cima do menu: assinatura + botão de recolher */
.yn-sidebar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 32px;
  padding-left: var(--space-3);
}

.yn-sidebar__head .yn-sidebar__brand { padding: 0; }

/* Assinatura no menu: "YAN NUNES" (Yan em Bold, Nunes em Regular) + nome do produto */
.yn-sidebar__brand {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  padding: 0 var(--space-3);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.yn-sidebar__brand .yn-light {
  font-weight: var(--weight-regular);
}

/* Produto: YAN NUNES · CRM, YAN NUNES · SALES... */
.yn-sidebar__product {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--color-text-muted);
}

/* Seletor de contexto (empresa, loja, filial, equipe). Use dentro de <details class="yn-menu yn-menu--block">.
   <summary class="yn-context"><span class="yn-context__mark">AC</span><span class="yn-context__text">
   <span class="yn-context__label">Empresa</span><span class="yn-context__name">Acme Matriz</span></span>
   <i data-lucide="chevrons-up-down"></i></summary> */
.yn-context {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: inherit;
  text-align: left;
  color: var(--color-text);
  cursor: pointer;
}

.yn-context:hover { border-color: var(--color-border-strong); }
.yn-context > svg { color: var(--color-text-muted); }

.yn-context__mark {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  background: var(--color-brand);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  color: var(--color-brand-contrast);
}

.yn-context__text {
  display: grid;
  flex: 1;
  min-width: 0;
  line-height: var(--leading-tight);
}

.yn-context__label { font-size: var(--text-xs); color: var(--color-text-muted); }

.yn-context__name {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Menu que ocupa a largura toda (seletor de contexto) e menu que abre para cima (rodapé do menu) */
.yn-menu--block { display: block; }
.yn-menu--block > .yn-menu__list { left: 0; }
.yn-menu__list--up { top: auto; bottom: calc(100% + 4px); }

.yn-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.yn-nav a {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  text-decoration: none;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.yn-nav a > svg.lucide { width: 20px; height: 20px; }

.yn-nav a:hover {
  background: var(--color-surface-raised);
  color: var(--color-text);
}

.yn-nav a[aria-current="page"] {
  background: var(--color-brand);
  color: var(--color-brand-contrast);
}

/* Contador no item: <a href="/casos">Casos <span class="yn-count">12</span></a> */
.yn-nav a .yn-count { margin-left: auto; }

/* Título de grupo dentro do menu: <p class="yn-nav__label">Cadastros</p> */
.yn-nav__label {
  margin: var(--space-3) 0 var(--space-1);
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

/* Usuário no fim do menu: avatar, nome, papel e menu (perfil, sair) */
.yn-sidebar__user {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: auto;
  padding: var(--space-4) var(--space-1) 0 var(--space-3);
  border-top: 1px solid var(--color-border);
}

.yn-sidebar__user-text {
  display: grid;
  flex: 1;
  min-width: 0;
  line-height: var(--leading-tight);
}

.yn-sidebar__user-name {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yn-sidebar__user-role { font-size: var(--text-xs); color: var(--color-text-muted); }

.yn-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.yn-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: var(--topbar-height);
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

/* Com o botão de menu, o título ocupa o meio e as ações ficam à direita.
   Sem espaço para os três, as ações descem para a linha de baixo. */
.yn-topbar > .yn-nav-toggle + * { flex: 1 1 160px; min-width: 0; }

.yn-content {
  box-sizing: border-box;
  display: grid;
  align-content: start;
  gap: var(--space-6);
  flex: 1;
  width: 100%;
  max-width: var(--content-max);
  padding: var(--space-6);
}

/* Botão do menu (gaveta) e fundo escuro atrás dela: só aparecem no celular */
.yn-nav-toggle,
.yn-scrim,
.yn-tabbar { display: none; }

/* Menu recolhido (computador): só ícones. Guarde a escolha no navegador.
   Cada link leva title="Nome" para a dica aparecer. */
@media (min-width: 769px) {
  .yn-shell[data-sidebar="collapsed"] { grid-template-columns: var(--sidebar-collapsed-width) minmax(0, 1fr); }

  .yn-shell[data-sidebar="collapsed"] .yn-sidebar {
    align-items: center;
    padding-inline: var(--space-2);
    overflow: visible;
  }

  .yn-shell[data-sidebar="collapsed"] .yn-sidebar__head { justify-content: center; padding: 0; }

  .yn-shell[data-sidebar="collapsed"] :is(
    .yn-sidebar__brand,
    .yn-context__text,
    .yn-context > svg,
    .yn-sidebar__user-text,
    .yn-sidebar__user > .yn-menu
  ) { display: none; }

  .yn-shell[data-sidebar="collapsed"] .yn-context { padding: var(--space-1); background: none; border-color: transparent; }
  .yn-shell[data-sidebar="collapsed"] .yn-menu--block > .yn-menu__list { right: auto; min-width: 220px; }
  .yn-shell[data-sidebar="collapsed"] .yn-nav { align-self: stretch; }

  .yn-shell[data-sidebar="collapsed"] .yn-nav a {
    justify-content: center;
    gap: 0;
    padding-inline: 0;
    font-size: 0;
  }

  /* Contador vira um ponto */
  .yn-shell[data-sidebar="collapsed"] .yn-nav a .yn-count {
    position: absolute;
    top: 4px;
    right: 8px;
    min-width: 8px;
    height: 8px;
    padding: 0;
    font-size: 0;
  }

  .yn-shell[data-sidebar="collapsed"] .yn-nav a .yn-count:not([data-tone]) {
    background: var(--color-text-muted);
    border-color: transparent;
  }

  .yn-shell[data-sidebar="collapsed"] .yn-nav__label {
    height: 1px;
    margin: var(--space-2) var(--space-2);
    padding: 0;
    overflow: hidden;
    background: var(--color-border);
    font-size: 0;
  }

  .yn-shell[data-sidebar="collapsed"] .yn-sidebar__user { justify-content: center; padding-inline: 0; }
}

@media (max-width: 768px) {
  .yn-shell { grid-template-columns: minmax(0, 1fr); }
  .yn-topbar, .yn-content { padding-inline: var(--space-4); }
  .yn-topbar { gap: var(--space-2) var(--space-3); padding-block: var(--space-3); }
  .yn-topbar h1 { font-size: var(--text-xl); }
  .yn-sidebar__toggle { display: none; }

  /* Modelo gaveta */
  .yn-nav-toggle { display: inline-flex; }

  .yn-shell:has(.yn-nav-toggle) .yn-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    width: min(300px, 85vw);
    height: auto;
    box-shadow: var(--shadow-md);
    visibility: hidden;
    transform: translateX(-100%);
    transition: transform var(--duration-normal) ease-out, visibility 0s linear var(--duration-normal);
  }

  /* Aberta: fica visível na hora (o foco já pode entrar); fechada: some só depois de deslizar */
  .yn-shell[data-nav="open"] .yn-sidebar {
    visibility: visible;
    transform: none;
    transition: transform var(--duration-normal) ease-out, visibility 0s;
  }

  .yn-shell[data-nav="open"] .yn-scrim {
    position: fixed;
    inset: 0;
    z-index: 35;
    display: block;
    background: rgb(0 0 0 / 0.45);
  }

  body:has(.yn-shell[data-nav="open"]) { overflow: hidden; }

  /* Modelo abas embaixo */
  .yn-shell--tabs .yn-sidebar { display: none; }
  .yn-shell--tabs .yn-main { padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom, 0px)); }

  .yn-tabbar {
    position: fixed;
    inset: auto 0 0;
    z-index: 30;
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--color-surface-raised);
    border-top: 1px solid var(--color-border);
  }

  .yn-tabbar :is(a, button) {
    position: relative;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 2px;
    min-height: var(--tabbar-height);
    padding: var(--space-1);
    background: none;
    border: 0;
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    text-decoration: none;
    color: var(--color-text-muted);
    cursor: pointer;
  }

  .yn-tabbar svg.lucide {
    width: 20px;
    height: 20px;
    padding: 4px 16px;
    border-radius: var(--radius-full);
  }

  .yn-tabbar [aria-current="page"] { color: var(--color-text); }
  .yn-tabbar [aria-current="page"] svg.lucide { background: var(--color-brand-subtle); }

  .yn-tabbar .yn-count {
    position: absolute;
    top: 6px;
    left: calc(50% + 8px);
  }

  /* O que fica preso embaixo sobe acima das abas */
  body:has(.yn-shell--tabs) :is(.yn-toast-region, .yn-fab) {
    bottom: calc(var(--tabbar-height) + var(--space-4) + env(safe-area-inset-bottom, 0px));
  }

  .yn-shell--tabs .yn-form-footer { bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom, 0px)); }

  /* Sem botão de menu e sem abas (marcação da v0.1): o menu vira uma barra rolável no topo.
     Mantido para não quebrar sistemas antigos. Sistema novo usa gaveta ou abas. */
  .yn-shell:not(:has(.yn-nav-toggle)):not(.yn-shell--tabs) .yn-sidebar {
    position: static;
    gap: var(--space-3);
    height: auto;
    padding: var(--space-3) var(--space-4);
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .yn-shell:not(:has(.yn-nav-toggle)):not(.yn-shell--tabs) .yn-sidebar__brand { padding: 0; }
  .yn-shell:not(:has(.yn-nav-toggle)):not(.yn-shell--tabs) .yn-nav { flex-direction: row; overflow-x: auto; }
}

/* ---------- Crédito "Criado por" ---------- */
/* Obrigatório no rodapé de todo sistema entregue: uma linha pequena, como marca d'água.
   Sempre neutro, nunca na cor do cliente.
   <footer class="yn-credit">Criado por <a href="..." rel="noopener" target="_blank">Yan Nunes</a></footer> */
.yn-credit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0 var(--space-1);
  padding: var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.yn-credit a {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-weight: var(--weight-medium);
  text-decoration: none;
  color: inherit;
}

.yn-credit a:hover {
  color: var(--color-text);
  text-decoration: underline;
}

/* Símbolo YN em SVG, opcional — quando a versão vetorial existir */
.yn-credit__mark {
  width: auto;
  height: 12px;
}

/* Marcação antiga (v0.1): <span class="yn-credit__name"><strong>Yan</strong> Nunes</span> */
.yn-credit__name strong {
  font-weight: inherit;
}

/* ---------- Toque no celular ---------- */
/* Em tela de toque, tudo que se aperta tem pelo menos 44px. */
@media (pointer: coarse) {
  .yn-btn,
  .yn-btn--sm,
  .yn-input,
  .yn-nav a,
  .yn-tab,
  .yn-check,
  .yn-menu__list button,
  .yn-menu__list a,
  .yn-segmented button,
  .yn-listbox [role="option"] { min-height: var(--touch-min); }

  .yn-btn--icon,
  .yn-btn--sm.yn-btn--icon { width: var(--touch-min); }

  .yn-pagination a,
  .yn-pagination button { min-width: var(--touch-min); height: var(--touch-min); }

  /* Campo com letra menor que 16px faz o iPhone dar zoom sozinho ao tocar */
  .yn-input,
  .yn-qty input,
  .yn-grade input { font-size: var(--text-base); }

  .yn-qty { height: calc(var(--touch-min) + 2px); }
  .yn-qty button { width: var(--touch-min); }
  .yn-grade input { height: var(--touch-min); }

  /* Filtro rápido fica com 36px na tela, mas a área de toque vai a 44px */
  button.yn-chip { position: relative; min-height: 36px; }
  button.yn-chip::after { content: ""; position: absolute; inset: -4px 0; }

  .yn-chip button {
    margin: -8px -8px -8px 0;
    padding: 10px;
  }
}
```
