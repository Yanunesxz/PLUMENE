import { useState, useEffect, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Search, Users, ChevronRight, Building2, MessageCircle, UserPlus, X } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/interface/Badge.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { Toast } from '../../components/interface/Toast.js';
import { cn, formatBRL } from '../../lib/utils.js';
import type { CustomerListItem, CreateCustomerRequest, ApiResponse } from '@csb/shared';

const EMPTY_CUST = { name: '', cnpj: '', trade_name: '', whatsapp: '', email: '', address: '' };

export function PaginaClientes() {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_CUST });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const setF = (k: keyof typeof EMPTY_CUST) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const customers = useLiveQuery(
    () =>
      search
        ? db.customers
            .filter(
              (c) =>
                c.name.toLowerCase().includes(search.toLowerCase()) ||
                (c.cnpj ?? '').includes(search),
            )
            .toArray()
        : db.customers.orderBy('name').toArray(),
    [search],
  );

  useEffect(() => {
    if (!token) return;
    api
      .getLista<ApiResponse<CustomerListItem[]>>('/customers', token)
      .then((res) => db.customers.bulkPut(res.data))
      .catch(() => {
        /* offline: usamos o cache */
      });
  }, [token]);

  const handleSelect = (customer: { id: string; blocked: boolean }) => {
    if (customer.blocked) return;
    void navigate(`/orders/new?customer_id=${customer.id}`);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const digitos = (v: string) => v.replace(/\D/g, '');
    if (!form.name.trim()) {
      setError('Informe o nome / razão social do cliente.');
      return;
    }
    const cnpjLen = digitos(form.cnpj).length;
    if (cnpjLen === 0) {
      setError('Informe o CNPJ ou CPF do cliente.');
      return;
    }
    if (cnpjLen !== 11 && cnpjLen !== 14) {
      setError('CNPJ deve ter 14 dígitos (ou CPF com 11).');
      return;
    }
    const zapLen = digitos(form.whatsapp).length;
    if (zapLen < 10 || zapLen > 11) {
      setError('Informe o WhatsApp com DDD (10 ou 11 dígitos).');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      setError('Informe um e-mail válido.');
      return;
    }
    if (form.address.trim().length < 5) {
      setError('Informe o endereço do cliente.');
      return;
    }
    if (!token) return;
    setSaving(true);
    try {
      const payload: CreateCustomerRequest = {
        name: form.name,
        trade_name: form.trade_name || null,
        cnpj: form.cnpj || null,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        address: form.address || null,
      };
      const res = await api.post<ApiResponse<CustomerListItem>>('/customers', payload, token);
      await db.customers.put(res.data);
      setForm({ ...EMPTY_CUST });
      setShowForm(false);
      setToast({ message: 'Cliente cadastrado!', type: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Clientes</h1>
        <Button size="md" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X className="h-4 w-4" strokeWidth={2.5} /> : <UserPlus className="h-4 w-4" strokeWidth={2.5} />}
          {showForm ? 'Cancelar' : 'Novo cliente'}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5"
        >
          <h2 className="mb-4 text-sm font-semibold text-foreground">Novo cliente</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-foreground">
                Nome / Razão social <span className="text-danger">*</span>
              </label>
              <Input value={form.name} onChange={setF('name')} placeholder="Nome do cliente" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Nome fantasia</label>
              <Input value={form.trade_name} onChange={setF('trade_name')} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                CNPJ / CPF <span className="text-danger">*</span>
              </label>
              <Input value={form.cnpj} onChange={setF('cnpj')} placeholder="00.000.000/0000-00" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                WhatsApp <span className="text-danger">*</span>
              </label>
              <Input value={form.whatsapp} onChange={setF('whatsapp')} placeholder="(00) 00000-0000" inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                E-mail <span className="text-danger">*</span>
              </label>
              <Input type="email" value={form.email} onChange={setF('email')} placeholder="cliente@email.com" autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-foreground">
                Endereço <span className="text-danger">*</span>
              </label>
              <Input value={form.address} onChange={setF('address')} placeholder="Rua, número, bairro, cidade - UF" />
            </div>
          </div>
          {error && <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{error}</p>}
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Spinner />
                  Salvando…
                </>
              ) : (
                'Cadastrar cliente'
              )}
            </Button>
          </div>
        </form>
      )}

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          inputMode="search"
          placeholder="Buscar por nome ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {customers === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <p className="font-medium text-foreground">Nenhum cliente encontrado</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {customers.map((customer) => (
            <div
              key={customer.id}
              className={cn(
                'group flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all',
                customer.blocked ? 'opacity-70' : 'hover:border-primary/30 hover:shadow-md',
              )}
            >
              <button
                type="button"
                onClick={() => handleSelect(customer)}
                disabled={customer.blocked}
                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Building2 className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{customer.name}</p>
                  {customer.trade_name && customer.trade_name !== customer.name && (
                    <p className="truncate text-xs text-muted-foreground">{customer.trade_name}</p>
                  )}
                  {customer.cnpj && (
                    <p className="truncate text-xs text-muted-foreground">CNPJ: {customer.cnpj}</p>
                  )}
                  {customer.credit_limit != null && (
                    <p className="truncate text-xs text-muted-foreground">
                      Limite: {formatBRL(customer.credit_limit)}
                    </p>
                  )}
                  {customer.blocked && customer.block_reason && (
                    <p className="truncate text-xs text-danger">{customer.block_reason}</p>
                  )}
                </div>
              </button>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {customer.blocked ? (
                  <Badge variant="red">Bloqueado</Badge>
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
                {customer.whatsapp && (
                  <a
                    href={`https://wa.me/${customer.whatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Abrir WhatsApp"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-positive-soft-foreground transition-colors hover:bg-positive-soft"
                  >
                    <MessageCircle className="h-[18px] w-[18px]" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
