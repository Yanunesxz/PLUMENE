// Script da página /api-parceiro. Fica fora do HTML para a CSP não liberar
// script dentro da página (padrão SystemDesing, docs/06).
// ── Troca de linguagem nos exemplos ──────────────────
const tabs = document.querySelectorAll(".lang");
const panels = document.querySelectorAll(".panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    const alvo = tab.dataset.l;
    panels.forEach((p) => { p.hidden = p.dataset.p !== alvo; });
  });
});

// ── Copiar bloco de código ───────────────────────────
document.querySelectorAll(".copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const texto = btn.closest(".code").querySelector("code").innerText;
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    btn.textContent = "copiado";
    btn.classList.add("done");
    setTimeout(() => {
      btn.textContent = "copiar";
      btn.classList.remove("done");
    }, 1600);
  });
});

// ── Marca a seção atual no índice ────────────────────
const links = new Map(
  [...document.querySelectorAll(".toc a")].map((a) => [a.getAttribute("href").slice(1), a]),
);
const obs = new IntersectionObserver(
  (entradas) => {
    entradas.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.remove("on"));
      links.get(e.target.id)?.classList.add("on");
    });
  },
  { rootMargin: "-10% 0px -75% 0px" },
);
document.querySelectorAll("section[id], h3[id]").forEach((s) => obs.observe(s));
