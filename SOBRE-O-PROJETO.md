# Representantes Corpo Sensual

Plataforma comercial **B2B** para os representantes de vendas da Corpo Sensual — uma
confecção de moda íntima (pijamas, camisolas e lingerie). O sistema digitaliza a
tirada de pedidos: o representante consulta o catálogo, monta o pedido do cliente e
acompanha tudo pelo celular ou computador, enquanto a gerência aprova pedidos e
acompanha as comissões.

## O problema que resolve

Antes, os representantes anotavam os pedidos à mão (papel ou planilha), o que gerava:

- erros de preço e de itens;
- retrabalho para digitar os pedidos depois;
- dificuldade da gerência em acompanhar as vendas em tempo real.

A plataforma unifica esse processo: os pedidos são registrados de forma padronizada,
com **preços calculados automaticamente** pela tabela de cada representante, e as
**comissões são consolidadas** sozinhas.

## Quem usa (perfis)

- **Representante** — consulta o catálogo, cadastra clientes, monta/acompanha pedidos
  e **decide quais pedidos das lojas seguem para a fábrica**.
- **Gerente** — acompanha todos os pedidos, aprova ou recusa, e visualiza as comissões.
- **Administrador** — cadastra e gerencia os representantes e as configurações.
- **Loja** — o cliente comprando por conta própria: vê o catálogo com a tabela de
  preço dela, monta o pedido e acompanha o próprio histórico. Não aprova nada.
- **Visitante da vitrine** — quem abriu um link temporário (1h a 24h). Vê só o
  catálogo e pode fechar um pedido deixando nome e WhatsApp. Não tem conta.

## Principais funcionalidades

- **Login com perfis** (administrador, gerente e representante), com senha protegida
  e autenticação por token.
- **Catálogo** de produtos com busca, filtros e preço conforme a tabela do representante.
- **Pedido por grade** — o representante escolhe as quantidades por tamanho (P, M, G…).
- **Cadastro de clientes** com dados obrigatórios (nome, CNPJ/CPF e WhatsApp).
- **Acesso da loja** — o representante gera um convite de uso único e a loja passa a
  ter login próprio, com catálogo, pedidos e histórico dela.
- **Link temporário (vitrine)** — catálogo que expira em 1h, 6h, 12h ou 24h, para
  mostrar preço a quem ainda não é cliente sem abrir conta.
- **Fluxo do pedido** — do rascunho ao envio. O que a loja monta passa antes pelo
  representante, que decide se vai para a fábrica; o gerente dá a palavra final.
- **Comissões** por representante e por mês, sobre o valor faturado.
- **Funciona offline** — o pedido é salvo no aparelho e **sincroniza sozinho** quando
  a internet volta (essencial para o vendedor em campo).
- **Exportação de pedidos** em planilha (`.xlsx`).
- **App instalável (PWA)** — pode ser adicionado à tela inicial do celular.

## Como funciona (arquitetura)

O sistema é dividido em três camadas que se comunicam por uma **API REST**:

| Camada | Papel | Tecnologias |
| --- | --- | --- |
| **Front-end** | Interface com o usuário | React, Vite, TypeScript, React Router, Zustand, Tailwind CSS, PWA (Dexie/IndexedDB) |
| **Back-end** | Regras de negócio e API | Node.js, Fastify, TypeScript, JWT, Zod, bcrypt (padrão MVC) |
| **Banco de dados** | Armazenamento | PostgreSQL (Supabase) |

O código é versionado no **GitHub** e está publicado em nuvem: o front-end na
**Vercel**, a API no **Railway** e o banco no **Supabase**.

## Segurança e boas práticas

- Senhas armazenadas com **hash (bcrypt)** — nunca em texto puro.
- Acesso protegido por **token JWT** com expiração e renovação automática.
- **Validação dos dados** de entrada no servidor (Zod).
- **Preço recalculado no servidor** ao criar o pedido, evitando fraude de valores.

## Observação

Este sistema é uma camada moderna que **convive com o ERP** da empresa: o ERP continua
responsável pelo estoque real, faturamento e emissão fiscal. A plataforma cuida da
força de vendas — catálogo, pedidos, clientes e comissões.
