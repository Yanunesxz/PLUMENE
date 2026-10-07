import { Link } from 'react-router-dom';
import { CartaoLimparCache } from '../../components/interface/CartaoLimparCache.js';

/**
 * /limpar-cache — fora do login de propósito: é o endereço que se manda no
 * WhatsApp para o aparelho que travou, inclusive o que nem chega a abrir a
 * Minha Área. Dentro do app, o mesmo cartão está na Minha Área.
 */
export function PaginaLimparCache() {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto grid max-w-lg gap-4">
        <h1 className="titulo text-[26px] leading-none text-foreground">Limpar cache</h1>
        <CartaoLimparCache />
        <Link to="/" className="text-center text-sm text-muted-foreground underline underline-offset-2">
          Voltar para o app
        </Link>
      </div>
    </div>
  );
}
