import { useEffect, useState, type FormEvent } from 'react';
import { UserPlus, Users, X, Mail, IdCard, Tag, Pencil } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Toast } from '../../components/ui/Toast.js';
import type {
  RepListItem,
  PriceTable,
  CreateRepRequest,
  UpdateRepRequest,
  ApiResponse,
} from '@csb/shared';

const EMPTY = {
  name: '',
  email: '',
  cpf: '',
  legal_name: '',
  phone: '',
  price_table_id: '',
  password: '',
  active: true,
};

export function RepsPage() {
  const { token } = useAuthStore();
  const [reps, setReps] = useState<RepListItem[] | null>(null);
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const isEditing = editingId !== null;

  const set =
    (k: keyof typeof EMPTY) =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!token) return;
    void api.get<ApiResponse<RepListItem[]>>('/reps', token).then((r) => setReps(r.data)).catch(() => setReps([]));
    void api.get<ApiResponse<PriceTable[]>>('/price-tables', token).then((r) => setTables(r.data)).catch(() => {});
  }, [token]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY });
    setError('');
  };

  const startCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY });
    setError('');
    setShowForm(true);
  };

  const startEdit = (rep: RepListItem) => {
    setEditingId(rep.id);
    setForm({
      name: rep.name,
      email: rep.email,
      cpf: rep.cpf ?? '',
      legal_name: rep.legal_name ?? '',
      phone: rep.phone ?? '',
      price_table_id: rep.price_table_id ?? '',
      password: '',
      active: rep.active,
    });
    setError('');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.email || !form.cpf || !form.price_table_id) {
      setError('Preencha nome, e-mail, CPF e tabela.');
      return;
    }
    if (!isEditing && !form.password) {
      setError('Defina uma senha inicial.');
      return;
    }
    if (!token) return;
    setSubmitting(true);
    try {
      if (isEditing) {
        const payload: UpdateRepRequest = {
          name: form.name,
          email: form.email,
          cpf: form.cpf,
          price_table_id: form.price_table_id,
          legal_name: form.legal_name || null,
          phone: form.phone || null,
          active: form.active,
          ...(form.password ? { password: form.password } : {}),
        };
        const res = await api.patch<ApiResponse<RepListItem>>(`/reps/${editingId}`, payload, token);
        setReps((prev) => (prev ?? []).map((r) => (r.id === editingId ? res.data : r)));
        setToast({ message: 'Representante atualizado!', type: 'success' });
      } else {
        const payload: CreateRepRequest = {
          name: form.name,
          email: form.email,
          cpf: form.cpf,
          price_table_id: form.price_table_id,
          password: form.password,
          legal_name: form.legal_name || null,
          phone: form.phone || null,
        };
        const res = await api.post<ApiResponse<RepListItem>>('/reps', payload, token);
        setReps((prev) =>
          [res.data, ...(prev ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        );
        setToast({ message: 'Representante cadastrado!', type: 'success' });
      }
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar representante.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Representantes</h1>
          {reps && <p className="text-sm text-muted-foreground">{reps.length} cadastrados</p>}
        </div>
        <Button size="md" onClick={() => (showForm ? closeForm() : startCreate())}>
          {showForm ? <X className="h-4 w-4" strokeWidth={2.5} /> : <UserPlus className="h-4 w-4" strokeWidth={2.5} />}
          {showForm ? 'Cancelar' : 'Novo representante'}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5"
        >
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            {isEditing ? 'Editar representante' : 'Novo representante'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required>
              <Input value={form.name} onChange={set('name')} placeholder="Nome do representante" />
            </Field>
            <Field label="E-mail" required>
              <Input type="email" value={form.email} onChange={set('email')} placeholder="rep@email.com" autoComplete="off" />
            </Field>
            <Field label="CPF" required>
              <Input value={form.cpf} onChange={set('cpf')} placeholder="000.000.000-00" inputMode="numeric" />
            </Field>
            <Field label="Razão social">
              <Input value={form.legal_name} onChange={set('legal_name')} placeholder="Opcional" />
            </Field>
            <Field label="Telefone / WhatsApp">
              <Input value={form.phone} onChange={set('phone')} placeholder="Opcional" inputMode="tel" />
            </Field>
            <Field label="Tabela de preço" required>
              <Select value={form.price_table_id} onChange={set('price_table_id')}>
                <option value="">Selecione a tabela</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={isEditing ? 'Nova senha' : 'Senha inicial'} required={!isEditing}>
              <Input
                type="password"
                value={form.password}
                onChange={set('password')}
                placeholder={isEditing ? 'Deixe em branco para manter' : 'Defina a senha de acesso'}
                autoComplete="new-password"
              />
            </Field>
            {isEditing && (
              <Field label="Status">
                <label className="flex h-10 items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    className="h-4 w-4 rounded border-input text-brand-600 focus:ring-brand-500"
                  />
                  Representante ativo
                </label>
              </Field>
            )}
          </div>

          {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner />
                  Salvando…
                </>
              ) : isEditing ? (
                'Salvar alterações'
              ) : (
                'Cadastrar representante'
              )}
            </Button>
          </div>
        </form>
      )}

      {reps === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : reps.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Nenhum representante cadastrado</p>
            <p className="text-sm text-muted-foreground">Toque em “Novo representante” para começar.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {reps.map((rep) => (
            <div key={rep.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                    {rep.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{rep.name}</p>
                    {rep.legal_name && <p className="truncate text-xs text-muted-foreground">{rep.legal_name}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!rep.active && <Badge variant="gray">Inativo</Badge>}
                  <button
                    type="button"
                    onClick={() => startEdit(rep)}
                    aria-label={`Editar ${rep.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{rep.email}</span>
                </p>
                {rep.cpf && (
                  <p className="flex items-center gap-1.5">
                    <IdCard className="h-3.5 w-3.5 shrink-0" /> {rep.cpf}
                  </p>
                )}
                <p className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 shrink-0" />
                  {rep.price_table_name ? (
                    <Badge variant="green">{rep.price_table_name}</Badge>
                  ) : (
                    <span className="italic">Sem tabela</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
