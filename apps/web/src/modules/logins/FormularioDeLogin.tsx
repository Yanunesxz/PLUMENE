import { useState, type FormEvent, type ReactNode } from 'react';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import {
  PERMISSAO_LABELS,
  TODAS_PERMISSOES,
  PERMISSOES_PADRAO_GERENTE,
  USER_ROLE_LABELS,
  temPermissao,
} from '@csb/shared';
import type { UsuarioListItem, PapelGerenciavel, PermissaoGerente } from '@csb/shared';
import { cn } from '../../lib/utils.js';

export interface DadosDoFormulario {
  name: string;
  email: string;
  password: string;
  role: PapelGerenciavel;
  permissions: PermissaoGerente[];
}

interface Props {
  /** Nulo = criando um login novo. */
  editando: UsuarioListItem | null;
  salvando: boolean;
  erro: string;
  onSalvar: (dados: DadosDoFormulario) => void;
  onCancelar: () => void;
}

export function FormularioDeLogin({ editando, salvando, erro, onSalvar, onCancelar }: Props) {
  // Papel que não se cria por aqui (rep, loja) fica travado: o formulário edita
  // nome, e-mail e senha desses logins, mas não os transforma em gerente.
  const papelFixo =
    editando !== null &&
    editando.role !== 'admin' &&
    editando.role !== 'manager' &&
    editando.role !== 'financeiro' &&
    editando.role !== 'relacionamento';

  const [form, setForm] = useState<DadosDoFormulario>({
    name: editando?.name ?? '',
    email: editando?.email ?? '',
    password: '',
    role:
      editando?.role === 'admin' || editando?.role === 'financeiro' || editando?.role === 'relacionamento'
        ? editando.role
        : 'manager',
    permissions: editando
      ? TODAS_PERMISSOES.filter((t) => temPermissao('manager', editando.permissions, t))
      : [...PERMISSOES_PADRAO_GERENTE],
  });

  const set = (k: 'name' | 'email' | 'password') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const alternarTecla = (t: PermissaoGerente) =>
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(t)
        ? f.permissions.filter((x) => x !== t)
        : [...f.permissions, t],
    }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onSalvar(form);
  };

  return (
    <form
      onSubmit={enviar}
      className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5"
    >
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        {editando
          ? `Editar ${USER_ROLE_LABELS[editando.role].toLowerCase()}: ${editando.name}`
          : 'Novo login'}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Nome" obrigatorio>
          <Input value={form.name} onChange={set('name')} placeholder="Nome de quem vai usar" />
        </Campo>
        <Campo label="E-mail" obrigatorio>
          <Input
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="pessoa@empresa.com"
            autoComplete="off"
          />
        </Campo>

        {!papelFixo && (
          <Campo label="Papel" obrigatorio>
            <div className="flex gap-2">
              {(['manager', 'financeiro', 'relacionamento', 'admin'] as const).map((papel) => (
                <button
                  key={papel}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role: papel }))}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    form.role === papel
                      ? 'border-foreground bg-primary-soft text-primary-soft-foreground'
                      : 'border-input text-muted-foreground hover:bg-muted',
                  )}
                >
                  {USER_ROLE_LABELS[papel]}
                </button>
              ))}
            </div>
          </Campo>
        )}

        <Campo label={editando ? 'Nova senha' : 'Senha inicial'} obrigatorio={!editando}>
          <Input
            type="password"
            value={form.password}
            onChange={set('password')}
            placeholder={editando ? 'Deixe em branco para manter' : 'Defina a senha de acesso'}
            autoComplete="new-password"
          />
        </Campo>
      </div>

      {/* Teclas só aparecem para gerente: o admin tem tudo por definição, e
          mostrar caixinhas marcadas e travadas só faria alguém tentar desmarcar. */}
      {form.role === 'manager' && !papelFixo && (
        <div className="mt-4 space-y-1.5">
          <label className="text-sm font-medium text-foreground">
            O que este gerente pode fazer
          </label>
          <p className="text-xs text-muted-foreground">
            Desmarcado, o botão some da tela dele e a API recusa a ação. Mudanças valem em até 1
            hora.
          </p>
          <div className="mt-1 divide-y divide-border overflow-hidden rounded-lg border border-input">
            {TODAS_PERMISSOES.map((t) => {
              const marcada = form.permissions.includes(t);
              return (
                <div
                  key={t}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5 transition-colors',
                    marcada ? 'bg-muted/50' : 'bg-card',
                  )}
                >
                  <input
                    type="checkbox"
                    id={`tecla-${t}`}
                    checked={marcada}
                    onChange={() => alternarTecla(t)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
                  />
                  <label htmlFor={`tecla-${t}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block text-sm text-foreground">{PERMISSAO_LABELS[t].titulo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {PERMISSAO_LABELS[t].descricao}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
          {form.permissions.length === 0 && (
            <p className="text-xs text-warn-soft-foreground">
              Sem nenhuma permissão, este gerente entra e só consulta.
            </p>
          )}
        </div>
      )}

      {erro && (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
          {erro}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando}>
          {salvando ? (
            <>
              <Spinner />
              Salvando…
            </>
          ) : editando ? (
            'Salvar alterações'
          ) : (
            'Criar login'
          )}
        </Button>
      </div>
    </form>
  );
}

function Campo({
  label,
  obrigatorio,
  children,
}: {
  label: string;
  obrigatorio?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {obrigatorio && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
