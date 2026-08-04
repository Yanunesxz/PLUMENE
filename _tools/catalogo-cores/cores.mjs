/**
 * Regras de nomenclatura das cores do catálogo. Sem efeito colateral — o
 * carregador importa daqui, e os testes também.
 */

/** HSL em 0..1 (matiz em graus), que é como as faixas abaixo raciocinam. */
function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Só a luminosidade, para ordenar tons da mesma família. */
export function luminosidade(hex) {
  return hex ? hsl(hex).l : 0;
}

/**
 * Nome legível a partir do hex da bolinha.
 *
 * Classifica por MATIZ, não por distância em RGB: a distância euclidiana erra
 * feio em cor saturada — #DA0769 (rosa forte) caía em "vermelho" e #D15D8B em
 * "coral", só porque o canal vermelho pesa nos três.
 */
export function nomeDaCor(hex) {
  if (!hex) return null;
  const { h, s, l } = hsl(hex);

  // Sem croma: é neutro, e só a luminosidade decide. O corte é generoso porque
  // o mescla dos moletons tem um resto de matiz — #B59E9E é cinza quente, e a
  // 0,12 ele saía "rosa".
  if (s < 0.16) {
    if (l < 0.12) return 'preto';
    // O cáqui e o sage dos moletons têm croma quase nenhum, mas ninguém chama
    // nenhum dos dois de cinza. #847F67 é oliva; #A1B2A7 é verde acinzentado.
    if (h >= 40 && h < 180 && s >= 0.08 && l >= 0.3 && l < 0.8) {
      return h < 70 ? 'oliva' : 'verde acinzentado';
    }
    if (l < 0.35) return 'cinza escuro';
    if (l < 0.7) return 'cinza';
    if (l < 0.92) return 'cinza claro';
    return 'branco';
  }

  const claro = l > 0.72;
  const escuro = l < 0.3;

  // Vermelho x rosa: o que separa não é o matiz, é a luminosidade. #E0858E é
  // rosa apesar de estar em 354°; só o tom fechado é que vira vermelho.
  if (h < 15 || h >= 345) {
    if (escuro) return 'vinho';
    // Rosa x salmão: o que separa é o matiz puxar para o laranja. #E0858E (354°)
    // é rosa; #E28370 (10°), na mesma luminosidade, é salmão.
    if (l > 0.62) return h >= 8 && h < 15 && s > 0.35 ? 'salmão' : 'rosa';
    // Faixa fechada e pouco saturada é vinho/rosê, não vermelho: o #B04A64 do
    // 1400 saía "vermelho" ao lado de um rosa de verdade.
    if (s < 0.35) return 'rosê';
    if (s < 0.6 && l < 0.55) return 'vinho';
    return 'vermelho';
  }
  // Laranja é a faixa do marrom, caramelo, nude e bege — a mais povoada do
  // catálogo de pijama. Marrom vai até bem mais claro que o "escuro" genérico.
  if (h < 40) {
    if (l < 0.45) return 'marrom';
    if (s < 0.45) return l > 0.78 ? 'bege' : 'nude';
    return claro ? 'salmão' : 'caramelo';
  }
  // Amarelo dessaturado não é amarelo, é oliva/cáqui — o verde-acinzentado dos
  // moletons. Sem esta regra, #847F67 saía "amarelo".
  if (h < 70) {
    if (s < 0.35) return escuro ? 'oliva escuro' : 'oliva';
    return escuro ? 'oliva' : claro ? 'amarelo claro' : 'amarelo';
  }
  // Verde é verde: só o amarelado (faixa acima) vira oliva. Sem isto o verde
  // fechado e pouco saturado saía "oliva" ao lado de um cáqui de verdade.
  if (h < 150) {
    if (escuro) return 'verde escuro';
    if (claro) return 'verde claro';
    return s < 0.25 ? 'verde acinzentado' : 'verde';
  }
  // O corte para 'claro' aqui é mais baixo que o geral: #9BC0D2 já é céu, não turquesa.
  if (h < 200) return escuro ? 'azul petróleo' : l > 0.68 ? 'azul claro' : 'turquesa';
  if (h < 228) {
    if (escuro) return 'azul marinho';
    return claro ? 'azul claro' : 'azul';
  }
  // Azul puxando para o violeta (o periwinkle dos listrados) precisa de nome
  // próprio: senão ele e o azul de verdade viram "azul" no mesmo produto.
  if (h < 262) {
    if (escuro) return 'azul marinho';
    return s < 0.25 ? 'azul acinzentado' : claro ? 'lilás' : 'azul violeta';
  }
  if (h < 290) return escuro ? 'roxo escuro' : claro ? 'lilás' : 'roxo';
  if (h < 325) return escuro ? 'roxo escuro' : claro ? 'lilás' : 'orquídea';
  return escuro ? 'vinho' : claro ? 'rosa claro' : 'pink';
}

