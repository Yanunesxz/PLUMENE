# Cores do catálogo

Lê os PDFs do catálogo impresso e extrai, para cada referência, o bloco
`CORES / ESTAMPAS` — número, cor da bolinha e o rótulo `VARIADAS`.

## Por que ler do PDF e não do ERP

O Firebird tem uma coluna `COR`, mas na Corpo Sensual a fábrica trabalha só com
**sortido**: o sync agrega de propósito (`GROUP BY p.PRODUTO, p.TAMANHO`, somando
o estoque de todas as cores). As cores que o lojista escolhe existem apenas no
catálogo impresso, então é de lá que elas vêm.

O pedido continua indo ao ERP como sortido. A cor escolhida viaja na
**observação** do pedido, no formato `0015 3M 02 azul`.

## Como rodar

```bash
python extrair.py "CORPO SENSUAL - INVERNO 2026.pdf" "CORPO SENSUAL - VERÃO 2027.pdf" > cores-extraidas.json
```

Os catálogos ficam em `\\192.168.0.2\Comercial\CATALOGOS`. As pastas `T1`/`T2`/`T3`
mudam **só o preço** — as cores são as mesmas, então basta um catálogo por estação.

## Como ele acha as cores

1. As bolinhas são formas vetoriais de ~26pt; os números (`01`, `02`…) são as
   palavras logo abaixo delas.
2. A cor sai do **pixel renderizado**, não da camada vetorial — as bolinhas têm
   círculos sobrepostos e a ordem de desenho engana quem lê o vetor.
3. Duas referências podem dividir uma fileira de bolinhas lado a lado. A fronteira
   entre blocos é a numeração **reiniciar** (`01 02 03 | 01 02 03`), não o espaço.
4. Cada referência pega o bloco abaixo dela e mais próximo horizontalmente.

## Estado atual

- 155 referências extraídas dos 3 catálogos da Corpo Sensual;
- **147 dos 181** produtos do catálogo do app cobertos;
- 30 com cor única, 60 com `VARIADAS`.

### O que ainda falha

**34 produtos sem cor.** Entre eles o `1008`, que no catálogo tem uma bolinha só
com o rótulo `ÚNICA` — o bloco existe, mas o casamento referência↔bloco não pegou.
Páginas com layout diferente do padrão (duas referências dividindo um bloco
centralizado) são a causa provável.

Antes de virar dado de produção isso precisa de conferência por amostragem: cor
errada no catálogo vira pedido errado.
