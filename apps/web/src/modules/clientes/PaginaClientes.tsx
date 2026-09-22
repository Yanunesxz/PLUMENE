import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { dataDaUltimaCompra, situacaoDoCliente, type NivelDaCarteira } from '../../lib/carteira.js';
import { mesmoCodigoErp } from '../../lib/codigoErp.js';
import { linkDoWhatsApp } from '../../lib/pedido.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import {
  documento,
  formatarDocumento,
  cepValido,
  formatarCep,
  apenasDigitos,
  ufValida,
  UFS,
  rotuloDoMotivo,
} from '@csb/shared';
import type { CustomerListItem, CreateCustomerRequest, ApiResponse } from '@csb/shared';

// O cadastro "mais real" (Yan, 10/09/2026): igual ao do Control — documento
// com dígito verificador, endereço em campos com CEP obrigatório.
const EMPTY_CUST = {
  name: '',
  trade_name: '',
  cnpj: '',
  inscricao_estadual: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  whatsapp: '',
  email: '',
  observacoes: '',
};

/**
 * Corta a espera em N ms. `AbortSignal.timeout` só existe do Safari 16 em
 * diante — no iPhone parado no iOS 15 ele não existe, e a chamada inteira
 * morreria num TypeError silencioso. Aqui o pior caso vira "sem corte de
 * tempo", nunca "sem consulta".
 */
function abortarEm(ms: number): AbortSignal | null {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController === 'undefined') return null;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

const campoClasse =
  'flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground';

