import { Mail, Pencil, Trash2, Lock, LockOpen, ArrowRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/interface/Badge.js';
import { descreverUltimoAcesso } from '../../lib/ultimoAcesso.js';
import { PERMISSAO_LABELS, TODAS_PERMISSOES, temPermissao } from '@csb/shared';
import type { UsuarioListItem } from '@csb/shared';

interface Props {
  usuario: UsuarioListItem;
  /** O login de quem está mexendo — não ganha botão de bloquear nem de excluir. */
  ehVoce: boolean;
  ocupado: boolean;
  onEditar: () => void;
  onAlternarAtivo: () => void;
  onExcluir: () => void;
}

export function CartaoDeLogin({
  usuario,
  ehVoce,
  ocupado,
  onEditar,
  onAlternarAtivo,
  onExcluir,
}: Props) {
  const ehGerente = usuario.role === 'manager';
  const teclasLigadas = TODAS_PERMISSOES.filter((t) =>
    temPermissao('manager', usuario.permissions, t),
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-soft-foreground">
            {usuario.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {usuario.name}
              {ehVoce && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>
              )}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{usuario.email}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!usuario.active && <Badge variant="gray">Bloqueado</Badge>}
          <button
            type="button"
            onClick={onEditar}
            aria-label={`Editar ${usuario.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!ehVoce && (
            <>
              <button
                type="button"
                onClick={onAlternarAtivo}
                disabled={ocupado}
                aria-label={
                  usuario.active ? `Bloquear ${usuario.name}` : `Desbloquear ${usuario.name}`
                }
                title={usuario.active ? 'Bloquear acesso' : 'Desbloquear acesso'}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                {usuario.active ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onExcluir}
                disabled={ocupado}
                aria-label={`Excluir ${usuario.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        Último acesso: {descreverUltimoAcesso(usuario.last_login_at)}
      </p>

      {/* As teclas ficam à vista no cartão: saber o que um gerente pode fazer não
          deveria exigir abrir o formulário dele. */}
      {ehGerente && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {teclasLigadas.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">
              Sem permissões — entra e só consulta.
            </span>
          ) : (
            teclasLigadas.map((t) => (
              <Badge key={t} variant="green">
                {PERMISSAO_LABELS[t].titulo}
              </Badge>
            ))
          )}
        </div>
      )}

      {usuario.role === 'rep' && (
        <Link
          to="/representantes"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Cadastro completo (tabela, comissão, meta)
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
