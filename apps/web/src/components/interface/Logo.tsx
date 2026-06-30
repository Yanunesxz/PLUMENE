interface LogoProps {
  className?: string;
}

// Monograma "CS" da Corpo Sensual — C em crescente serifado com o S entrelaçado.
// Usa currentColor, então herda a cor do contexto (preto sobre claro por padrão).
export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Corpo Sensual"
    >
      {/* C — arco aberto à direita */}
      <path
        d="M74 24 A33 33 0 1 0 74 76"
        fill="none"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
      {/* S — na abertura do C, do topo à base */}
      <path
        d="M73 33
           C 60 27, 51 36, 58 45
           C 65 54, 78 57, 73 68
           C 69 78, 58 79, 52 73"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
