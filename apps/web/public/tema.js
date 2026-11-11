// Tema escolhido pela pessoa, aplicado antes de a tela aparecer (não pisca).
// Fica fora do index.html para a CSP não precisar liberar script dentro da página
// (padrão SystemDesing, docs/02). Chamado no <head> sem defer e sem type="module".
try { var t = localStorage.getItem("tema"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
