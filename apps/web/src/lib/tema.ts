import { useSyncExternalStore } from 'react';

/**
 * TEMA claro / escuro — Padrão Yan Nunes v0.2.0 (seção "Tema claro e escuro").
 *
 * Começa igual ao aparelho (sem `data-theme` no <html>, o CSS segue o
 * `prefers-color-scheme`). A pessoa pode fixar Claro ou Escuro; a escolha fica
 * no localStorage com a chave "tema" e é aplicada pelo script de uma linha do
 * index.html ANTES de a tela aparecer — por isso não pisca ao abrir.
 */
export type EscolhaDeTema = '' | 'light' | 'dark';

const CHAVE = 'tema';
const ouvintes = new Set<() => void>();

function lerEscolha(): EscolhaDeTema {
  try {
    const t = localStorage.getItem(CHAVE);
    return t === 'light' || t === 'dark' ? t : '';
  } catch {
    return '';
  }
}

const midiaEscura = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** O tema que está NA TELA agora: a escolha fixa, ou o do aparelho. */
export function temaEfetivo(escolha: EscolhaDeTema = lerEscolha()): 'light' | 'dark' {
  if (escolha) return escolha;
  return midiaEscura?.matches ? 'dark' : 'light';
}

function aplicar(escolha: EscolhaDeTema): void {
  const raiz = document.documentElement;
  if (escolha) raiz.dataset.theme = escolha;
  else delete raiz.dataset.theme;
  // A barra do navegador e a do app instalado acompanham o fundo da página.
  const cor = temaEfetivo(escolha) === 'dark' ? '#000000' : '#FFFFFF';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', cor));
}

export function definirTema(escolha: EscolhaDeTema): void {
  try {
    if (escolha) localStorage.setItem(CHAVE, escolha);
    else localStorage.removeItem(CHAVE);
  } catch {
    /* aba anônima ou armazenamento cheio: vale só nesta sessão */
  }
  aplicar(escolha);
  ouvintes.forEach((o) => o());
}

/** Lua/sol da barra do topo: troca entre claro e escuro a partir do que está na tela. */
export function alternarTema(): void {
  definirTema(temaEfetivo() === 'dark' ? 'light' : 'dark');
}

midiaEscura?.addEventListener('change', () => {
  if (!lerEscolha()) {
    aplicar('');
    ouvintes.forEach((o) => o());
  }
});

function inscrever(o: () => void): () => void {
  ouvintes.add(o);
  return () => ouvintes.delete(o);
}

/** A escolha guardada ('' = Aparelho), sempre em dia com a tela. */
export function useEscolhaDeTema(): EscolhaDeTema {
  return useSyncExternalStore(inscrever, lerEscolha, () => '');
}

/** Acerta a cor da barra do navegador no arranque. */
export function iniciarTema(): void {
  aplicar(lerEscolha());
}
