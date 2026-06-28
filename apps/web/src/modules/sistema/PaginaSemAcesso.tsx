import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '../../components/interface/EmptyState.js';
import { buttonVariants } from '../../components/interface/Button.js';
import { cn } from '../../lib/utils.js';

export function PaginaSemAcesso() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="Você não tem permissão para acessar esta área. Fale com um gerente se precisar de acesso."
        action={
          <Link to="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            Voltar ao início
          </Link>
        }
      />
    </div>
  );
}
