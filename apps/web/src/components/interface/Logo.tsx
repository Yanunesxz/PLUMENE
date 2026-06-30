interface LogoProps {
  className?: string;
}

// Logo oficial da Corpo Sensual (monograma CS). Arquivo em /public/logo.png.
export function Logo({ className }: LogoProps) {
  return <img src="/logo.png" alt="Corpo Sensual" className={className} />;
}
