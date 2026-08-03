/**
 * Regras de nomenclatura das cores do catálogo. Sem efeito colateral — o
 * carregador importa daqui, e os testes também.
 */

/**
 * Nome legível a partir do hex da bolinha.
 *
 * Classifica por MATIZ, não por distância em RGB: a distância euclidiana erra
 * feio em cor saturada — #DA0769 (rosa forte) caía em "vermelho" e #D15D8B em
 * "coral", só porque o canal vermelho pesa nos três.
 */
export function nomeDaCor(hex) {
  if (!hex) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  // Sem croma: é neutro, e só a luminosidade decide.
  if (s < 0.12) {
    if (l < 0.12) return 'preto';
    if (l < 0.35) return 'cinza escuro';
    if (l < 0.7) return 'cinza';
    if (l < 0.92) return 'cinza claro';
    return 'branco';
  }

  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;

  const claro = l > 0.72;
  const escuro = l < 0.3;

  // Vermelho x rosa: o que separa não é o matiz, é a luminosidade. #E0858E é
  // rosa apesar de estar em 354°; só o tom fechado é que vira vermelho.
  if (h < 15 || h >= 345) {
    if (escuro) return 'vinho';
    if (l > 0.62) return 'rosa';
    return s < 0.4 ? 'terracota' : 'vermelho';
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
  if (h < 150) {
    if (s < 0.3) return 'oliva';
    return escuro ? 'verde escuro' : claro ? 'verde claro' : 'verde';
  }
  if (h < 200) return escuro ? 'azul petróleo' : claro ? 'azul claro' : 'turquesa';
  if (h < 255) {
    if (escuro) return 'azul marinho';
    return claro ? 'azul claro' : 'azul';
  }
  if (h < 290) return escuro ? 'roxo escuro' : claro ? 'lilás' : 'roxo';
  return escuro ? 'vinho' : claro ? 'rosa claro' : 'rosa';
}

/**
 * Aplica as regras do catálogo e devolve as cores prontas para o banco:
 *   • uma cor só                  -> "Cor única"
 *   • única bolinha é a VARIADAS  -> "Cores variadas"
 *   • bolinha rotulada na grade   -> "Variadas" (nunca "sortidas")
 *   • sem rótulo no catálogo      -> não inventa Variadas
 */
export function montarCores(coresDoCatalogo) {
  const cores = (coresDoCatalogo ?? []).filter((c) => c.hex || c.variadas);
  if (cores.length === 0) return [];

  const soVariadas = cores.length === 1 && cores[0].variadas;
  const umaCorSo = cores.length === 1 && !cores[0].variadas;

  return cores.map((c, i) => ({
    codigo: c.codigo,
    // A bolinha VARIADAS não guarda hex: a cor dela no papel é só um cinza
    // decorativo, não significa a peça.
    hex: c.variadas ? null : c.hex,
    variadas: Boolean(c.variadas),
    ordem: c.ordem ?? i,
    nome: soVariadas
      ? 'Cores variadas'
      : c.variadas
        ? 'Variadas'
        : umaCorSo
          ? 'Cor única'
          : nomeDaCor(c.hex),
  }));
}
