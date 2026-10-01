import { MARCA } from '../../lib/marca.js';

interface LogoProps {
  className?: string;
}

// Logo da marca desta instalação. Arquivo em /public/logo.png — cada fork de
// marca troca o arquivo, o código não muda. O PNG tem fundo branco;
// mix-blend-multiply faz esse branco sumir sobre fundos claros (login, topbar,
// sidebar), mantendo só o traço. No tema escuro (globals.css, .logo-marca) a
// imagem é invertida e mesclada com screen: o fundo some e o traço fica claro.
export function Logo({ className }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt={MARCA.nome}
      className={`logo-marca${className ? ` ${className}` : ''}`}
    />
  );
}
