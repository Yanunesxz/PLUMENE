import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../../components/interface/EmptyState.js';
import { buttonVariants } from '../../components/interface/Button.js';
import { cn } from '../../lib/utils.js';

export function PaginaNaoEncontrada() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <EmptyState
        icon={Compass}
        title="Página não encontrada"
        description="O endereço que você tentou abrir não existe ou foi movido."
        action={
          <Link to="/" className={cn(buttonVariants())}>
            Ir para o início
          </Link>
        }
      />
    </div>
  );
}
