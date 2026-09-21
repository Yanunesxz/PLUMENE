import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, WifiOff, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { api, esquecerCache } from '../../services/api.js';
import { db } from '../../offline/db.js';
import { Button } from '../interface/Button.js';
import { Input } from '../interface/Input.js';
import { Select } from '../interface/Select.js';
import { Textarea } from '../interface/Textarea.js';
import { Spinner } from '../interface/Spinner.js';
import { cn } from '../../lib/utils.js';
import {
  AVISO_DA_EDICAO_SEM_REGISTRO_PARA_O_CONTROL,
  avisoDaReleituraDepoisDoErro,
  avisoDoCadastroMudadoPorFora,
  camposDaListaDoCliente,
  camposRecusadosQueNaoForamMandados,
  edicaoGravadaApesarDoErro,
  edicaoSemRegistroParaOControl,
  edicaoTalvezGravada,
  errosDoServidorNaEdicao,
  fichaDoConflito,
  formularioAposConflito,
  formularioDoCliente,
  fraseDoRodapeComErroNoCampo,
  mensagemDoErroDaEdicao,
  valoresDoCliente,
  type FormularioDoCadastro,
} from '../../lib/edicaoDoCadastro.js';
import {
  avisoDaConsultaDeCep,
  avisoDoCepAntesDeSalvar,
  criarConsultaDeCep,
  precisaConferirOCepAntesDeSalvar,
  preencherComOCep,
  saidaDoCep,
  voltarAoEnderecoDoCadastro,
  type EstadoDoCep,
  type ResultadoDaSaidaDoCep,
} from '../../lib/viaCep.js';
import {
  PECAS_DO_ENDERECO_DO_CLIENTE,
  ROTULO_DO_CAMPO_DO_CADASTRO,
  UFS,
  apenasDigitos,
  camposQueVieram,
  documento,
  formatarCep,
  formatarDocumento,
  linhaForaDasPecas,
  mesmoValorDoCadastro,
  montarEdicaoDoCadastro,
  podeTrocarDocumentoDoCliente,
  rotulosDosCamposAlterados,
  validarEdicaoDoCadastro,
} from '@csb/shared';
import type {
  ApiResponse,
  CampoEditavelDoCliente,
  CustomerDetail,
  EditarCadastroDoClienteResponse,
  ErrosDaEdicaoDoCadastro,
} from '@csb/shared';

interface Props {
  cliente: CustomerDetail;
  /** Salvou (ou não havia o que salvar): a ficha troca pelo cadastro devolvido e fecha o diálogo. */
  onSalvo: (resposta: EditarCadastroDoClienteResponse) => void;
  /** Outra pessoa salvou no meio: a ficha atrás do diálogo também passa a mostrar o cadastro de agora. */
  onRecarregado: (cliente: CustomerDetail) => void;
  /**
   * A API respondeu erro, mas a edição FICOU gravada (500 SALVO_SEM_RELER_A_FICHA
   * ou ALTERACAO_SEM_HISTORICO): o diálogo fecha e a ficha relê o cadastro.
   */
  onGravadoApesarDoErro: (aviso: { mensagem: string; tipo: 'success' | 'error' }) => void;
  onFechar: () => void;
}

/** A ordem dos campos NA TELA — é por ela que o foco procura o primeiro erro. */
const ORDEM_NA_TELA: readonly CampoEditavelDoCliente[] = [
  'name',
  'trade_name',
  'cnpj',
  'inscricao_estadual',
  'whatsapp',
  'email',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
  'observacoes',
];

