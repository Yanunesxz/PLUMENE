interface LogoProps {
  className?: string;
}

// Logo oficial da Corpo Sensual (monograma CS). Arquivo em /public/logo.png.
// O PNG tem fundo branco; mix-blend-multiply faz esse branco sumir sobre
// fundos claros (login, topbar, sidebar), mantendo só o traço preto.
export function Logo({ className }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt="Corpo Sensual"
      className={`mix-blend-multiply${className ? ` ${className}` : ''}`}
    />
  );
}