/** Nome de uma opção do catálogo (que pode ter duas bolinhas). */
function nomeDaOpcao(c, completo) {
  const frente = c.hex;
  const atras = c.hex_par;
  if (!atras) return nomeDaCor(frente);
  // Numa opção com estampa, a bolinha de TRÁS é o liso da peça: é ela que
  // batiza. A média de uma estampa dá um tom sujo que não descreve nada — o
  // listrado do 0800 saía "cinza" no lugar de "rosa".
  const principal = c.estampa ? atras : frente;
  if (!completo) return nomeDaCor(principal);
  const outro = principal === frente ? atras : frente;
  const a = nomeDaCor(principal);
  const b = nomeDaCor(outro);
  return a === b ? a : `${a} e ${b}`;
}

/**
 * Garante que dois nomes não se repitam DENTRO do mesmo produto. Isso não é
 * capricho: a observação do pedido leva só o nome, sem o número da bolinha, e
 * "0760 3M rosa" duas vezes não diz à fábrica qual peça separar.
 */
function desempatar(cores) {
  const nomes = cores.map((c) => c.nome);
  const repetido = (lista) => lista.some((n, i) => lista.indexOf(n) !== i);
  if (!repetido(nomes)) return nomes;

  // 1ª tentativa: abrir o nome das duas bolinhas ("rosa claro e turquesa"). É o
  // que resolve o caso em que as opções só diferem na bolinha de trás.
  const conta = new Map();
  nomes.forEach((n) => conta.set(n, (conta.get(n) ?? 0) + 1));
  nomes.forEach((n, i) => {
    if (conta.get(n) > 1 && cores[i].origem?.hex_par) {
      nomes[i] = nomeDaOpcao(cores[i].origem, true);
    }
  });
  if (!repetido(nomes)) return nomes;

  // 2ª tentativa: ordenar a FAMÍLIA inteira por tom. Entram no bolo os nomes
  // que já são daquela família ("cinza claro" entra com os dois "cinza"), senão
  // o desempate criaria um segundo "cinza claro".
  const LADEIRA = {
    2: ['escuro', 'claro'],
    3: ['escuro', 'médio', 'claro'],
    4: ['bem escuro', 'escuro', 'claro', 'bem claro'],
    5: ['bem escuro', 'escuro', 'médio', 'claro', 'bem claro'],
  };
  for (const familia of new Set(nomes.filter((n, i) => nomes.indexOf(n) !== i))) {
    const grupo = nomes
      .map((n, i) => (n === familia || n.startsWith(`${familia} `) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => luminosidade(cores[a].hex) - luminosidade(cores[b].hex));
    const degraus = LADEIRA[grupo.length];
    if (!degraus) continue;
    grupo.forEach((idx, k) => {
      nomes[idx] = `${familia} ${degraus[k]}`;
    });
  }
  return nomes;
}

/**
 * Aplica as regras do catálogo e devolve as cores prontas para o banco:
 *   • uma cor só                  -> "Cor única"
 *   • única bolinha é a VARIADAS  -> "Cores variadas"
 *   • bolinha rotulada na grade   -> "Variadas" (nunca "sortidas")
 *   • sem rótulo no catálogo      -> não inventa Variadas
 */
export function montarCores(coresDoCatalogo) {
  const cores = (coresDoCatalogo ?? []).filter((c) => c.hex || c.badge);
  if (cores.length === 0) return [];

  const reais = cores.filter((c) => !c.badge);
  const soVariadas = cores.length === 1 && cores[0].badge;
  const umaCorSo = reais.length === 1;

  const prontas = cores.map((c, i) => ({
    codigo: c.codigo,
    // A bolinha-selo não guarda hex: o cinza dela no papel é decorativo.
    // `hex` é sempre a bolinha que DÁ NOME à cor — assim a bolinha da tela e o
    // nome escrito na observação nunca discordam.
    ...(c.badge
      ? { hex: null, hex_par: null }
      : c.estampa && c.hex_par
        ? { hex: c.hex_par, hex_par: c.hex }
        : { hex: c.hex, hex_par: c.hex_par ?? null }),
    estampa: Boolean(!c.badge && (c.estampa || c.estampa_par)),
    variadas: c.selo === 'variadas',
    ordem: c.ordem ?? i,
    origem: c,
    nome: c.badge
      ? soVariadas
        ? 'Cores variadas'
        : c.selo === 'unica'
          ? 'Cor única'
          : 'Variadas'
      : umaCorSo
        ? 'Cor única'
        : nomeDaOpcao(c, false),
  }));

  const nomes = desempatar(prontas);
  return prontas.map(({ origem, ...c }, i) => ({ ...c, nome: nomes[i] }));
}
