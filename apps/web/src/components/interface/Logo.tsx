interface LogoProps {
  className?: string;
}

// Monograma "CS" da Corpo Sensual — C crescente serifado (afilado nas pontas)
// com o S caligráfico: bolinha no topo, entrada fina e corpo encorpado.
// Usa currentColor, herdando a cor do contexto (preto sobre claro por padrão).
export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Corpo Sensual"
      fill="currentColor"
    >
      {/* C — crescente afilado, aberto à direita */}
      <path d="M70 22.3 A38 38 0 1 0 70 77.7 A32 32 0 1 1 70 22.3 Z" />

      {/* S — corpo encorpado, terminando em gota à direita */}
      <path
        d="M72 37 C 79 49, 57 52, 57 59 C 57 68, 76 68, 72 77 C 70 82, 65 82, 64 80"
        fill="none"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* S — bolinha do topo */}
      <circle cx="72" cy="31" r="7" />
      {/* S — entrada fina até a boca do C */}
      <path
        d="M66 31 C 58 31, 50 33, 46 39"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