export function PaginaClientes() {
  const { token, user } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { tabelas, precisaEscolher, nomeDe } = useMinhasTabelas();
  // ?busca= existe para o CRM (CSP 360) conseguir apontar direto para UM
  // registro: o cadastro do cliente mora aqui (e no Control atrás), não lá, então
  // o link de lá chega com o código do ERP e esta lista já abre filtrada nele.
  // Sem o parâmetro nada muda — a busca continua começando vazia.
  const buscaDaUrl = params.get('busca')?.trim() ?? '';
  const [search, setSearch] = useState(buscaDaUrl);
  /** Cartão apontado por um link de fora — destacado só para a pessoa achar. */
  const [idEmDestaque, setIdEmDestaque] = useState<string | null>(null);
  const cartaoEmDestaque = useRef<HTMLDivElement | null>(null);
  // Uma vez só: depois que a pessoa mexe na busca, o destaque não volta sozinho.
  const jaDestacou = useRef(false);
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
  // Quem chega da ficha depois de excluir um cliente (só admin) traz o aviso
  // no state da navegação. Sai do histórico logo em seguida: voltar para esta
  // tela não repete o aviso.
  const location = useLocation();
  useEffect(() => {
    const aviso = (location.state as { aviso?: unknown } | null)?.aviso;
    if (typeof aviso !== 'string' || !aviso) return;
    setToast({ message: aviso, type: 'success' });
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);
  const setF = (k: keyof typeof EMPTY_CUST) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const isOnline = useOnlineStatus();
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [avisoDoCep, setAvisoDoCep] = useState('');
  // O ÚLTIMO CEP pedido. Sem ele, quem corrige o CEP no meio da busca recebe o
  // endereço do CEP anterior: a resposta que demorou chega depois e preenche
  // a rua errada, calada.
  const cepPedido = useRef('');

  // O CEP preenche o endereço (ViaCEP) — só online; sem rede a pessoa digita.
  // Nunca sobrescreve o que já foi digitado: é ajuda, não dono do formulário.
  const buscarCep = async (cep: string) => {
    const digitos = apenasDigitos(cep);
    if (!isOnline || !cepValido(cep)) return;
    cepPedido.current = digitos;
    setBuscandoCep(true);
    setAvisoDoCep('');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, {
        signal: abortarEm(6000),
      });
      const j = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      // A pessoa já trocou o CEP: esta resposta é de outro endereço.
      if (cepPedido.current !== digitos) return;
      if (j.erro) {
        setAvisoDoCep('CEP não encontrado nos Correios — confira, ou digite o endereço na mão.');
        return;
      }
      setForm((f) => ({
        ...f,
        logradouro: f.logradouro || j.logradouro || '',
        bairro: f.bairro || j.bairro || '',
        cidade: f.cidade || j.localidade || '',
        uf: f.uf || j.uf || '',
      }));
    } catch {
      if (cepPedido.current === digitos) {
        setAvisoDoCep('Não deu para consultar o CEP agora — digite o endereço na mão.');
      }
    } finally {
      if (cepPedido.current === digitos) setBuscandoCep(false);
    }
  };

  const customers = useLiveQuery(() => {
    if (!search) return db.customers.orderBy('name').toArray();
    const texto = search.toLowerCase();
    // O CNPJ é procurado em DÍGITOS dos dois lados: a base tem cadastro com
    // máscara (cargas antigas) e sem (o cadastro novo, 041), e quem digita
    // "22.518" ou "22518" quer o mesmo cliente.
    const digitos = apenasDigitos(search);
    return db.customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(texto) ||
          (c.trade_name ?? '').toLowerCase().includes(texto) ||
          (digitos.length >= 3 && apenasDigitos(c.cnpj ?? '').includes(digitos)) ||
          // O código do Control é a ponte com o CRM: é por ele que o link de
          // lá (?busca=01234) acha o cliente. Sem isto o código não era
          // procurado em lugar nenhum e o link caía numa lista vazia.
          mesmoCodigoErp(c.erp_id, texto),
      )
      .toArray();
  }, [search]);

  // ─── A carteira por frescor ────────────────────────────────────────────────
  // A Minha Área manda para cá com ?frescor=parado — o rep cai direto na lista
  // de quem precisa de visita. (O `params` é o mesmo lá de cima, do ?novo.)
  const frescorDaUrl = params.get('frescor');
  const [frescor, setFrescor] = useState<NivelDaCarteira | 'all'>(
    frescorDaUrl === 'parado' ||
      frescorDaUrl === 'esfriando' ||
      frescorDaUrl === 'ativo' ||
      frescorDaUrl === 'varejo' ||
      frescorDaUrl === 'inativo'
      ? frescorDaUrl
      : 'all',
  );

  // Cliente nascido no app sem o número do Control: é a fila do financeiro
  // para atrelar ("esses números vão ter que ser incluídos e atrelados").
  // ?erp=sem: o card da Minha Área do financeiro cai aqui já filtrado.
  const [soSemCodigo, setSoSemCodigo] = useState(params.get('erp') === 'sem');
  // Quem INCLUI no Control é a Larissa: para ela é fila de trabalho; para o
  // representante é só a informação de que o cliente novo ainda não está lá.
  const ehEscritorio = user?.role === 'financeiro' || user?.role === 'admin' || user?.role === 'manager';

  const { visiveis, contagem, semCodigo } = useMemo(() => {
    const decorados = (customers ?? []).map((c) => ({
      cliente: c,
      // Varejo marcado pela venda interna sai da régua: não conta em Atenção
      // nem em Esfriados — é o que para a cobrança de contato (047).
      situacao: situacaoDoCliente(c),
    }));
    const contagem = { ativo: 0, esfriando: 0, parado: 0, sem_registro: 0, varejo: 0, inativo: 0 } as Record<
      NivelDaCarteira,
      number
    >;
    for (const d of decorados) contagem[d.situacao.nivel]++;
    // Só quem nasceu no app: cliente de carga da Curva ABC também está sem
    // código, mas já existe no Control — ver PaginaMinhaArea.
    const nascidoNoApp = (c: CustomerListItem) => !c.erp_id && !!c.rep_id;
    const semCodigo = decorados.filter((d) => nascidoNoApp(d.cliente)).length;
    let visiveis = frescor === 'all' ? decorados : decorados.filter((d) => d.situacao.nivel === frescor);
    if (soSemCodigo) visiveis = visiveis.filter((d) => nascidoNoApp(d.cliente));
    // Filtrando por frescor, quem está há MAIS tempo sem comprar vem primeiro —
    // é a ordem de prioridade da visita. Sem filtro, a ordem alfabética de
    // sempre (a busca por nome depende dela).
    if (frescor !== 'all') {
      visiveis = [...visiveis].sort((a, b) => (b.situacao.dias ?? 0) - (a.situacao.dias ?? 0));
    }
    return { visiveis, contagem, semCodigo };
  }, [customers, frescor, soSemCodigo]);

  // Sobrou UM cliente com a busca que veio da URL: rola até ele e destaca. NÃO
  // abre a ficha (/customers/:id) sozinho — o código do ERP pode casar com mais
  // de um cadastro, e navegar por engano tira a pessoa do lugar sem ela
  // entender o que aconteceu.
  useEffect(() => {
    if (!buscaDaUrl || jaDestacou.current || customers === undefined) return;
    const unico = visiveis.length === 1 ? visiveis[0] : undefined;
    if (!unico) return;
    jaDestacou.current = true;
    setIdEmDestaque(unico.cliente.id);
  }, [buscaDaUrl, customers, visiveis]);

  useEffect(() => {
    if (!idEmDestaque) return;
    cartaoEmDestaque.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [idEmDestaque]);

  // As cores do Yan: verde ativo, amarelo atenção, vermelho ESFRIADO — o nome
  // que ele passou a usar em 11/09/2026 para o cliente que sumiu.
  // Ordem do Yan (02/09): ativo → atenção → esfriado, e o ATIVO com o número —
  // o rep precisa ver quantos clientes vivos tem, não só quantos pararam.
  const FILTROS: Array<{ valor: NivelDaCarteira | 'all'; rotulo: string; cor?: string }> = [
    { valor: 'all', rotulo: 'Todos' },
    { valor: 'ativo', rotulo: `Ativos${contagem.ativo ? ` (${contagem.ativo})` : ''}`, cor: 'bg-positive' },
    { valor: 'esfriando', rotulo: `Atenção${contagem.esfriando ? ` (${contagem.esfriando})` : ''}`, cor: 'bg-warn' },
    { valor: 'parado', rotulo: `Esfriados${contagem.parado ? ` (${contagem.parado})` : ''}`, cor: 'bg-danger' },
    { valor: 'sem_registro', rotulo: 'Sem registro' },
    // Só aparece quando existe: carteira sem balcão não ganha um chip vazio.
    ...(contagem.varejo > 0 ? [{ valor: 'varejo' as const, rotulo: `Varejo (${contagem.varejo})` }] : []),
    // A aba dos que não compram mais (052) — pedido do Yan de 22/09/2026.
    // Sempre visível: é para onde a pessoa vai conferir quem já foi marcado.
    { valor: 'inativo', rotulo: `Inativos${contagem.inativo ? ` (${contagem.inativo})` : ''}` },
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
    if (form.name.trim().length < 2) {
      setError('Informe o nome / razão social do cliente.');
      return;
    }
    // Igual ao Control (Yan, 10/09/2026): documento de verdade e endereço com
    // CEP. A mesma régua da API (packages/shared) — avisa aqui antes de mandar.
    if (!apenasDigitos(form.cnpj)) {
      setError('Informe o CPF ou CNPJ do cliente.');
      return;
    }
    if (!documento(form.cnpj)) {
      setError('CPF / CNPJ inválido — confira os números.');
      return;
    }
    if (!cepValido(form.cep)) {
      setError('Informe o CEP (8 números).');
      return;
    }
    if (!form.logradouro.trim()) {
      setError('Informe o endereço (rua, avenida…).');
      return;
    }
    if (!form.numero.trim()) {
      setError('Informe o número do endereço.');
      return;
    }
    if (!form.bairro.trim()) {
      setError('Informe o bairro.');
      return;
    }
    if (!form.cidade.trim()) {
      setError('Informe a cidade.');
      return;
    }
    if (!ufValida(form.uf)) {
      setError('Escolha a UF.');
      return;
    }
    if (form.whatsapp.trim()) {
      const zapLen = apenasDigitos(form.whatsapp).length;
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
        name: form.name.trim(),
        trade_name: form.trade_name.trim() || null,
        cnpj: apenasDigitos(form.cnpj),
        inscricao_estadual: form.inscricao_estadual.trim() || null,
        cep: apenasDigitos(form.cep),
        logradouro: form.logradouro.trim(),
        numero: form.numero.trim(),
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim(),
        cidade: form.cidade.trim(),
        uf: form.uf.trim().toUpperCase(),
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        observacoes: form.observacoes.trim() || null,
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
                Razão social <span className="text-danger">*</span>
              </label>
              <Input value={form.name} onChange={setF('name')} placeholder="Como está no CNPJ" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Nome fantasia</label>
              <Input value={form.trade_name} onChange={setF('trade_name')} placeholder="Como a loja é conhecida" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                CPF / CNPJ <span className="text-danger">*</span>
              </label>
              <Input
                value={form.cnpj}
                onChange={setF('cnpj')}
                onBlur={() => setForm((f) => ({ ...f, cnpj: formatarDocumento(f.cnpj) }))}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
              />
              {/* Só quando o número PODE estar pronto (11 = CPF, 14 = CNPJ):
                  avisando aos 11 dígitos, quem digita CNPJ lê "inválido" no
                  meio da digitação e apaga o que estava certo. */}
              {(apenasDigitos(form.cnpj).length === 11 || apenasDigitos(form.cnpj).length >= 14) &&
                !documento(form.cnpj) && (
                  <p className="text-xs text-danger">Este número não é um CPF/CNPJ válido.</p>
                )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Inscrição Estadual</label>
              <Input value={form.inscricao_estadual} onChange={setF('inscricao_estadual')} placeholder="Opcional (ou ISENTO)" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                CEP <span className="text-danger">*</span>
              </label>
              <Input
                value={form.cep}
                onChange={setF('cep')}
                onBlur={() => {
                  setForm((f) => ({ ...f, cep: formatarCep(f.cep) }));
                  void buscarCep(form.cep);
                }}
                placeholder="00000-000"
                inputMode="numeric"
              />
              {buscandoCep && <p className="text-xs text-muted-foreground">Buscando o endereço…</p>}
              {!buscandoCep && avisoDoCep && <p className="text-xs text-warn-soft-foreground">{avisoDoCep}</p>}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-foreground">
                Endereço <span className="text-danger">*</span>
              </label>
              <Input value={form.logradouro} onChange={setF('logradouro')} placeholder="Rua, avenida…" />
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Número <span className="text-danger">*</span>
                </label>
                <Input value={form.numero} onChange={setF('numero')} placeholder="123" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Complemento</label>
                <Input value={form.complemento} onChange={setF('complemento')} placeholder="Sala, loja, fundos…" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Bairro <span className="text-danger">*</span>
              </label>
              <Input value={form.bairro} onChange={setF('bairro')} placeholder="Bairro" />
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Cidade <span className="text-danger">*</span>
                </label>
                <Input value={form.cidade} onChange={setF('cidade')} placeholder="Cidade" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  UF <span className="text-danger">*</span>
                </label>
                <select
                  value={form.uf}
                  onChange={setF('uf')}
                  className={cn(campoClasse, 'h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
                  aria-label="UF"
                >
                  <option value="">UF</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
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
              <label className="text-sm font-medium text-foreground">Observações</label>
              <textarea
                value={form.observacoes}
                onChange={setF('observacoes')}
                rows={2}
                placeholder="Vão junto no pedido, como no Control — horário de entrega, referência, recado da loja"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
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
          placeholder="Buscar por nome, CNPJ ou código do Control…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // Mexeu na busca: o destaque do link já cumpriu o papel.
            setIdEmDestaque(null);
          }}
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
        {/* Fica visível enquanto o filtro estiver LIGADO, mesmo zerando: era
            o único jeito de desligar, e sumia justo quando a fila acabava. */}
        {(semCodigo > 0 || soSemCodigo) && (
          <button
            type="button"
            onClick={() => setSoSemCodigo((v) => !v)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              soSemCodigo
                ? 'border-warn bg-warn-soft text-warn-soft-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-sunken',
            )}
          >
            Para incluir no Control ({semCodigo})
          </button>
        )}
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
              ref={customer.id === idEmDestaque ? cartaoEmDestaque : null}
              className={cn(
                'group flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all',
                customer.blocked ? 'opacity-70' : 'hover:border-primary/30 hover:shadow-md',
                customer.id === idEmDestaque && 'border-primary ring-2 ring-primary/40',
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
                    <p className="truncate text-xs text-muted-foreground">
                      {apenasDigitos(customer.cnpj).length === 11 ? 'CPF' : 'CNPJ'}: {formatarDocumento(customer.cnpj)}
                    </p>
                  )}
                  {/* O número do Control. Quem NASCEU no app e ainda não tem
                      código é pendência da Larissa — o aviso só aparece nesses;
                      cliente de carga sem código já existe no Control e o selo
                      viraria ruído em 1.225 cartões. */}
                  {customer.erp_id ? (
                    <p className="truncate text-xs text-muted-foreground">Cód. ERP {customer.erp_id}</p>
                  ) : customer.rep_id ? (
                    <p className="truncate text-xs text-warn-soft-foreground">
                      {ehEscritorio ? 'Falta incluir no Control' : 'Ainda não está no Control'}
                    </p>
                  ) : null}
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
                        situacao.nivel === 'varejo' && 'text-muted-foreground',
                        situacao.nivel === 'inativo' && 'text-muted-foreground',
                      )}
                    >
                      {situacao.rotulo}
                      {situacao.nivel === 'inativo' && rotuloDoMotivo(customer.inativo_motivo)
                        ? ` · ${rotuloDoMotivo(customer.inativo_motivo)}`
                        : ''}
                      {customer.last_purchase_at
                        ? ` · ${dataDaUltimaCompra(customer.last_purchase_at) ?? ''}`
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
              {user?.role !== 'relacionamento' && (
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
                    href={linkDoWhatsApp(customer.whatsapp)}
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
