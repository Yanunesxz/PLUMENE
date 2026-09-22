import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  MessageCircle,
  Mail,
  MapPin,
  Tag,
  ShoppingCart,
  ChevronRight,
  Receipt,
  CalendarClock,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api, esquecerCache } from '../../services/api.js';
import { db } from '../../offline/db.js';
import { useMinhasTabelas } from '../../hooks/useMinhasTabelas.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { Badge } from '../../components/interface/Badge.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import { EditarCadastroDoCliente } from '../../components/comercial/EditarCadastroDoCliente.js';
import { AlteracoesParaOControl } from '../../components/comercial/AlteracoesParaOControl.js';
import { TrocarTabelaDoCliente } from './TrocarTabelaDoCliente.js';
import { ExcluirCliente } from './ExcluirCliente.js';
import { linhasDoDono } from '../../lib/donoDoCliente.js';
import { seloDoPedido, linkDoWhatsApp } from '../../lib/pedido.js';
import { situacaoDoCliente, VARIANTE_DO_FRESCOR } from '../../lib/carteira.js';
import { formatBRL } from '../../lib/utils.js';
import {
  avisoDaConfirmacao,
  avisoDaConfirmacaoInterrompida,
  avisoDoCadastroSalvo,
  avisoSemReleituraDaFicha,
  camposDaListaDoCliente,
  confirmacaoTalvezGravada,
  emLotesDeConfirmacao,
  marcarConfirmadasNaFicha,
  mensagemDoErroDaConfirmacao,
} from '../../lib/edicaoDoCadastro.js';
import {
  formatarDocumento,
  formatarCep,
  apenasDigitos,
  podeTrocarTabelaDoCliente,
  podeEditarCadastroDoCliente,
  podeConfirmarAlteracaoNoControl,
  MOTIVOS_DE_INATIVO,
  rotuloDoMotivo,
  motivoExigeNota,
} from '@csb/shared';
import type {
  AlteracaoDoCliente,
  AlteracoesConfirmadas,
  ApiResponse,
  ConfirmarAlteracoesDoClienteRequest,
  CustomerDetail,
} from '@csb/shared';

/**
 * A ficha do cliente.
 *
 * Antes, tocar no cliente já abria um pedido em branco. O representante
 * começava a vender sem ver por qual tabela aquela loja compra nem quando ela
 * comprou pela última vez — as duas coisas que decidem a conversa. Agora o
 * pedido continua a um toque (pelo botão no cartão da lista), mas o caminho
 * padrão passa por aqui.
 */
