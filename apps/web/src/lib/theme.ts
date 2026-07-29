/**
 * Tema claro/escuro. Três estados: 'system' (padrão), 'light', 'dark'.
 *
 * O CSS já resolve 'system' sozinho via `prefers-color-scheme`; o que gravamos
 * em `data-theme` é só a escolha MANUAL, que ganha das duas. Por isso 'system'
 * remove o atributo em vez de escrever um valor.
 */
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'csb-theme';

export function getTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    localStorage.removeItem(KEY);
  } else {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }
  // Mantém a barra do navegador (Android/iOS) na cor do app.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark(theme) ? '#181614' : '#f7f5f3');
}

export function isDark(theme: Theme): boolean {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches;
  return theme === 'dark';
}

/** Ciclo do botão: sistema → claro → escuro → sistema. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
}

/** Aplica o tema salvo antes do primeiro render (evita piscar branco). */
export function initTheme(): void {
  applyTheme(getTheme());
}
