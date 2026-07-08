import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { UserPlus, Users, X, Mail, IdCard, Tag, Pencil, Trash2, Percent, Search } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Select } from '../../components/interface/Select.js';
import { Button } from '../../components/interface/Button.js';
import { Badge } from '../../components/interface/Badge.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { Toast } from '../../components/interface/Toast.js';
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
  commission_rate: '10',
  active: true,
};

export function PaginaRepresentantes() {
  const { token } = useAuthStore();
  const [reps, setReps] = useState<RepListItem[] | null>(null);
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [repSearch, setRepSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isEditing = editingId !== null;

  const filteredReps = useMemo(() => {
    const q = repSearch.trim().toLowerCase();
    const list = reps ?? [];
    if (!q) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.cpf ?? '').includes(q),
    );
  }, [reps, repSearch]);

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
      commission_rate: String(rep.commission_rate ?? 10),
      active: rep.active,
    });
    setError('');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (rep: RepListItem) => {
    if (!token || deletingId) return;
    const ok = window.confirm(
      `Excluir o representante "${rep.name}"?\n\n` +
        'Esta ação não pode ser desfeita. Clientes da carteira dele ficarão sem representante.',
    );
    if (!ok) return;

    setDeletingId(rep.id);
    try {
      const res = await api.del<ApiResponse<{ ok: boolean; unassigned_customers: number }>>(
        `/reps/${rep.id}`,
        token,
      );
      setReps((prev) => (prev ?? []).filter((r) => r.id !== rep.id));
      if (editingId === rep.id) closeForm();
      const n = res.data.unassigned_customers;
      setToast({
        message:
          n > 0
            ? `Representante excluído. ${n} cliente(s) da carteira ficaram sem representante.`
            : 'Representante excluído.',
        type: 'success',
      });
    } catch (err) {
      // Rep com pedidos não pode ser apagado (histórico de comissões) — oferece inativar.
      if ((err as Error & { code?: string }).code === 'HAS_ORDERS') {
        const inativar = window.confirm(
          `${err instanceof Error ? err.message : 'Este representante tem pedidos e não pode ser excluído.'}\n\n` +
            'Deseja INATIVAR o acesso dele agora? (Ele não conseguirá mais entrar no app, mas o histórico é preservado.)',
        );
        if (inativar) {
          try {
            const res = await api.patch<ApiResponse<RepListItem>>(`/reps/${rep.id}`, { active: false }, token);
            setReps((prev) => (prev ?? []).map((r) => (r.id === rep.id ? res.data : r)));
            setToast({ message: 'Representante inativado — o acesso foi bloqueado.', type: 'success' });
          } catch (e2) {
            setToast({ message: e2 instanceof Error ? e2.message : 'Erro ao inativar.', type: 'error' });
          }
        }
      } else {
        setToast({ message: err instanceof Error ? err.message : 'Erro ao excluir representante.', type: 'error' });
      }
    } finally {
      setDeletingId(null);
    }
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
          commission_rate: Number(form.commission_rate) || 10,
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
          commission_rate: Number(form.commission_rate) || 10,
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
            <Field label="Comissão (%)" required>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.commission_rate}
                onChange={set('commission_rate')}
                placeholder="10"
                inputMode="decimal"
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
        <>
          {reps.length > 3 && (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                inputMode="search"
                placeholder="Buscar representante por nome, e-mail ou CPF…"
                value={repSearch}
                onChange={(e) => setRepSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          {filteredReps.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum representante encontrado.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredReps.map((rep) => (
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
                  <button
                    type="button"
                    onClick={() => void handleDelete(rep)}
                    disabled={deletingId === rep.id}
                    aria-label={`Excluir ${rep.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
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
                <p className="flex items-center gap-1.5">
                  <Percent className="h-3.5 w-3.5 shrink-0" /> Comissão: {rep.commission_rate}%
                </p>
                </div>
              </div>
            ))}
            </div>
          )}
        </>
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