export function PaginaCliente() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const { tabelas, todas: todasAsTabelas, nomeDe } = useMinhasTabelas();

  const [cliente, setCliente] = useState<CustomerDetail | null>(null);
  const [erro, setErro] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // ─── Excluir cliente (só admin, migração 050) ─────────────────────────────
  // O cadastro em dobro: o diálogo mostra o que está ligado ao cliente e pede
  // o cadastro que fica. A API recusa os outros papéis com 403.
  const podeExcluir = user?.role === 'admin';
  const [excluindo, setExcluindo] = useState(false);

  // ─── Editar o cadastro (migração 051) ─────────────────────────────────────
  // "Não tem como alterar esses dados nem sendo admin lá dentro. Quero poder
  // mudar sim, e quando mudar lá tem que mudar no ERP do Fábio também." (Yan,
  // 17/09/2026). Representante e venda interna editam o que é da carteira — e
  // esta ficha só abre para cliente da carteira dele —; gerente, admin e
  // financeiro, qualquer um. O relacionamento só lê. A API confere o mesmo.
  const isOnline = useOnlineStatus();
  const podeEditarCadastro = podeEditarCadastroDoCliente(user?.role);
  const [editandoCadastro, setEditandoCadastro] = useState(false);

  // "Já atualizei no Control": quem mexe lá (financeiro e admin) dá a baixa
  // nas alterações que o cartão mostrou.
  const podeConfirmarNoControl = podeConfirmarAlteracaoNoControl(user?.role);
  const [confirmandoNoControl, setConfirmandoNoControl] = useState(false);
  const [erroAoConfirmar, setErroAoConfirmar] = useState<string | null>(null);

  // ─── Marcar visita para o representante (fluxo da Bruna) ───────────────────
  const ehEscritorio =
    user?.role === 'manager' ||
    user?.role === 'admin' ||
    user?.role === 'financeiro' ||
    user?.role === 'relacionamento';
  const [marcando, setMarcando] = useState(false);
  const [tituloVisita, setTituloVisita] = useState('');
  const [prazoVisita, setPrazoVisita] = useState('');
  const [localVisita, setLocalVisita] = useState('');
  const [obsVisita, setObsVisita] = useState('');
  const [salvandoVisita, setSalvandoVisita] = useState(false);

  // ─── O porquê do cliente vermelho (controle de inatividade, 039) ───────────
  // Preenchem o rep dono da carteira, a Bruna e a gerência. Financeiro só lê.
  const podeExplicar =
    user?.role === 'rep' ||
    user?.role === 'manager' ||
    user?.role === 'admin' ||
    user?.role === 'relacionamento';
  const [motivo, setMotivo] = useState('');
  const [obsMotivo, setObsMotivo] = useState('');
  const [editandoMotivo, setEditandoMotivo] = useState(false);
  const [salvandoMotivo, setSalvandoMotivo] = useState(false);

  // ─── Cliente de varejo (migração 047) — só a venda interna marca ──────────
  // "Para elas informarem que o cliente é cliente varejo e não ficar cobrando
  // elas para entrar em contato novamente" (Yan, 15/09/2026). A API confere o
  // mesmo: representante comum recebe 403.
  const ehVendaInterna = user?.role === 'rep' && user?.venda_interna === true;
  const [salvandoVarejo, setSalvandoVarejo] = useState(false);

  const alternarVarejo = async (varejo: boolean) => {
    if (!token || !id || salvandoVarejo) return;
    setSalvandoVarejo(true);
    try {
      const res = await api.patch<ApiResponse<{ varejo: boolean; varejo_marcado_em: string }>>(
        `/customers/${id}/varejo`,
        { varejo },
        token,
      );
      setCliente((c) =>
        c
          ? {
              ...c,
              varejo: res.data.varejo,
              varejo_marcado_em: res.data.varejo_marcado_em,
              varejo_marcado_por_nome: user?.name ?? null,
            }
          : c,
      );
      // A lista, a Minha Área e os Alertas leem o cache do aparelho: sem isto o
      // cliente seguiria em "Esfriados" e o alerta de contato voltaria a tocar.
      await db.customers.update(id, { varejo: res.data.varejo }).catch(() => {});
      esquecerCache('/customers');
      setToast({
        message: res.data.varejo
          ? 'Marcado como cliente varejo — ele sai da cobrança de contato.'
          : 'Desmarcado — o cliente volta para a régua da carteira.',
        type: 'success',
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível salvar.',
        type: 'error',
      });
    } finally {
      setSalvandoVarejo(false);
    }
  };

  // ─── Cliente INATIVO (migração 052) — não compra mais, sai da régua ────────
  // "Colocar que o cliente é inativo deixa ele como não precisar reativar ou
  // esfriado; são clientes que não compram mais; o motivo precisa ser
  // selecionado" (Yan, 22/09/2026). Mesmos papéis do porquê do esfriado; o
  // CRM espelha como "Perdido manual". Controle interno: nada vai ao Control.
  const [marcandoInativo, setMarcandoInativo] = useState(false);
  const [motivoInativo, setMotivoInativo] = useState('');
  const [notaInativo, setNotaInativo] = useState('');
  const [salvandoInativo, setSalvandoInativo] = useState(false);
  const podeMarcarInativo = podeExplicar;

  const salvarInativo = async (inativo: boolean) => {
    if (!token || !id || salvandoInativo) return;
    if (inativo && (!motivoInativo || (motivoExigeNota(motivoInativo) && !notaInativo.trim()))) return;
    setSalvandoInativo(true);
    try {
      const res = await api.patch<
        ApiResponse<{ inativo: boolean; inativo_motivo: string | null; inativo_nota: string | null; inativo_marcado_em: string }>
      >(
        `/customers/${id}/inativo`,
        inativo
          ? { inativo: true, motivo: motivoInativo, ...(notaInativo.trim() ? { nota: notaInativo.trim() } : {}) }
          : { inativo: false },
        token,
      );
      setCliente((c) =>
        c
          ? {
              ...c,
              inativo: res.data.inativo,
              inativo_motivo: res.data.inativo_motivo,
              inativo_nota: res.data.inativo_nota,
              inativo_marcado_em: res.data.inativo_marcado_em,
              inativo_marcado_por_nome: user?.name ?? null,
              inativo_origem: 'app',
            }
          : c,
      );
      // A lista, a Minha Área e os Alertas leem o cache do aparelho.
      await db.customers
        .update(id, { inativo: res.data.inativo, inativo_motivo: res.data.inativo_motivo })
        .catch(() => {});
      esquecerCache('/customers');
      setMarcandoInativo(false);
      setToast({
        message: res.data.inativo
          ? 'Cliente marcado como inativo — sai da régua e dos alertas.'
          : 'Cliente reativado — volta para a régua da carteira.',
        type: 'success',
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível salvar.',
        type: 'error',
      });
    } finally {
      setSalvandoInativo(false);
    }
  };

  // ─── O número do cliente no Control (atrelar, financeiro/admin) ───────────
  // "Quando conectar no sistema vai ter que ter número dos clientes, e esses
  // números vão ter que ser incluídos e atrelados" (Yan, 10/09/2026). Quem
  // inclui no Control é a Larissa; ela digita o número aqui e o cadastro do
  // app passa a ser o mesmo cliente do ERP.
  const podeAtrelar = user?.role === 'financeiro' || user?.role === 'admin';
  const [codigoErp, setCodigoErp] = useState('');
  const [atrelando, setAtrelando] = useState(false);

  const atrelarCodigo = async () => {
    if (!token || !id || atrelando || !codigoErp.trim()) return;
    setAtrelando(true);
    try {
      const res = await api.patch<ApiResponse<{ erp_id: string }>>(
        `/customers/${id}/codigo-erp`,
        { erp_id: codigoErp.trim() },
        token,
      );
      setCliente((c) => (c ? { ...c, erp_id: res.data.erp_id } : c));
      // A lista de Clientes e o card da Larissa leem o cache do aparelho: sem
      // isto o cliente recém-atrelado continuaria na fila "para incluir no
      // Control" até a próxima sincronização, e ela o incluiria duas vezes.
      await db.customers.update(id, { erp_id: res.data.erp_id }).catch(() => {});
      esquecerCache('/customers');
      setCodigoErp('');
      setToast({ message: `Código ${res.data.erp_id} atrelado.`, type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível atrelar o código.',
        type: 'error',
      });
    } finally {
      setAtrelando(false);
    }
  };

  const salvarMotivo = async () => {
    if (!token || !id || salvandoMotivo) return;
    setSalvandoMotivo(true);
    try {
      await api.patch<ApiResponse<{ ok: boolean }>>(
        `/customers/${id}/inatividade`,
        { motivo: motivo.trim(), ...(obsMotivo.trim() ? { observacao: obsMotivo.trim() } : {}) },
        token,
      );
      setCliente((c) =>
        c
          ? {
              ...c,
              inactivity_reason: motivo.trim(),
              inactivity_note: obsMotivo.trim() || null,
              inactivity_updated_at: new Date().toISOString(),
            }
          : c,
      );
      setEditandoMotivo(false);
      setToast({ message: 'Motivo registrado.', type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível salvar o motivo.',
        type: 'error',
      });
    } finally {
      setSalvandoMotivo(false);
    }
  };

  // O motivo e o título da visita nascem do cadastro — mas só voltam a ele
  // quando o que eles mostram muda (revisão de 17/09/2026). Presos ao objeto
  // `cliente` inteiro, toda troca dele apagava o que estava sendo digitado:
  // salvar o cadastro, o 409 que recarrega, "Já atualizei no Control" — o
  // formulário do motivo continuava aberto, vazio.
  const idDoCliente = cliente?.id;
  const motivoGravado = cliente?.inactivity_reason ?? '';
  const obsDoMotivoGravada = cliente?.inactivity_note ?? '';
  const tituloPadraoDaVisita = cliente ? `Visitar ${cliente.trade_name || cliente.name}` : '';
  useEffect(() => {
    if (!idDoCliente) return;
    setMotivo(motivoGravado);
    setObsMotivo(obsDoMotivoGravada);
  }, [idDoCliente, motivoGravado, obsDoMotivoGravada]);
  useEffect(() => {
    // Com o formulário da visita aberto, o título digitado fica (o nome pode ter
    // mudado na edição do cadastro).
    if (idDoCliente && !marcando) setTituloVisita(tituloPadraoDaVisita);
  }, [idDoCliente, tituloPadraoDaVisita, marcando]);

  const marcarVisita = async () => {
    if (!token || !id || salvandoVisita) return;
    setSalvandoVisita(true);
    try {
      // Sem rep_id de propósito: o servidor entrega ao dono da carteira.
      await api.post<ApiResponse<unknown>>(
        '/tarefas',
        {
          customer_id: id,
          titulo: tituloVisita.trim(),
          ...(prazoVisita ? { prazo: new Date(prazoVisita).toISOString() } : {}),
          ...(localVisita.trim() ? { local: localVisita.trim() } : {}),
          ...(obsVisita.trim() ? { observacoes: obsVisita.trim() } : {}),
        },
        token,
      );
      setMarcando(false);
      setPrazoVisita('');
      setLocalVisita('');
      setObsVisita('');
      setToast({ message: 'Visita marcada — o representante recebe na Minha Área dele.', type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível marcar a visita.',
        type: 'error',
      });
    } finally {
      setSalvandoVisita(false);
    }
  };

  const carregar = useCallback(async () => {
    if (!token || !id) return;
    try {
      const res = await api.get<ApiResponse<CustomerDetail>>(`/customers/${id}`, token);
      setCliente(res.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir o cliente.');
    }
  }, [token, id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * A edição ficou gravada, mas a resposta foi erro (17/09/2026): relê a ficha
   * e põe o cadastro novo na lista do aparelho. Falhando a releitura, a ficha
   * fica como está (não vira a tela de erro) e o aviso diz para reabrir — sem
   * apagar o aviso do salvar (`aviso`): no ALTERACAO_SEM_HISTORICO é ele que
   * diz que a mudança não vai chegar ao Control e pede para avisar o suporte.
   */
  const relerDepoisDeGravar = async (aviso: { mensagem: string; tipo: 'success' | 'error' }) => {
    if (!token || !id) return;
    try {
      const res = await api.get<ApiResponse<CustomerDetail>>(`/customers/${id}`, token);
      setCliente(res.data);
      await db.customers.update(res.data.id, camposDaListaDoCliente(res.data)).catch(() => {});
    } catch {
      const semReler = avisoSemReleituraDaFicha(aviso);
      setToast({ message: semReler.mensagem, type: semReler.tipo });
    }
  };

  const confirmarNoControl = async (ids: string[]) => {
    if (!token || !id || confirmandoNoControl || ids.length === 0) return;
    setConfirmandoNoControl(true);
    setErroAoConfirmar(null);
    // Fora do try: o catch precisa saber o que os lotes anteriores já marcaram.
    const confirmadas: string[] = [];
    try {
      // A rota aceita até 50 ids por vez. Um cliente com mais de 50 edições
      // esperando é improvável, mas a baixa tem de cobrir tudo o que a pessoa viu.
      let alteracoes: AlteracaoDoCliente[] | null = null;
      for (const lote of emLotesDeConfirmacao(ids)) {
        const corpo: ConfirmarAlteracoesDoClienteRequest = { ids: lote };
        const res = await api.post<ApiResponse<AlteracoesConfirmadas>>(
          `/customers/${id}/alteracoes/confirmar`,
          corpo,
          token,
        );
        confirmadas.push(...res.data.confirmadas);
        alteracoes = res.data.alteracoes;
      }
      if (alteracoes) {
        const lista = alteracoes;
        setCliente((c) => (c ? { ...c, alteracoes: lista } : c));
      } else {
        // Gravou, mas a releitura falhou lá: relê a ficha — sem a tela de erro
        // (revisão de 17/09/2026). Pelo `carregar`, a falha desta releitura
        // trocava a ficha inteira por "não foi possível abrir o cliente", o
        // toast de marcado nunca aparecia e o financeiro não sabia se a baixa
        // tinha ficado. Falhando, a ficha fica e o cartão já tira o que foi marcado.
        try {
          const res = await api.get<ApiResponse<CustomerDetail>>(`/customers/${id}`, token);
          setCliente(res.data);
          alteracoes = res.data.alteracoes ?? null;
        } catch {
          const em = new Date().toISOString();
          const quem = { id: user?.id ?? null, nome: user?.name ?? null };
          setCliente((c) =>
            c ? { ...c, alteracoes: marcarConfirmadasNaFicha(c.alteracoes ?? [], confirmadas, quem, em) } : c,
          );
          setToast({
            message: `${avisoDaConfirmacao(ids.length, confirmadas.length, null)} Não deu para recarregar a ficha — feche e abra de novo para ver as alterações de agora.`,
            type: 'success',
          });
          return;
        }
      }
      setToast({ message: avisoDaConfirmacao(ids.length, confirmadas.length, alteracoes), type: 'success' });
    } catch (err) {
      // Falha de rede vira frase que se entende (17/09/2026) — não "Load failed".
      setErroAoConfirmar(mensagemDoErroDaConfirmacao(err));
      // A baixa pode ter ficado (17/09/2026): a resposta se perdeu depois de a
      // API marcar, ou um lote anterior já marcou. Sem reler, o cartão seguia
      // pedindo o que já tinha baixa. A releitura não vira a tela de erro.
      if (confirmadas.length > 0 || confirmacaoTalvezGravada(err)) {
        try {
          const res = await api.get<ApiResponse<CustomerDetail>>(`/customers/${id}`, token);
          setCliente(res.data);
          setErroAoConfirmar(avisoDaConfirmacaoInterrompida(confirmadas.length, true));
        } catch {
          if (confirmadas.length > 0) {
            const em = new Date().toISOString();
            const quem = { id: user?.id ?? null, nome: user?.name ?? null };
            setCliente((c) =>
              c ? { ...c, alteracoes: marcarConfirmadasNaFicha(c.alteracoes ?? [], confirmadas, quem, em) } : c,
            );
            setErroAoConfirmar(avisoDaConfirmacaoInterrompida(confirmadas.length, false));
          }
        }
      }
    } finally {
      setConfirmandoNoControl(false);
    }
  };

  if (erro) {
    return (
      <div className="p-4 md:p-6">
        <Voltar />
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="space-y-3 p-4 md:p-6">
        <Voltar />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const tabela = nomeDe(cliente.price_table_id);
  // A cor do cliente (verde/amarelo/vermelho) — régua da migração 036 — ou
  // "varejo", quando a venda interna o tirou da régua (047).
  const situacao = situacaoDoCliente(cliente);

  return (
    <div className="p-4 md:p-6">
      <Voltar />

      {/* ─── Cadastro ─────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Building2 className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight text-foreground">{cliente.name}</h1>
            {cliente.trade_name && cliente.trade_name !== cliente.name && (
              <p className="text-sm text-muted-foreground">{cliente.trade_name}</p>
            )}
            {situacao.nivel !== 'sem_registro' && (
              <div className="mt-2">
                <Badge variant={VARIANTE_DO_FRESCOR[situacao.nivel]}>{situacao.rotulo}</Badge>
              </div>
            )}
            {cliente.blocked && (
              <div className="mt-2">
                <Badge variant="red">Bloqueado</Badge>
                {cliente.block_reason && (
                  <p className="mt-1 text-xs text-danger">{cliente.block_reason}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Cliente de varejo: a venda interna liga e desliga; os demais só
            leem quem marcou — é a quem perguntar se o cliente voltar a comprar. */}
        {ehVendaInterna ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {cliente.varejo ? 'Cliente varejo' : 'É cliente de varejo?'}
              </p>
              <p className="text-xs text-muted-foreground">
                {cliente.varejo
                  ? 'Fora dos alertas e da lista de esfriados — ninguém vai cobrar contato.'
                  : 'Marque quem compra no balcão e não volta: ele sai dos alertas e da cobrança de contato.'}
              </p>
            </div>
            <Button
              variant={cliente.varejo ? 'outline' : 'primary'}
              size="sm"
              disabled={salvandoVarejo}
              onClick={() => void alternarVarejo(!cliente.varejo)}
            >
              {salvandoVarejo ? 'Salvando…' : cliente.varejo ? 'Desmarcar' : 'Marcar como varejo'}
            </Button>
          </div>
        ) : (
          cliente.varejo && (
            <p className="mt-3 text-xs text-muted-foreground">
              Marcado como varejo
              {cliente.varejo_marcado_por_nome ? ` por ${cliente.varejo_marcado_por_nome}` : ''}
              {cliente.varejo_marcado_em
                ? ` em ${new Date(cliente.varejo_marcado_em).toLocaleDateString('pt-BR')}`
                : ''}
              {' — fora da cobrança de contato.'}
            </p>
          )
        )}

        {/* Cliente inativo (052): quem não compra mais. Marcar exige motivo da
            lista; desmarcar devolve à régua. Os demais papéis só leem. */}
        {cliente.inativo ? (
          <div className="mt-4 rounded-lg border border-border bg-sunken p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Cliente inativo</p>
                <p className="text-xs text-muted-foreground">
                  {rotuloDoMotivo(cliente.inativo_motivo) ?? 'Sem motivo registrado'}
                  {cliente.inativo_nota ? ` — “${cliente.inativo_nota}”` : ''}
                </p>
                <p className="mt-1 text-[11px] text-subtle">
                  Marcado
                  {cliente.inativo_marcado_por_nome ? ` por ${cliente.inativo_marcado_por_nome}` : ''}
                  {cliente.inativo_origem === 'crm' ? ' no CRM' : ''}
                  {cliente.inativo_marcado_em
                    ? ` em ${new Date(cliente.inativo_marcado_em).toLocaleDateString('pt-BR')}`
                    : ''}
                  . Fora da régua, dos alertas e do relatório.
                </p>
              </div>
              {podeMarcarInativo && (
                <Button variant="outline" size="sm" disabled={salvandoInativo} onClick={() => void salvarInativo(false)}>
                  {salvandoInativo ? 'Salvando…' : 'Reativar'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          podeMarcarInativo && (
            <div className="mt-4 rounded-lg border border-border p-3">
              {!marcandoInativo ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Este cliente não compra mais?</p>
                    <p className="text-xs text-muted-foreground">
                      Marque como inativo: ele sai da régua, dos alertas e da cobrança de contato.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setMarcandoInativo(true)}>
                    Marcar inativo
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void salvarInativo(true);
                  }}
                  className="grid gap-3"
                >
                  <p className="text-sm font-medium text-foreground">Por que este cliente ficou inativo?</p>
                  <div className="grid gap-2">
                    {MOTIVOS_DE_INATIVO.map((m) => (
                      <label key={m.chave} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                        <input
                          type="radio"
                          name="motivo-inativo"
                          value={m.chave}
                          checked={motivoInativo === m.chave}
                          onChange={() => setMotivoInativo(m.chave)}
                          className="h-4 w-4"
                        />
                        {m.rotulo}
                      </label>
                    ))}
                  </div>
                  {motivoExigeNota(motivoInativo) && (
                    <input
                      value={notaInativo}
                      onChange={(e) => setNotaInativo(e.target.value)}
                      maxLength={300}
                      placeholder="Qual é o outro motivo? (poucas palavras)"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      aria-label="Outro motivo"
                    />
                  )}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setMarcandoInativo(false)}>
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        salvandoInativo || !motivoInativo || (motivoExigeNota(motivoInativo) && !notaInativo.trim())
                      }
                    >
                      {salvandoInativo ? 'Salvando…' : 'Confirmar inativo'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )
        )}

        {/* O número do Control: é o que amarra este cadastro ao cliente do ERP.
            Quem nasceu no app fica "sem código" até o financeiro atrelar. */}
        <div className="mt-4 rounded-lg bg-sunken p-3">
          <p className="text-xs text-muted-foreground">Código no ERP (Control)</p>
          {cliente.erp_id ? (
            <p className="mt-0.5 font-mono text-sm font-medium text-foreground">{cliente.erp_id}</p>
          ) : podeAtrelar ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void atrelarCodigo();
              }}
              className="mt-2 flex items-center gap-2"
            >
              <input
                value={codigoErp}
                onChange={(e) => setCodigoErp(e.target.value)}
                placeholder="Nº no Control (ex.: 05836)"
                inputMode="numeric"
                className="h-9 w-44 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                aria-label="Código do cliente no ERP"
              />
              <Button type="submit" size="sm" disabled={atrelando || !codigoErp.trim()}>
                {atrelando ? 'Atrelando…' : 'Atrelar'}
              </Button>
            </form>
          ) : (
            <p className="mt-0.5 text-sm text-warn-soft-foreground">
              Sem código — o financeiro atrela quando incluir no Control.
            </p>
          )}
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <Dado
            rotulo={apenasDigitos(cliente.cnpj).length === 11 ? 'CPF' : 'CNPJ'}
            valor={cliente.cnpj ? formatarDocumento(cliente.cnpj) : null}
          />
          {/* De quem é o cliente: o representante do código do Control e, se
              for outro, quem cadastrou no app. Sem `dono`, a API é anterior. */}
          {cliente.dono && (
            <>
              <Dado rotulo="Representante" valor={linhasDoDono(cliente.dono).representante} />
              <Dado rotulo="Cadastrado por" valor={linhasDoDono(cliente.dono).cadastradoPor} />
            </>
          )}
          <Dado rotulo="Inscrição Estadual" valor={cliente.inscricao_estadual ?? null} />
          <Dado rotulo="Limite de crédito" valor={cliente.credit_limit != null ? formatBRL(cliente.credit_limit) : null} />
          <Dado
            rotulo="WhatsApp"
            valor={cliente.whatsapp}
            icone={MessageCircle}
            href={cliente.whatsapp ? linkDoWhatsApp(cliente.whatsapp) : undefined}
          />
          <Dado rotulo="E-mail" valor={cliente.email} icone={Mail} />
          {cliente.logradouro ? (
            <>
              <div className="sm:col-span-2">
                <Dado
                  rotulo="Endereço"
                  valor={[cliente.logradouro, [cliente.numero, cliente.complemento].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ')}
                  icone={MapPin}
                />
              </div>
              <Dado rotulo="Bairro" valor={cliente.bairro ?? null} />
              <Dado
                rotulo="Cidade / UF"
                valor={[cliente.cidade, cliente.uf].filter(Boolean).join(' / ') || null}
              />
              <Dado rotulo="CEP" valor={cliente.cep ? formatarCep(cliente.cep) : null} />
            </>
          ) : (
            <div className="sm:col-span-2">
              <Dado rotulo="Endereço" valor={cliente.address} icone={MapPin} />
            </div>
          )}
          {cliente.observacoes && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Observações (vão no pedido)</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{cliente.observacoes}</dd>
            </div>
          )}
        </dl>

        {/* Bloqueado no Control não trava a venda (decisão 8 de 16/09/2026):
            o botão fica, o selo acima avisa. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {/* O relacionamento não vende — seleciona e encaminha. */}
          {user?.role !== 'relacionamento' && (
            <Button onClick={() => void navigate(`/orders/new?customer_id=${cliente.id}`)}>
              <ShoppingCart className="h-4 w-4" strokeWidth={2.5} />
              Novo pedido
            </Button>
          )}
          {/* O fluxo da Bruna: ligou pro cliente parado, combinou a visita,
              marca aqui — cai na Minha Área do representante dono da
              carteira, que dá o OK. Só o escritório vê este botão. */}
          {ehEscritorio && (
            <Button variant="outline" onClick={() => setMarcando((v) => !v)}>
              <CalendarClock className="h-4 w-4" strokeWidth={2.5} />
              {marcando ? 'Cancelar' : 'Marcar visita pro rep'}
            </Button>
          )}
          {podeEditarCadastro && (
            <Button variant="outline" onClick={() => setEditandoCadastro(true)}>
              <Pencil className="h-4 w-4" strokeWidth={2.5} />
              Editar cadastro
            </Button>
          )}
          {podeExcluir && (
            <Button variant="outline" className="text-danger" onClick={() => setExcluindo(true)}>
              <Trash2 className="h-4 w-4" strokeWidth={2.5} />
              Excluir cliente
            </Button>
          )}
        </div>

        {marcando && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void marcarVisita();
            }}
            className="mt-3 grid gap-3 rounded-lg bg-sunken p-3 sm:grid-cols-2"
          >
            <input
              value={tituloVisita}
              onChange={(e) => setTituloVisita(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              aria-label="O que o representante deve fazer"
            />
            <input
              type="datetime-local"
              value={prazoVisita}
              onChange={(e) => setPrazoVisita(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              aria-label="Data e horário combinados"
            />
            <input
              value={localVisita}
              onChange={(e) => setLocalVisita(e.target.value)}
              placeholder="Local — endereço, loja, ponto de encontro"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground sm:col-span-2"
              aria-label="Local da visita"
            />
            <textarea
              value={obsVisita}
              onChange={(e) => setObsVisita(e.target.value)}
              placeholder="Observações — o que você apurou na ligação, para o representante chegar preparado"
              rows={2}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground sm:col-span-2"
              aria-label="Observações sobre o cliente"
            />
            <p className="text-[11px] leading-tight text-subtle">
              Vai para a Minha Área do representante da carteira, que dá o OK no horário.
            </p>
            <div className="flex justify-end">
              <Button type="submit" disabled={salvandoVisita || tituloVisita.trim().length < 3}>
                {salvandoVisita ? 'Marcando…' : 'Marcar'}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* ─── O que mudou no cadastro e ainda não chegou ao Control (051) ────
          Sem `alteracoes`, o banco ainda não tem a 051 (ou a API é anterior):
          nada a mostrar. */}
      {cliente.alteracoes && cliente.alteracoes.length > 0 && (
        <AlteracoesParaOControl
          alteracoes={cliente.alteracoes}
          erpId={cliente.erp_id ?? null}
          podeConfirmar={podeConfirmarNoControl}
          online={isOnline}
          ocupado={confirmandoNoControl}
          erro={erroAoConfirmar}
          onConfirmar={(ids) => void confirmarNoControl(ids)}
        />
      )}

      {/* ─── O porquê do cliente vermelho (controle de inatividade) ────────
          Vermelho SEM motivo é pendência: o rep (ou a Bruna) registra por que
          o cliente esfriou e uma observação com as próprias palavras. */}
      {situacao.nivel === 'parado' && (
        <div className="mt-3 rounded-xl border border-danger/30 bg-danger-soft/40 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-danger-soft-foreground">
                Cliente esfriado — {situacao.rotulo.replace('Esfriado — ', '')}
              </p>
              {cliente.inactivity_reason ? (
                <>
                  <p className="mt-1.5 text-sm text-foreground">
                    <span className="text-muted-foreground">Motivo: </span>
                    {cliente.inactivity_reason}
                  </p>
                  {cliente.inactivity_note && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      “{cliente.inactivity_note}”
                    </p>
                  )}
                  {cliente.inactivity_updated_at && (
                    <p className="mt-1 text-[11px] text-subtle">
                      Registrado em {new Date(cliente.inactivity_updated_at).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-danger-soft-foreground">
                  Falta registrar o motivo de este cliente ter parado de comprar.
                </p>
              )}
            </div>
            {podeExplicar && !editandoMotivo && (
              <Button variant="outline" size="sm" onClick={() => setEditandoMotivo(true)}>
                {cliente.inactivity_reason ? 'Editar' : 'Preencher'}
              </Button>
            )}
          </div>

          {editandoMotivo && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void salvarMotivo();
              }}
              className="mt-3 grid gap-3"
            >
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo — fechou, trocou de fornecedor, sem retorno no contato…"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                aria-label="Motivo de o cliente ter esfriado"
              />
              <textarea
                value={obsMotivo}
                onChange={(e) => setObsMotivo(e.target.value)}
                placeholder="Observação com as suas palavras — o que o cliente disse, o que ficou combinado"
                rows={3}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                aria-label="Observação sobre o cliente"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditandoMotivo(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={salvandoMotivo || motivo.trim().length < 2}>
                  {salvandoMotivo ? 'Salvando…' : 'Salvar motivo'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ─── Tabela de preço ──────────────────────────────────────────────── */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Tag className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Tabela de preço</p>
          {cliente.price_table_id ? (
            // Sem o nome quando a tabela é de fora do conjunto de quem olha: ver
            // a tabela da região vizinha é ver informação que não é dele.
            <p className="truncate text-sm font-medium text-foreground">{tabela ?? 'Outra tabela'}</p>
          ) : (
            <p className="truncate text-sm font-medium text-warn-soft-foreground">
              Sem tabela cadastrada
            </p>
          )}
        </div>
        {/* O financeiro não troca tabela de cliente. Desde 17/09/2026 ele edita
            o cadastro (nome, documento, contato, endereço), mas o preço segue
            com quem vende.
            Com uma ativa só, o botão aparece para tirar o cliente de uma tabela
            desligada no Control (podeTrocarTabelaDoCliente). */}
        {podeTrocarTabelaDoCliente(todasAsTabelas, cliente.price_table_id) && user?.role !== 'financeiro' && (
          <Button variant="outline" size="sm" onClick={() => setTrocando(true)}>
            Trocar
          </Button>
        )}
      </div>

      {/* ─── Histórico ────────────────────────────────────────────────────── */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">
        Pedidos
        {cliente.pedidos.length > 0 && (
          <span className="ml-1.5 font-normal text-muted-foreground">({cliente.pedidos.length})</span>
        )}
      </h2>

      {cliente.pedidos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <Receipt className="h-6 w-6 text-subtle" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">Esta loja ainda não fez nenhum pedido.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {cliente.pedidos.map((p) => (
            <li key={p.id} className="border-b border-border last:border-b-0">
              <Link
                to={`/orders/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="tnum text-sm font-medium text-foreground">
                      {p.order_number ? `#${p.order_number}` : 'Rascunho'}
                    </span>
                    <Badge variant={seloDoPedido(p, user?.role).variante}>
                      {seloDoPedido(p, user?.role).texto}
                    </Badge>
                  </div>
                  <p className="tnum mt-0.5 text-xs text-subtle">
                    {new Date(p.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <span className="tnum shrink-0 text-sm font-semibold text-foreground">
                  {formatBRL(p.total)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {trocando && (
        <TrocarTabelaDoCliente
          cliente={{
            id: cliente.id,
            name: cliente.name,
            trade_name: cliente.trade_name,
            cnpj: cliente.cnpj,
            blocked: cliente.blocked,
            block_reason: cliente.block_reason,
            credit_limit: cliente.credit_limit,
            whatsapp: cliente.whatsapp,
            price_table_id: cliente.price_table_id,
            // A ficha não carrega o código do ERP e a troca de tabela não o usa.
            erp_id: null,
          }}
          tabelas={tabelas}
          nomeDe={nomeDe}
          onTrocado={(c) => {
            setCliente({ ...cliente, price_table_id: c.price_table_id });
            setToast({
              message: `Agora compra na ${nomeDe(c.price_table_id) ?? 'tabela escolhida'}.`,
              type: 'success',
            });
          }}
          onErro={(m) => setToast({ message: m, type: 'error' })}
          onFechar={() => setTrocando(false)}
        />
      )}

      {editandoCadastro && (
        <EditarCadastroDoCliente
          cliente={cliente}
          onSalvo={(resposta) => {
            setCliente(resposta.data);
            setEditandoCadastro(false);
            setErroAoConfirmar(null);
            setToast({ message: avisoDoCadastroSalvo(resposta, user?.role), type: 'success' });
          }}
          onRecarregado={setCliente}
          onGravadoApesarDoErro={(aviso) => {
            setEditandoCadastro(false);
            setErroAoConfirmar(null);
            setToast({ message: aviso.mensagem, type: aviso.tipo });
            void relerDepoisDeGravar(aviso);
          }}
          onFechar={() => setEditandoCadastro(false)}
        />
      )}

      {excluindo && (
        <ExcluirCliente
          cliente={cliente}
          onExcluido={(aviso) => void navigate('/customers', { replace: true, state: { aviso } })}
          onFechar={() => setExcluindo(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

function Voltar() {
  return (
    <Link
      to="/customers"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Clientes
    </Link>
  );
}

function Dado({
  rotulo,
  valor,
  icone: Icone,
  href,
}: {
  rotulo: string;
  valor: string | null;
  icone?: typeof MessageCircle;
  href?: string | undefined;
}) {
  if (!valor) return null;
  const conteudo = (
    <span className="flex items-center gap-1.5 text-sm text-foreground">
      {Icone && <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />}
      {valor}
    </span>
  );
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {conteudo}
          </a>
        ) : (
          conteudo
        )}
      </dd>
    </div>
  );
}