/**
 * EDITAR O CADASTRO DO CLIENTE.
 *
 * "Não tem como alterar esses dados nem sendo admin lá dentro. Quero poder
 * mudar sim, e quando mudar lá tem que mudar no ERP do Fábio também." (Yan,
 * 17/09/2026)
 *
 * Quem abre: representante e venda interna (na ficha, que já é da carteira
 * dele), gerente, admin e financeiro. O CPF/CNPJ fica travado para quem não é
 * admin nem financeiro — a API recusa do mesmo jeito.
 *
 * O diálogo manda SÓ o que mudou e, de cada campo, o valor que a pessoa viu ao
 * abrir (`vistos`). Se outra pessoa salvou no meio, a API recusa (409) em vez
 * de apagar a edição do outro, e o formulário recarrega o que mudou.
 *
 * A régua dos campos é a mesma do servidor (@csb/shared): o aviso sai aqui,
 * antes de mandar, com a mesma frase que a API daria.
 *
 * Só online. A edição precisa ir para o histórico que leva a mudança ao
 * Control — guardar para depois abriria a porta para duas edições do mesmo
 * cliente se cruzarem sem ninguém ver.
 */
export function EditarCadastroDoCliente({ cliente, onSalvo, onRecarregado, onGravadoApesarDoErro, onFechar }: Props) {
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();
  const prefixo = useId();
  const idDo = (campo: CampoEditavelDoCliente) => `${prefixo}-${campo}`;
  const podeTrocarDocumento = podeTrocarDocumentoDoCliente(user?.role);

  // O cadastro que a pessoa VIU. Só muda quando o servidor manda um mais novo
  // (409): é dele que saem os `vistos`.
  const [base, setBase] = useState<CustomerDetail>(cliente);
  const [form, setForm] = useState<FormularioDoCadastro>(() => formularioDoCliente(cliente));
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [errosDoServidor, setErrosDoServidor] = useState<ErrosDaEdicaoDoCadastro>({});
  const [erro, setErro] = useState('');
  const [conflito, setConflito] = useState('');
  const [atualizados, setAtualizados] = useState<CampoEditavelDoCliente[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [avisoDoCep, setAvisoDoCep] = useState('');
  /** A frase do rodapé quando o Salvar parou para conferir o CEP. */
  const [avisoAntesDeSalvar, setAvisoAntesDeSalvar] = useState('');
  /** O campo que o servidor recusou: recebe o foco quando o formulário destrava. */
  const [focarDepois, setFocarDepois] = useState<CampoEditavelDoCliente | null>(null);
  const [consultaDeCep] = useState(() => criarConsultaDeCep());
  /** O último CEP consultado — sair do campo duas vezes não consulta duas vezes. */
  const cepConsultado = useRef('');
  /** O CEP cuja consulta pôs rua, bairro, cidade e UF nos campos ('' = nenhuma). */
  const cepDoPreenchimento = useRef('');
  /** O CEP que o Salvar já parou para conferir — a consulta que falhou não trava o Salvar. */
  const cepConferidoAoSalvar = useRef('');
  /** Os campos em que a pessoa digitou. O CEP nunca troca o que está aqui. */
  const digitados = useRef(new Set<CampoEditavelDoCliente>());
  const caixa = useRef<HTMLDivElement>(null);
  const corpo = useRef<HTMLDivElement>(null);

  const atual = useMemo(() => valoresDoCliente(base), [base]);
  const edicao = useMemo(() => {
    // Quem não troca documento não manda documento — nem por engano: a API
    // responderia 403 e a edição inteira se perderia por um campo travado.
    const formulario: Partial<FormularioDoCadastro> = { ...form };
    if (!podeTrocarDocumento) delete formulario.cnpj;
    return montarEdicaoDoCadastro(atual, formulario);
  }, [atual, form, podeTrocarDocumento]);
  const mudancas = camposQueVieram(edicao.novo);
  const documentoMudou = podeTrocarDocumento && !mesmoValorDoCadastro('cnpj', atual.cnpj, form.cnpj);
  const digitosDoDocumento = apenasDigitos(form.cnpj).length;
  // Só quando o número PODE estar pronto (11 = CPF, 14 = CNPJ): avisando aos 11
  // dígitos, quem digita CNPJ lê "inválido" no meio e apaga o que estava certo.
  const documentoInvalido =
    documentoMudou && (digitosDoDocumento === 11 || digitosDoDocumento >= 14) && !documento(form.cnpj);
  // Os erros só aparecem depois da primeira tentativa de salvar; daí em diante
  // somem enquanto a pessoa corrige, sem precisar tocar em Salvar de novo. O
  // documento é a exceção: avisa já, assim que o número fica completo.
  const errosLocais = useMemo(
    () => (tentouSalvar ? validarEdicaoDoCadastro(atual, edicao.novo) : {}),
    [tentouSalvar, atual, edicao],
  );
  const erros: ErrosDaEdicaoDoCadastro = {
    ...(documentoInvalido ? { cnpj: 'Este número não é um CPF/CNPJ válido.' } : {}),
    ...errosLocais,
    ...errosDoServidor,
  };

  // Foco no diálogo ao abrir (sem abrir o teclado do celular num campo) e de
  // volta ao botão que o abriu ao fechar.
  useEffect(() => {
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    caixa.current?.focus({ preventScroll: true });
    return () => antes?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !salvando) onFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [salvando, onFechar]);

  const focar = (campo: CampoEditavelDoCliente) => document.getElementById(idDo(campo))?.focus();

  // O foco no campo que o SERVIDOR recusou só depois de destravar (revisão de
  // 17/09/2026). O catch do salvar roda com o fieldset que trava o formulário
  // ainda travado — o setSalvando(false) do finally só chega ao DOM no próximo
  // render —, e campo dentro de fieldset travado não recebe foco: a tela não
  // rolava até o erro, e quem tocou em Salvar lá embaixo via "nada acontecer".
  useEffect(() => {
    if (salvando || !focarDepois) return;
    document.getElementById(`${prefixo}-${focarDepois}`)?.focus();
    setFocarDepois(null);
  }, [salvando, focarDepois, prefixo]);

  const mudar = (campo: CampoEditavelDoCliente, valor: string) => {
    digitados.current.add(campo);
    setForm((f) => ({ ...f, [campo]: valor }));
    if (errosDoServidor[campo]) {
      const resto = { ...errosDoServidor };
      delete resto[campo];
      setErrosDoServidor(resto);
      // O último campo recusado foi corrigido: a frase do rodapé que apontava
      // para ele também sai.
      if (Object.keys(resto).length === 0) setErro('');
    }
    if (atualizados.includes(campo)) setAtualizados((a) => a.filter((c) => c !== campo));
    if (campo === 'cep') {
      // Mexeu no CEP: a consulta em voo é de outro endereço.
      consultaDeCep.esquecer();
      cepConsultado.current = '';
      cepConferidoAoSalvar.current = '';
      setBuscandoCep(false);
      setAvisoDoCep('');
    }
  };

  const estadoDoCep = (): EstadoDoCep<FormularioDoCadastro> => ({
    form,
    cepDoCadastro: base.cep,
    doCadastro: formularioDoCliente(base),
    digitado: (c) => digitados.current.has(c),
    cepConsultado: cepConsultado.current,
    cepDoPreenchimento: cepDoPreenchimento.current,
    online: isOnline,
  });

  // O CEP preenche o endereço (ViaCEP) — só online; sem rede a pessoa digita.
  // Nunca troca o que a pessoa digitou. Mas, se o CEP MUDOU, troca a rua, o
  // bairro, a cidade e a UF que vieram do cadastro: são do endereço antigo. E,
  // de volta ao CEP do cadastro, desfaz o que a consulta de OUTRO CEP pôs nos
  // campos (a decisão mora em `saidaDoCep`, testada sem navegador).
  const aoSairDoCep = async (): Promise<ResultadoDaSaidaDoCep> => {
    const estado = estadoDoCep();
    const saida = saidaDoCep(estado);
    cepDoPreenchimento.current = saida.cepDoPreenchimento;
    setForm((f) => {
      const g = saida.voltou ? voltarAoEnderecoDoCadastro(f, estado.doCadastro, estado.digitado) : f;
      return { ...g, cep: formatarCep(g.cep) };
    });
    if (saida.aviso) setAvisoDoCep(saida.aviso);
    const digitos = saida.consultar;
    if (!digitos) return saida.voltou ? 'voltou' : 'nada';
    cepConsultado.current = digitos;
    setBuscandoCep(true);
    setAvisoDoCep('');
    const r = await consultaDeCep.consultar(digitos);
    // Outro CEP foi pedido depois (ou a pessoa mexeu no campo): esta resposta
    // é de outro endereço e vai para o lixo.
    if (r === null) return 'descartado';
    setBuscandoCep(false);
    if (r.situacao === 'encontrado') {
      cepDoPreenchimento.current = digitos;
      setForm((f) => preencherComOCep(f, r.endereco, (c) => saida.cepMudou && !digitados.current.has(c)));
      return 'encontrado';
    }
    setAvisoDoCep(avisoDaConsultaDeCep(r) ?? '');
    // Falhou por rede: sair do campo de novo tenta outra vez.
    if (r.situacao === 'falhou') cepConsultado.current = '';
    return r.situacao;
  };

  const guardarNaLista = async (c: CustomerDetail) => {
    // A lista, a busca e o novo pedido leem o cache do aparelho: sem isto o
    // nome e o WhatsApp antigos ficariam lá até a próxima sincronização.
    await db.customers.update(c.id, camposDaListaDoCliente(c)).catch(() => {});
    esquecerCache('/customers');
  };

  /** A frase do 409 MUDOU_DE_NOVO depois de recarregar. */
  const fraseDoConflito = (mudaram: CampoEditavelDoCliente[]) => {
    const rotulos = rotulosDosCamposAlterados(mudaram);
    return rotulos.length > 0
      ? `O cadastro mudou enquanto você editava (${rotulos.join(', ')}). Os campos marcados já estão com os dados de agora — confira e salve de novo.`
      : 'O cadastro mudou enquanto você editava. Os dados abaixo são os de agora — confira e salve de novo.';
  };

  /**
   * 409 MUDOU_DE_NOVO: traz o cadastro de agora para o formulário, sem perder o
   * que só esta pessoa mudou. A ficha de agora vem na própria resposta do 409;
   * sem ela, relê pelo GET.
   *
   * Serve também o erro que deixa a gravação em dúvida (17/09/2026): aí a frase
   * é outra — não houve "outra pessoa" — e, sem conseguir reler, vale a
   * mensagem do próprio erro.
   */
  const recarregar = async (
    daResposta: CustomerDetail | null,
    frase: (mudaram: CampoEditavelDoCliente[]) => string = fraseDoConflito,
    seNaoReler = 'O cadastro mudou enquanto você editava e não deu para carregar os dados de agora. Nada foi salvo — feche e abra a ficha de novo.',
  ): Promise<CustomerDetail | null> => {
    if (!token) return null;
    try {
      const agora = daResposta ?? (await api.get<ApiResponse<CustomerDetail>>(`/customers/${base.id}`, token)).data;
      const antes = base;
      const { mudaram } = formularioAposConflito(form, antes, agora);
      setBase(agora);
      setForm((f) => formularioAposConflito(f, antes, agora).formulario);
      setErrosDoServidor({});
      setAtualizados(mudaram);
      onRecarregado(agora);
      await guardarNaLista(agora);
      setConflito(frase(mudaram));
      // O aviso mora no topo do formulário; quem tocou em Salvar está lá embaixo.
      if (corpo.current) corpo.current.scrollTop = 0;
      return agora;
    } catch {
      setErro(seNaoReler);
      return null;
    }
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || salvando || buscandoCep) return;
    setErro('');
    setConflito('');
    setAvisoAntesDeSalvar('');
    setAtualizados([]);
    if (!isOnline) {
      setErro('Precisa de internet para salvar o cadastro.');
      return;
    }
    if (mudancas.length === 0) return;
    // O CEP que a consulta ainda não viu (revisão de 17/09/2026): o Enter dentro
    // do campo do CEP envia sem tirar o foco dele (sem a saída do campo, sem
    // consulta), e o CEP trocado sem internet não é consultado quando a rede
    // volta — ia ao Control o CEP novo com a rua e a cidade do antigo. Confere
    // agora e para: a pessoa vê o endereço e toca em Salvar de novo.
    const saidaAgora = saidaDoCep(estadoDoCep());
    if (precisaConferirOCepAntesDeSalvar(saidaAgora, cepConferidoAoSalvar.current)) {
      cepConferidoAoSalvar.current = apenasDigitos(form.cep);
      const r = await aoSairDoCep();
      setAvisoAntesDeSalvar(avisoDoCepAntesDeSalvar(saidaAgora.voltou ? 'voltou' : r));
      return;
    }
    setTentouSalvar(true);
    const errosAgora = validarEdicaoDoCadastro(atual, edicao.novo);
    const primeiro = ORDEM_NA_TELA.find((c) => errosAgora[c]);
    if (primeiro) {
      focar(primeiro);
      return;
    }

    setSalvando(true);
    try {
      const res = await api.patch<EditarCadastroDoClienteResponse>(`/customers/${base.id}/cadastro`, edicao, token);
      await guardarNaLista(res.data);
      onSalvo(res);
    } catch (err) {
      // Erro que diz que a edição ficou gravada (17/09/2026): tratado como falha,
      // o diálogo seguia aberto sobre a ficha velha, e salvar de novo levava um
      // falso "o cadastro mudou enquanto você editava" pela própria edição.
      const gravada = edicaoGravadaApesarDoErro(err, user?.role);
      if (gravada) {
        esquecerCache('/customers');
        onGravadoApesarDoErro(gravada);
        return;
      }
      const codigo = (err as Error & { code?: string }).code;
      const errosDoCampo = codigo === 'VALIDATION_ERROR' ? errosDoServidorNaEdicao(err) : {};
      const primeiroDoServidor = ORDEM_NA_TELA.find((c) => errosDoCampo[c]);
      const naoMandados = camposRecusadosQueNaoForamMandados(errosDoCampo, edicao.novo);
      if (codigo === 'MUDOU_DE_NOVO') {
        await recarregar(fichaDoConflito(err, base.id));
      } else if (edicaoTalvezGravada(err)) {
        // O banco não confirmou, ou a resposta se perdeu (17/09/2026): a edição
        // pode ter ficado. Relê antes de a pessoa tentar de novo — o formulário
        // e a ficha atrás dele passam a mostrar o cadastro de agora. Sem reler,
        // fica a mensagem do próprio erro.
        esquecerCache('/customers');
        const relida = await recarregar(null, avisoDaReleituraDepoisDoErro, mensagemDoErroDaEdicao(err));
        // A ficha relida já está com o que foi enviado e sem pendência dele: o
        // cadastro mudou SEM o registro que leva a mudança ao Control (o 503
        // volta antes de gravá-lo). A frase da releitura sozinha soava sucesso,
        // e o estado só aparecia no log do servidor.
        if (relida && edicaoSemRegistroParaOControl(err, edicao.novo, relida)) {
          setErro(AVISO_DA_EDICAO_SEM_REGISTRO_PARA_O_CONTROL);
        }
      } else if (naoMandados.length > 0) {
        // O servidor recusou um campo que a tela NEM MANDOU (17/09/2026): o
        // cadastro mudou por fora e ficou incompleto (o endereço é validado como
        // grupo). Marcar o campo deixava a frase "Bairro é obrigatório" embaixo
        // de um bairro preenchido, e digitar o mesmo valor não saía do lugar —
        // beco sem saída. Relê, como no 409: o campo aparece como está no banco.
        esquecerCache('/customers');
        await recarregar(
          null,
          avisoDoCadastroMudadoPorFora,
          'O cadastro mudou por fora e ficou incompleto, e não deu para carregar os dados de agora. Nada foi salvo — feche e abra a ficha de novo.',
        );
      } else if (codigo === 'DOCUMENTO_DUPLICADO') {
        setErrosDoServidor((x) => ({ ...x, cnpj: mensagemDoErroDaEdicao(err) }));
        setErro(fraseDoRodapeComErroNoCampo(['cnpj']));
        setFocarDepois('cnpj');
      } else if (primeiroDoServidor) {
        // A frase vai embaixo de cada campo, como a da régua local; o rodapé diz
        // onde olhar, e o foco vai ao primeiro quando o formulário destravar.
        setErrosDoServidor(errosDoCampo);
        setErro(fraseDoRodapeComErroNoCampo(ORDEM_NA_TELA.filter((c) => errosDoCampo[c])));
        setFocarDepois(primeiroDoServidor);
      } else {
        setErro(mensagemDoErroDaEdicao(err));
      }
    } finally {
      setSalvando(false);
    }
  };

  // ─── O que a tela precisa saber ─────────────────────────────────────────────
  const nome = base.trade_name?.trim() || base.name;
  const mexeuNoEndereco = PECAS_DO_ENDERECO_DO_CLIENTE.some((p) => !mesmoValorDoCadastro(p, atual[p], form[p]));
  // Cliente legado (só a linha `address`, ~2.600 na CS): o endereço em campos
  // é opcional até alguém mexer nele — aí vai inteiro, como no cadastro novo.
  const enderecoLegado = !base.logradouro;
  // A linha do cadastro diz outra coisa que os campos (gravada por fora, 17/09/2026):
  // mexer em qualquer campo do endereço a troca pela montada dos campos — a pessoa
  // precisa ver o que vai ser trocado.
  const linhaDiferenteDosCampos = !enderecoLegado && linhaForaDasPecas(base.address, atual);
  const enderecoObrigatorio = !enderecoLegado || mexeuNoEndereco;
  const ufForaDaLista = form.uf !== '' && !(UFS as readonly string[]).includes(form.uf);

  const ligar = (campo: CampoEditavelDoCliente, opcoes: { obrigatorio?: boolean; ajuda?: boolean } = {}) => {
    const id = idDo(campo);
    const descricao = [erros[campo] ? `${id}-erro` : '', opcoes.ajuda ? `${id}-ajuda` : ''].filter(Boolean).join(' ');
    return {
      id,
      value: form[campo],
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        mudar(campo, e.target.value),
      'aria-invalid': erros[campo] ? true : undefined,
      'aria-required': opcoes.obrigatorio ? true : undefined,
      'aria-describedby': descricao || undefined,
      // O campo que outra pessoa mudou enquanto esta editava fica marcado.
      className: atualizados.includes(campo) ? 'border-warn ring-1 ring-warn' : undefined,
    };
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${prefixo}-titulo`}
    >
      {/* Com alteração digitada, o toque fora NÃO fecha: no celular é fácil
          encostar no fundo e perder o formulário inteiro. Fechar é pelo X ou
          por Cancelar. */}
      <div
        className="absolute inset-0 bg-foreground/40"
        onClick={() => {
          if (!salvando && mudancas.length === 0) onFechar();
        }}
        aria-hidden
      />
      <div
        ref={caixa}
        tabIndex={-1}
        className="animate-slide-up relative flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-card shadow-xl outline-none sm:max-h-[90vh] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-3 pt-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Editar cadastro</p>
            <h2 id={`${prefixo}-titulo`} className="truncate text-[15px] font-semibold text-foreground">
              {nome}
            </h2>
            <p className="text-xs text-muted-foreground">
              {base.erp_id ? `Código no Control: ${base.erp_id}` : 'Ainda sem código no Control'}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-muted disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void salvar(e)} noValidate className="flex min-h-0 flex-1 flex-col">
          <div ref={corpo} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {/* Travado enquanto salva (17/09/2026): o que se digitasse durante o
                "Salvando…" não ia no pedido já enviado, e o 200 fechava o diálogo
                com "Cadastro salvo" — a correção sumia calada. */}
            <fieldset disabled={salvando} className="min-w-0 space-y-5">
              {conflito && (
                <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-soft-foreground">
                  {conflito}
                </p>
              )}

              {/* ─── Empresa ─────────────────────────────────────────────────── */}
              <fieldset className="space-y-3">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Empresa
                </legend>
                <Campo id={idDo('name')} rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.name} obrigatorio erro={erros.name}>
                  <Input {...ligar('name', { obrigatorio: true })} maxLength={200} autoComplete="off" />
                </Campo>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo id={idDo('trade_name')} rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.trade_name} erro={erros.trade_name}>
                    <Input {...ligar('trade_name')} maxLength={200} autoComplete="off" />
                  </Campo>
                  <Campo
                    id={idDo('inscricao_estadual')}
                    rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.inscricao_estadual}
                    erro={erros.inscricao_estadual}
                  >
                    <Input
                      {...ligar('inscricao_estadual')}
                      maxLength={30}
                      placeholder="Opcional (ou ISENTO)"
                      autoComplete="off"
                    />
                  </Campo>
                </div>
                <Campo
                  id={idDo('cnpj')}
                  rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.cnpj}
                  obrigatorio={podeTrocarDocumento}
                  erro={erros.cnpj}
                  ajuda={
                    podeTrocarDocumento
                      ? undefined
                      : 'Só o financeiro ou o administrador trocam o CPF/CNPJ.'
                  }
                >
                  <Input
                    {...ligar('cnpj', { obrigatorio: podeTrocarDocumento, ajuda: !podeTrocarDocumento })}
                    disabled={!podeTrocarDocumento}
                    onBlur={() => setForm((f) => ({ ...f, cnpj: formatarDocumento(f.cnpj) }))}
                    placeholder="00.000.000/0000-00"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </Campo>
                {documentoMudou && base.erp_id && (
                  <p className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                    <span>
                      Este cliente já está no Control (código {base.erp_id}) — o documento lá também precisa mudar.
                    </span>
                  </p>
                )}
              </fieldset>

              {/* ─── Contato ─────────────────────────────────────────────────── */}
              <fieldset className="space-y-3">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Contato
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo id={idDo('whatsapp')} rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.whatsapp} erro={erros.whatsapp}>
                    <Input
                      {...ligar('whatsapp')}
                      maxLength={30}
                      placeholder="(00) 00000-0000"
                      inputMode="tel"
                      autoComplete="off"
                    />
                  </Campo>
                  <Campo id={idDo('email')} rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.email} erro={erros.email}>
                    <Input
                      {...ligar('email')}
                      type="email"
                      maxLength={200}
                      placeholder="cliente@email.com"
                      autoCapitalize="none"
                      autoComplete="off"
                    />
                  </Campo>
                </div>
              </fieldset>

              {/* ─── Endereço ────────────────────────────────────────────────── */}
              <fieldset className="space-y-3">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Endereço
                </legend>
                {linhaDiferenteDosCampos && (
                  <div className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
                    <p>
                      <span className="font-medium">Endereço atual no cadastro:</span> {base.address}
                    </p>
                    <p className="mt-1">
                      Esta linha não bate com os campos abaixo. Se você mexer em qualquer campo do endereço, ela
                      passa a ser montada dos campos — confira todos antes de salvar.
                    </p>
                  </div>
                )}
                {enderecoLegado && (
                  <div className="rounded-lg bg-sunken px-3 py-2 text-xs text-muted-foreground">
                    {base.address ? (
                      <p>
                        <span className="font-medium text-foreground">Endereço atual:</span> {base.address}
                      </p>
                    ) : (
                      <p className="font-medium text-foreground">Sem endereço em campos.</p>
                    )}
                    <p className="mt-1">
                      Para mudar, preencha o endereço inteiro abaixo. Em branco, o endereço de hoje fica como está.
                    </p>
                  </div>
                )}
                <Campo
                  id={idDo('cep')}
                  rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.cep}
                  obrigatorio={enderecoObrigatorio}
                  erro={erros.cep}
                >
                  <Input
                    {...ligar('cep', { obrigatorio: enderecoObrigatorio })}
                    onBlur={() => void aoSairDoCep()}
                    maxLength={9}
                    placeholder="00000-000"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </Campo>
                <div aria-live="polite">
                  {buscandoCep && <p className="text-xs text-muted-foreground">Buscando o endereço…</p>}
                  {!buscandoCep && avisoDoCep && <p className="text-xs text-warn-soft-foreground">{avisoDoCep}</p>}
                </div>
                <Campo
                  id={idDo('logradouro')}
                  rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.logradouro}
                  obrigatorio={enderecoObrigatorio}
                  erro={erros.logradouro}
                >
                  <Input
                    {...ligar('logradouro', { obrigatorio: enderecoObrigatorio })}
                    maxLength={200}
                    placeholder="Rua, avenida…"
                    autoComplete="off"
                  />
                </Campo>
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                  <Campo
                    id={idDo('numero')}
                    rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.numero}
                    obrigatorio={enderecoObrigatorio}
                    erro={erros.numero}
                  >
                    <Input
                      {...ligar('numero', { obrigatorio: enderecoObrigatorio })}
                      maxLength={20}
                      placeholder="123"
                      autoComplete="off"
                    />
                  </Campo>
                  <Campo id={idDo('complemento')} rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.complemento} erro={erros.complemento}>
                    <Input
                      {...ligar('complemento')}
                      maxLength={100}
                      placeholder="Sala, loja, fundos…"
                      autoComplete="off"
                    />
                  </Campo>
                </div>
                <Campo
                  id={idDo('bairro')}
                  rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.bairro}
                  obrigatorio={enderecoObrigatorio}
                  erro={erros.bairro}
                >
                  <Input
                    {...ligar('bairro', { obrigatorio: enderecoObrigatorio })}
                    maxLength={100}
                    autoComplete="off"
                  />
                </Campo>
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <Campo
                    id={idDo('cidade')}
                    rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.cidade}
                    obrigatorio={enderecoObrigatorio}
                    erro={erros.cidade}
                  >
                    <Input
                      {...ligar('cidade', { obrigatorio: enderecoObrigatorio })}
                      maxLength={100}
                      autoComplete="off"
                    />
                  </Campo>
                  <Campo
                    id={idDo('uf')}
                    rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.uf}
                    obrigatorio={enderecoObrigatorio}
                    erro={erros.uf}
                  >
                    <Select {...ligar('uf', { obrigatorio: enderecoObrigatorio })}>
                      <option value="">UF</option>
                      {/* UF antiga fora da lista (carga legada): aparece como está,
                          em vez de o seletor fingir que o campo está vazio. */}
                      {ufForaDaLista && <option value={form.uf}>{form.uf}</option>}
                      {UFS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                </div>
              </fieldset>

              <Campo
                id={idDo('observacoes')}
                rotulo={ROTULO_DO_CAMPO_DO_CADASTRO.observacoes}
                erro={erros.observacoes}
                ajuda="Vão junto no pedido, como no Control — horário de entrega, referência, recado da loja."
              >
                <Textarea {...ligar('observacoes', { ajuda: true })} rows={3} maxLength={2000} />
              </Campo>
            </fieldset>
          </div>

          <div
            className="border-t border-border px-5 pt-3"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {erro && (
              <p role="alert" className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
                {erro}
              </p>
            )}
            {avisoAntesDeSalvar && (
              <p role="alert" className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-soft-foreground">
                {avisoAntesDeSalvar}
              </p>
            )}
            <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
              {mudancas.length === 0
                ? 'Nenhuma alteração ainda.'
                : `Alterado: ${rotulosDosCamposAlterados(mudancas).join(', ')}.`}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onFechar} disabled={salvando}>
                Cancelar
              </Button>
              {/* Travado enquanto o CEP consulta: o toque em Salvar tira o foco do CEP,
                  e salvar nesse instante mandaria o CEP novo com a rua velha. */}
              <Button type="submit" disabled={salvando || buscandoCep || !isOnline || mudancas.length === 0}>
                {salvando ? (
                  <>
                    <Spinner />
                    Salvando…
                  </>
                ) : !isOnline ? (
                  <>
                    <WifiOff className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                    Precisa de internet
                  </>
                ) : (
                  'Salvar cadastro'
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Campo({
  id,
  rotulo,
  obrigatorio,
  erro,
  ajuda,
  className,
  children,
}: {
  id: string;
  rotulo: string;
  obrigatorio?: boolean | undefined;
  erro?: string | undefined;
  ajuda?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {rotulo}
        {obrigatorio && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {ajuda && (
        <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
          {ajuda}
        </p>
      )}
      {erro && (
        <p id={`${id}-erro`} className="text-xs text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
