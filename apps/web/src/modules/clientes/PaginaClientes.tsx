import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Users,
  ChevronRight,
  Building2,
  MessageCircle,
  UserPlus,
  X,
  ShoppingCart,
} from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { useMinhasTabelas } from '../../hooks/useMinhasTabelas.js';
import { Badge } from '../../components/interface/Badge.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { Toast } from '../../components/interface/Toast.js';
import { SeletorDeTabela } from '../../components/comercial/SeletorDeTabela.js';
import { ConfirmarTabela } from '../../components/comercial/ConfirmarTabela.js';
import { cn, formatBRL } from '../../lib/utils.js';
import { situacaoDaCompra, type Frescor } from '../../lib/carteira.js';
import type { CustomerListItem, CreateCustomerRequest, ApiResponse } from '@csb/shared';

const EMPTY_CUST = { name: '', cnpj: '', trade_name: '', whatsapp: '', email: '', address: '' };

export function PaginaClientes() {
  const { token, user } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { tabelas, precisaEscolher, nomeDe } = useMinhasTabelas();
  const [search, setSearch] = useState('');
  // "Sem cliente criado" no link temporário cai aqui com o formulário aberto;
  // depois de salvar, `voltarPara` devolve à criação do link com o cliente novo.
  const [showForm, setShowForm] = useState(params.get('novo') === '1');
  const voltarPara = params.get('voltar');
  const [form, setForm] = useState({ ...EMPTY_CUST });
  const [tabelaEscolhida, setTabelaEscolhida] = useState('');
  const [confirmando, setConfirmando] = useState(false);
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

  // ─── A carteira por frescor ────────────────────────────────────────────────
  // A Minha Área manda para cá com ?frescor=parado — o rep cai direto na lista
  // de quem precisa de visita. (O `params` é o mesmo lá de cima, do ?novo.)
  const frescorDaUrl = params.get('frescor');
  const [frescor, setFrescor] = useState<Frescor | 'all'>(
    frescorDaUrl === 'parado' || frescorDaUrl === 'esfriando' || frescorDaUrl === 'ativo'
      ? frescorDaUrl
      : 'all',
  );

  const { visiveis, contagem } = useMemo(() => {
    const decorados = (customers ?? []).map((c) => ({
      cliente: c,
      situacao: situacaoDaCompra(c.last_purchase_at),
    }));
    const contagem = { ativo: 0, esfriando: 0, parado: 0, sem_registro: 0 } as Record<Frescor, number>;
    for (const d of decorados) contagem[d.situacao.nivel]++;
    let visiveis = frescor === 'all' ? decorados : decorados.filter((d) => d.situacao.nivel === frescor);
    // Filtrando por frescor, quem está há MAIS tempo sem comprar vem primeiro —
    // é a ordem de prioridade da visita. Sem filtro, a ordem alfabética de
    // sempre (a busca por nome depende dela).
    if (frescor !== 'all') {
      visiveis = [...visiveis].sort((a, b) => (b.situacao.dias ?? 0) - (a.situacao.dias ?? 0));
    }
    return { visiveis, contagem };
  }, [customers, frescor]);

  // As cores do Yan: verde ativo, amarelo atenção, vermelho inativo.
  const FILTROS: Array<{ valor: Frescor | 'all'; rotulo: string; cor?: string }> = [
    { valor: 'all', rotulo: 'Todos' },
    { valor: 'parado', rotulo: `Inativos${contagem.parado ? ` (${contagem.parado})` : ''}`, cor: 'bg-danger' },
    { valor: 'esfriando', rotulo: `Atenção${contagem.esfriando ? ` (${contagem.esfriando})` : ''}`, cor: 'bg-warn' },
    { valor: 'ativo', rotulo: 'Ativos', cor: 'bg-positive' },
    { valor: 'sem_registro', rotulo: 'Sem registro' },
  ];

  useEffect(() => {
    if (!token) return;
    api
      .getLista<ApiResponse<CustomerListItem[]>>('/customers', token)
      .then((res) => db.customers.bulkPut(res.data))
      .catch(() => {
        /* offline: usamos o cache */
      });
  }, [token]);

  /**
   * Abre a ficha, não um pedido em branco.
   *
   * Antes, tocar no cliente já começava a venda: o representante escolhia o
   * primeiro produto sem ter visto por qual tabela aquela loja compra nem
   * quando ela comprou pela última vez. Quem quer vender direto tem o botão de
   * carrinho no próprio cartão. Cliente bloqueado também abre — é justamente
   * onde se lê o motivo do bloqueio.
   */
  const handleSelect = (customer: { id: string }) => {
    void navigate(`/customers/${customer.id}`);
  };

  /**
   * Valida e decide se ainda falta um aviso.
   *
   * Quem tem duas tabelas ou mais não grava direto: passa pela confirmação que
   * nomeia a tabela. Quem tem uma só nem vê o assunto — o fluxo é o de sempre.
   */
  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const digitos = (v: string) => v.replace(/\D/g, '');
    if (!form.name.trim()) {
      setError('Informe o nome / razão social do cliente.');
      return;
    }
    // Obrigatórios: nome e CPF/CNPJ. O resto é opcional — cliente cadastrado no
    // app não vai para o Control, então WhatsApp, e-mail e endereço não travam a
    // venda. Mas o que estiver preenchido continua validado.
    const cnpjLen = digitos(form.cnpj).length;
    if (cnpjLen === 0) {
      setError('Informe o CPF ou CNPJ do cliente.');
      return;
    }
    if (cnpjLen !== 11 && cnpjLen !== 14) {
      setError('CPF tem 11 dígitos e CNPJ 14.');
      return;
    }
    if (form.whatsapp.trim()) {
      const zapLen = digitos(form.whatsapp).length;
      if (zapLen < 10 || zapLen > 11) {
        setError('WhatsApp precisa do DDD (10 ou 11 dígitos). Deixe em branco se não tiver.');
        return;
      }
    }
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      setError('E-mail inválido. Deixe em branco se não tiver.');
      return;
    }
    if (precisaEscolher && !tabelaEscolhida) {
      setError('Escolha a tabela de preço deste cliente.');
      return;
    }
    if (precisaEscolher) {
      setConfirmando(true);
      return;
    }
    void cadastrar();
  };

  const cadastrar = async () => {
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
        // Sem escolha, o servidor usa a única tabela do representante.
        ...(tabelaEscolhida ? { price_table_id: tabelaEscolhida } : {}),
      };
      const res = await api.post<ApiResponse<CustomerListItem>>('/customers', payload, token);
      await db.customers.put(res.data);
      setForm({ ...EMPTY_CUST });
      setTabelaEscolhida('');
      setConfirmando(false);
      setShowForm(false);
      // Veio do link temporário: devolve à criação do link com o cliente
      // recém-cadastrado já escolhido.
      if (voltarPara === 'vitrine') {
        void navigate(`/acessos?aba=vitrine&cliente=${res.data.id}`);
        return;
      }
      setToast({ message: 'Cliente cadastrado!', type: 'success' });
    } catch (err) {
      setConfirmando(false);
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Clientes</h1>
        {/* O financeiro só VISUALIZA cadastro — a API nega a escrita dele. O
            relacionamento (Bruna) também não cadastra: seleciona e encaminha. */}
        {user?.role !== 'financeiro' && user?.role !== 'relacionamento' && (
          <Button size="md" onClick={() => setShowForm((s) => !s)}>
            {showForm ? <X className="h-4 w-4" strokeWidth={2.5} /> : <UserPlus className="h-4 w-4" strokeWidth={2.5} />}
            {showForm ? 'Cancelar' : 'Novo cliente'}
          </Button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
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
                CPF / CNPJ <span className="text-danger">*</span>
              </label>
              <Input value={form.cnpj} onChange={setF('cnpj')} placeholder="00.000.000/0000-00" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">WhatsApp</label>
              <Input value={form.whatsapp} onChange={setF('whatsapp')} placeholder="(00) 00000-0000" inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">E-mail</label>
              <Input type="email" value={form.email} onChange={setF('email')} placeholder="cliente@email.com" autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-foreground">Endereço</label>
              <Input value={form.address} onChange={setF('address')} placeholder="Rua, número, bairro, cidade - UF" />
            </div>
            <div className="sm:col-span-2">
              <SeletorDeTabela
                tabelas={tabelas}
                valor={tabelaEscolhida}
                onEscolher={setTabelaEscolhida}
                contexto="cliente"
              />
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

      {/* O frescor da carteira: quem parou, quem está esfriando. É o filtro que
          transforma a lista num roteiro de visita. */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setFrescor(f.valor)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              frescor === f.valor
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-sunken',
            )}
          >
            {f.cor && <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full align-middle', f.cor)} />}
            {f.rotulo}
          </button>
        ))}
      </div>

      {customers === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <p className="font-medium text-foreground">Nenhum cliente encontrado</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map(({ cliente: customer, situacao }) => (
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
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
                  {/* O frescor: a data está escrita, então retrato velho nunca engana. */}
                  {situacao.nivel !== 'sem_registro' && (
                    <p
                      className={cn(
                        'truncate text-xs font-medium',
                        situacao.nivel === 'parado' && 'text-danger',
                        situacao.nivel === 'esfriando' && 'text-warn-soft-foreground',
                        situacao.nivel === 'ativo' && 'text-positive-soft-foreground',
                      )}
                    >
                      {situacao.rotulo}
                      {customer.last_purchase_at
                        ? ` · ${new Date(customer.last_purchase_at).toLocaleDateString('pt-BR')}`
                        : ''}
                    </p>
                  )}
                  {(customer.overdue_amount ?? 0) > 0 && (
                    <p className="truncate text-xs text-danger">
                      Vencido: {formatBRL(customer.overdue_amount ?? 0)}
                    </p>
                  )}
                  {/* Vermelho pede um porquê: com motivo, mostra; sem, cobra.
                      É a pendência que o rep e a Bruna vão preenchendo. */}
                  {situacao.nivel === 'parado' &&
                    (customer.inactivity_reason ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Motivo: {customer.inactivity_reason}
                      </p>
                    ) : (
                      <p className="truncate text-xs font-medium text-danger">
                        Falta o motivo — toque para preencher
                      </p>
                    ))}
                </div>
              </button>

              {/* Atalho para vender direto, sem passar pela ficha. A tabela e o
                  botão de trocar vivem na ficha: aqui já são três alvos de
                  toque, e um quarto no celular vira erro de dedo. */}
              {!customer.blocked && user?.role !== 'relacionamento' && (
                <button
                  type="button"
                  onClick={() => void navigate(`/orders/new?customer_id=${customer.id}`)}
                  aria-label={`Novo pedido para ${customer.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                >
                  <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              )}

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

      {confirmando && (
        <ConfirmarTabela
          titulo={`Cadastrar ${form.trade_name.trim() || form.name.trim()} na ${nomeDe(tabelaEscolhida) ?? ''}?`}
          detalhe="O preço de tudo que esta loja comprar vem desta tabela — inclusive nos pedidos que ela mesma fizer pelo login dela."
          tabela={nomeDe(tabelaEscolhida) ?? ''}
          ocupado={saving}
          onConfirmar={() => void cadastrar()}
          onCancelar={() => setConfirmando(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
