# Digitar a quantidade do tamanho

**Data:** 2026-08-06
**Base:** `main` @ `74815ff`

## O problema

Na janela que abre ao tocar numa peça (`SeletorTamanho`), cada tamanho é um quadrado e
**tocar soma 1**. Isso funciona e o Yan não quer que mude: é como o representante anota
no papel, "P:2 M:4", sem caçar um `+` de 9 pixels.

O problema aparece no volume. Trinta peças do M naquela cor são **trinta toques**. E
para desfazer, o menos tira uma por vez — outros trinta.

Não é caso de "aplicar a mesma quantidade em todos os tamanhos": o pedido real tem
quantidade diferente por tamanho (2 P, 4 M, 4 G, 2 GG). O atalho de grade fechada foi
considerado e **descartado** — resolveria um caso que não é o dele.

## O que muda

Nada do que existe. O toque continua somando 1, o menos continua tirando 1, o quadrado
continua com a mesma aparência. Acrescenta-se **um caminho novo**: segurar o quadrado
abre um campo para escrever o número.

### O gesto

- **Toque curto** no quadrado → soma 1. Idêntico a hoje.
- **Segurar ~500 ms** → o quadrado vira um campo numérico, com o valor atual já
  selecionado, e o teclado do celular abre em modo numérico.
- **Enter ou tocar fora** → aplica. **Esc** → cancela sem aplicar.
- O toque que abriu o campo **não** soma 1. Sem isso, quem segurasse e digitasse 30
  terminaria com 31 — e descobriria só na conferência do pedido.
- Uma linha discreta sob a grade ensina o gesto: *"Toque para somar 1 · segure para
  digitar"*. Gesto sem legenda é gesto que ninguém acha.

### O que o campo aceita

Uma função pura, `quantidadeDigitada(texto)`, decide — e é o único ponto onde isso é
decidido:

- só dígitos contam; qualquer outro caractere é descartado antes de virar número;
- campo vazio, texto sem dígito nenhum ou valor impossível → `0`. Nunca `NaN`, que
  entraria no carrinho e apareceria como "NaN peças" no pedido;
- resultado é inteiro e nunca negativo;
- `0` zera aquele tamanho — é assim que se tira uma linha inteira sem trinta toques no
  menos.

**Sem teto de negócio.** O representante não enxerga estoque (decisão antiga do projeto),
então um limite de peças aqui seria número inventado, travando um pedido que a fábrica
talvez aceitasse.

Existe, isso sim, uma **guarda contra acidente**: o campo para em 99.999. Cinco dígitos
já é mais do que qualquer pedido real, e seis é dedo preso na tecla — sem a guarda, um
`1111111` entra no carrinho e quebra o total do pedido inteiro. Não é o mesmo que um teto
comercial, e por isso não vira aviso na tela.

### Onde o número cai

Na mesma chave que já existe: `produto | cor | tamanho`. Marcar 30 do M na azul, trocar
para a rosa e voltar continua mostrando os 30 — o comportamento de hoje, intocado.

Tamanho esgotado segue desabilitado: não soma no toque e não abre campo.

## Estrutura

O `SeletorTamanho.tsx` já tem 337 linhas e cuida de quatro coisas (cores do catálogo,
cores irmãs, grade e rodapé). A lógica nova — cronômetro do "segurar", estado de edição,
foco e teclas — não entra no meio disso.

- `apps/web/src/lib/quantidade.ts` — a função pura `quantidadeDigitada`. Em `lib/` e não
  dentro do componente porque a suíte roda em ambiente **node**: um teste que importasse
  o `.tsx` arrastaria React junto sem necessidade.
- `apps/web/src/components/comercial/QuadradoDoTamanho.tsx` — um quadrado: o botão de
  hoje **ou** o campo, mais o menos. Todo o comportamento novo mora aqui.
- `SeletorTamanho.tsx` — troca o bloco do quadrado por `<QuadradoDoTamanho />`. O resto
  do arquivo não é tocado.

## Detalhes que mordem no celular

- Segurar no Android abre o menu "copiar/colar" do navegador. `onContextMenu` é
  bloqueado no quadrado, e o CSS desliga seleção de texto e o callout do iOS.
- O cronômetro é cancelado em `pointerup`, `pointerleave` e `pointercancel` — senão
  arrastar a lista com o dedo em cima de um tamanho abriria o campo.
- Uma trava (`ref`) marca que o campo foi aberto por "segurar", para o clique que vem
  em seguida não somar 1 — a corrida entre o cronômetro e o `pointerup` é real.

## Testes

`tests/quantidade-digitada.test.ts`, sobre a função pura: texto vira número, `0` zera,
vazio e lixo viram `0` em vez de `NaN`, negativo e decimal são normalizados, número
grande passa (não há teto).

O **gesto** não dá para testar aqui — a suíte roda em node e o projeto não tem biblioteca
de DOM; instalar uma só para isto seria trocar um problema pequeno por uma dependência
nova. Ele é verificado no navegador, com o back-end dublado.
