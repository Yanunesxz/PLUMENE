import type { OrderStatus } from '../constants/orderStatus.js';

// ─── Tabela de preço ──────────────────────────────────────────────────────────
export interface PriceTable {
  id: string;
  company_id: string;
  /** Código ERP — TABELA_PRECO.TABELA_PRECO */
  erp_code: string | null;
  name: string;
  /**
   * Coluna de preço a usar (1–6) — campo COLUNA_TABELA_PRECO do pedido ERP.
   * Corresponde a PRECO1…PRECO6 na ITENS_TABELA_PRECO.
   * Padrão: 1
   */
  price_column: number;
  /**
   * Como o Control descreve a tabela (migração 049). `name` continua sendo o
   * nome do app — o CRM casa por ele e a API nunca o regrava.
   */
  erp_description?: string | null;
  /** Quando o Control mandou esta tabela pela última vez. */
  erp_updated_at?: string | null;
  /** Tabela desativada no Control não some: pedido antigo aponta para ela. */
  active?: boolean;
}

// ─── Cliente ──────────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  company_id: string;
  /** Código ERP — CLIENTE.CLIENTE (CHAR 5) */
  erp_id: string | null;
  /** Razão Social — CLIENTE.RAZAO_SOCIAL */
  name: string;
  /** Nome Fantasia — CLIENTE.NOME_FANTASIA */
  trade_name: string | null;
  /** CNPJ ou CPF */
  cnpj: string | null;
  /** Código do representante vinculado — CLIENTE.REPRESENTANTE */
  rep_erp_id: string | null;
  /** Quem cadastrou no app (migração 007). Nulo = veio do ERP ou de carga. */
  rep_id?: string | null;
  price_table_id: string | null;
  /** CLIENTE.BLOQUEADO = 'S' */
  blocked: boolean;
  /** CLIENTE.TEXTO_BLOQUEIO (blob) */
  block_reason: string | null;
  /** Limite de crédito — CLIENTE.LIMITE_CREDITO */
  credit_limit: number | null;
  /** WhatsApp principal */
  whatsapp: string | null;
  /** E-mail */
  email: string | null;
  /** Endereço em UMA linha — montado dos campos abaixo (ver linhaDeEndereco). */
  address: string | null;
  /**
   * Cadastro real (migração 041): o endereço como o Control pede, em campos
   * separados, mais a Inscrição Estadual e as observações que o Control
   * insere no pedido. Opcionais no TIPO porque cliente vindo do ERP/cargas
   * antigas não tem; obrigatórios no cadastro novo pelo app (schema da API).
   */
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  inscricao_estadual?: string | null;
  /** "Observações (será inserido no pedido)" — o campo do Control. */
  observacoes?: string | null;
  /** Quem atrelou o código do ERP a um cliente nascido no app, e quando. */
  erp_linked_by?: string | null;
  erp_linked_at?: string | null;
  /**
   * Última compra (migração 036): retrato do Control (Curva ABC) empurrado
   * para frente por todo pedido FATURADO no app. NULL = sem registro.
   */
  last_purchase_at?: string | null;
  /** R$ Total Comprado do Control — retrato, o app não atualiza. */
  total_purchased?: number | null;
  /** R$ Vencido do Control — retrato, o app não atualiza. */
  overdue_amount?: number | null;
  /**
   * Controle de inatividade (migração 039): quando o cliente fica VERMELHO
   * (180+ dias sem comprar), o rep ou o relacionamento registram o porquê.
   */
  inactivity_reason?: string | null;
  /** Observação com as palavras de quem apurou. */
  inactivity_note?: string | null;
  inactivity_updated_at?: string | null;
  /**
   * Cliente de VAREJO (migração 047): a venda interna marca quem compra no
   * balcão e não volta. Fica fora da régua da carteira — sem atenção, sem
   * esfriado, sem alerta de contato.
   */
  varejo?: boolean | null;
  /**
   * O que o Control passou a mandar (migração 049): quando mandou este
   * cadastro pela última vez; de quando é o retrato (última compra, total
   * comprado, vencido); e a pendência financeira — R$ em aberto, quando esse
   * valor chegou e quantos títulos vencidos. Bloqueio do Control NÃO trava o
   * representante: o financeiro é avisado.
   */
  erp_updated_at?: string | null;
  retrato_referencia_em?: string | null;
  pendencia_financeira?: number | null;
  pendencia_financeira_em?: string | null;
  titulos_vencidos?: number | null;
  updated_at: string;
}

/**
 * Cliente como a lista do app recebe. Subconjunto deliberado de `Customer`: são
 * os campos que as telas realmente usam. A lista completa (1.353 clientes em
 * produção) vai inteira para o cache offline, então cada coluna a mais é peso
 * no 3G do representante — mandar `Customer` inteiro custava 5× isto.
 */
export interface CustomerListItem
  extends Pick<
    Customer,
    | 'id'
    | 'name'
    | 'trade_name'
    | 'cnpj'
    | 'blocked'
    | 'block_reason'
    | 'credit_limit'
    | 'whatsapp'
    // Qual tabela precifica este cliente. Custa 36 caracteres por linha e evita
    // uma segunda requisição por cartão; o rep com duas tabelas ou mais precisa
    // ver isso na lista para saber o que está prestes a mudar.
    | 'price_table_id'
    // O código do cliente NO CONTROL. Pesa ~5 caracteres e é o que o
    // financeiro confere no pedido antes de lançar no ERP.
    | 'erp_id'
    // A carteira inteligente: a data diz quem parou de comprar, o vencido diz
    // quem precisa de cobrança. ~15 caracteres por linha, e é o que transforma
    // a lista de clientes numa ferramenta de trabalho do representante.
    | 'last_purchase_at'
    | 'overdue_amount'
    // O controle por cores: cliente vermelho SEM motivo é pendência visível na
    // lista — é o que cobra o preenchimento sem precisar de relatório.
    | 'inactivity_reason'
    // Varejo marcado pela venda interna: sem ele a lista voltaria a pintar de
    // vermelho — e a cobrar — o cliente de balcão que nunca vai voltar.
    | 'varejo'
  > {
  /**
   * Quem CADASTROU no app. Custa um UUID por linha e separa as duas famílias
   * de cliente sem código do ERP: os 29 que nasceram aqui (fila real da
   * Larissa: incluir no Control) e os ~1.225 que vieram das cargas da Curva
   * ABC — esses já existem no Control, só chegaram sem o código. Sem esta
   * coluna o aviso "para incluir" contaria 1.254 e viraria ruído.
   */
  rep_id?: string | null;
}

/** A venda interna marca (ou desmarca) o cliente como varejo. */
export interface MarcarVarejoRequest {
  varejo: boolean;
}

/** O rep (ou o relacionamento) explica o cliente vermelho. */
export interface MarcarInatividadeRequest {
  motivo: string;
  observacao?: string;
}

/**
 * O cadastro de cliente pelo app — "mais real", igual ao do Control (Yan,
 * 10/09/2026): CPF/CNPJ com dígito verificador, endereço estruturado com CEP
 * obrigatório. Os campos ficam opcionais NO TIPO (o service é chamado por
 * cargas e testes que não têm tudo); quem obriga é o schema da rota.
 */
export interface CreateCustomerRequest {
  name: string;
  trade_name?: string | null;
  cnpj?: string | null;
  inscricao_estadual?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  observacoes?: string | null;
  /** Linha pronta. Só para quem não tem os campos separados (cargas antigas). */
  address?: string | null;
  /**
   * Tabela do cliente. Só quem tem duas ou mais escolhe — para os outros o
   * servidor usa a única que o rep tem. Sempre revalidada contra o conjunto
   * dele: o que vem daqui é pedido, não permissão.
   */
  price_table_id?: string | null;
}

/**
 * A única edição de cliente que o app permite hoje.
 *
 * Deliberadamente estreita: trocar a tabela muda o preço de tudo que a loja
 * comprar dali para frente, e é um risco diferente do de corrigir um telefone.
 */
export interface UpdateCustomerTableRequest {
  price_table_id: string;
}

/**
 * O financeiro atrela o número do cliente NO ERP a um cadastro nascido no app.
 * "Quando conectar no sistema vai ter que ter número dos clientes, e esses
 * números vão ter que ser incluídos e atrelados" (Yan, 10/09/2026). O código é
 * normalizado no servidor: "#2225", "2225" e "02225" viram "02225".
 */
export interface AtrelarCodigoErpRequest {
  erp_id: string;
}

/** Um pedido na ficha do cliente. Sem contagem de peças de propósito: somar
 *  peças exige cruzar `order_items` de todos os pedidos, e a ficha não mostra
 *  isso — seriam duas consultas grandes para um número que ninguém lê aqui. */
export interface PedidoDoCliente {
  id: string;
  order_number: number | null;
  status: OrderStatus;
  total: number;
  created_at: string;
}

/**
 * A ficha do cliente, como o representante a vê.
 *
 * Diferente de `MinhaAreaLoja` em uma coisa que importa: aqui a tabela de preço
 * APARECE. Para a loja ela é escondida (saber que está na 03 é saber que
 * existem 01 e 02); para quem vende, é o dado que decide o preço e precisa
 * estar à vista antes de começar o pedido.
 */
export interface CustomerDetail {
  id: string;
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number | null;
  blocked: boolean;
  block_reason: string | null;
  price_table_id: string | null;
  /** O número do cliente no Control. Nulo = nasceu no app e ainda não foi atrelado. */
  erp_id?: string | null;
  /** Cadastro real (migração 041). */
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  inscricao_estadual?: string | null;
  observacoes?: string | null;
  erp_linked_at?: string | null;
  /** Última compra (migração 036) — a ficha mostra a cor do cliente. */
  last_purchase_at?: string | null;
  /** Controle de inatividade (migração 039). */
  inactivity_reason?: string | null;
  inactivity_note?: string | null;
  inactivity_updated_at?: string | null;
  /** Cliente de varejo (migração 047) — e quem marcou, para a ficha dizer. */
  varejo?: boolean | null;
  varejo_marcado_em?: string | null;
  varejo_marcado_por_nome?: string | null;
  /**
   * De quem é o cliente. Opcional: a API anterior não mandava, e o app
   * instalado no celular pode estar falando com ela.
   */
  dono?: DonoDoCliente;
  /**
   * As edições do cadastro feitas pelo app (migração 051): TODAS as que ainda
   * esperam alguém atualizar no Control e as 10 mais recentes das demais
   * (resolvidas, ou feitas quando o cliente ainda não estava no Control). Das
   * mais novas para as mais antigas. Ausente = banco sem a 051 (ou API antiga).
   */
  alteracoes?: AlteracaoDoCliente[];
  /** Do mais recente para o mais antigo. */
  pedidos: PedidoDoCliente[];
}

// ─── Edição do cadastro (migração 051) ────────────────────────────────────────
//
// "Não tem como alterar esses dados nem sendo admin lá dentro. Quero poder
// mudar sim, e quando mudar lá tem que mudar no ERP do Fábio também." (Yan,
// 17/09/2026). Os helpers que normalizam e validam moram em
// cadastro/edicao.ts — a tela e a API usam os MESMOS.

/**
 * O que a edição do cadastro pode mudar. Fora daqui, de propósito: `erp_id`
 * (quem muda é o Control), bloqueio e limite (são do Control), carteira
 * (`rep_id`/`rep_erp_id`), tabela (rota própria), varejo, inatividade e o
 * retrato de compras. `address` também não: a linha única é sempre
 * recalculada pelo servidor a partir das peças.
 */
export type CampoEditavelDoCliente =
  | 'name'
  | 'trade_name'
  | 'cnpj'
  | 'inscricao_estadual'
  | 'whatsapp'
  | 'email'
  | 'observacoes'
  | 'cep'
  | 'logradouro'
  | 'numero'
  | 'complemento'
  | 'bairro'
  | 'cidade'
  | 'uf';

/** As peças do endereço (migração 041). Mudar qualquer uma recalcula `address`. */
export type PecaDoEnderecoDoCliente = 'cep' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf';

/** Um campo como aparece no histórico: os editáveis e a linha `address` recalculada. */
export type CampoDoHistoricoDoCadastro = CampoEditavelDoCliente | 'address';

/** Valores de campos do cadastro. `null` = vazio; chave ausente = não mexe. */
export type ValoresDoCadastro = { [K in CampoEditavelDoCliente]?: string | null | undefined };

/**
 * PATCH /customers/:id/cadastro — edição PARCIAL.
 *
 * `novo` leva só o que mudou. `vistos` leva, para CADA chave de `novo`, o valor
 * que a pessoa tinha na tela ao começar a editar: se o banco já não está com
 * ele (outra pessoa salvou no meio), a gravação é recusada com 409
 * MUDOU_DE_NOVO em vez de apagar a edição do outro.
 */
export interface EditarCadastroDoClienteRequest {
  novo: ValoresDoCadastro;
  vistos: ValoresDoCadastro;
}

/** Mensagem de erro por campo, em português, pronta para ir embaixo do campo. */
export type ErrosDaEdicaoDoCadastro = { [K in CampoEditavelDoCliente]?: string };

/** Um campo que mudou: valores normalizados (documento e CEP só em dígitos). */
export interface MudancaDeCampoDoCadastro {
  antes: string | null;
  depois: string | null;
  /**
   * Só na linha `address` (revisão de 17/09/2026): antes da edição a linha já
   * dizia outra coisa que as peças (ver `linhaForaDasPecas`), então a troca da
   * linha não é explicada pelas peças que mudaram e o cartão a mostra.
   */
  linha_fora_das_pecas?: true;
}

export type CamposAlteradosDoCadastro = { [K in CampoDoHistoricoDoCadastro]?: MudancaDeCampoDoCadastro };

/** Por onde o Control ficou em dia: alguém confirmou no app, ou o próprio Control devolveu o valor pela API. */
export type ViaDaAtualizacaoNoControl = 'app' | 'api';

/** Uma edição do cadastro (uma linha de `customer_changes`, migração 051). */
export interface AlteracaoDoCliente {
  id: string;
  customer_id: string;
  /** Quem editou. Nulo se o login foi apagado — o nome fica em `alterado_por_nome`. */
  alterado_por: string | null;
  alterado_por_nome: string | null;
  alterado_em: string;
  campos: CamposAlteradosDoCadastro;
  /**
   * O cliente JÁ estava no Control (tinha `erp_id`) quando foi editado: a
   * mudança precisa chegar lá. `false` = cliente nascido no app ainda não
   * incluído — o financeiro vai incluí-lo com os dados de hoje.
   */
  erp_pendente: boolean;
  /** Quando o Control ficou em dia com esta edição. Nulo = ainda não. */
  erp_atualizado_em: string | null;
  erp_atualizado_por: string | null;
  erp_atualizado_por_nome: string | null;
  erp_atualizado_via: ViaDaAtualizacaoNoControl | null;
}

/** GET /customers/alteracoes-pendentes — a fila de quem atualiza o Control. */
export interface ClienteComAlteracaoPendente {
  customer_id: string;
  name: string;
  erp_id: string | null;
  rep_erp_id: string | null;
  /** Quantas edições deste cliente esperam o Control. */
  pendentes: number;
  /** A edição pendente mais antiga. */
  desde: string;
  /** A edição pendente mais recente. */
  ultima_em: string;
}

/**
 * A resposta 200 de GET /customers/alteracoes-pendentes. Sem a 051: `data`
 * vazio e `migracao_pendente: true` — a tela esconde o cartão em vez de
 * mostrar "nenhum cadastro alterado", que seria mentira.
 */
export interface AlteracoesPendentesResponse {
  data: ClienteComAlteracaoPendente[];
  migracao_pendente: boolean;
}

/** Em quantos aparelhos o aviso chegou, financeiro e admin separados. */
export interface AvisadosDaAlteracao {
  financeiro: number;
  admin: number;
}

/**
 * A resposta 200 do PATCH /customers/:id/cadastro.
 *
 * Sem mudança real (tudo igual ao banco): só `data` e `sem_mudanca: true` —
 * nada foi gravado. Com mudança: a ficha nova, a alteração registrada e o
 * aviso ao financeiro (`avisados` nulo quando não houve push — cliente fora do
 * Control, Control que puxa sozinho pela API — ou quando o envio não terminou
 * dentro do tempo).
 */
export type EditarCadastroDoClienteResponse =
  | { data: CustomerDetail; sem_mudanca: true }
  | {
      data: CustomerDetail;
      sem_mudanca?: false;
      alteracao: AlteracaoDoCliente;
      erp_pendente: boolean;
      /** O canal de cadastro da empresa é a API: o Control puxa a mudança sozinho, sem push. */
      control_puxa_pela_api: boolean;
      avisados: AvisadosDaAlteracao | null;
    };

/** POST /customers/:id/alteracoes/confirmar — "Já atualizei no Control", com os ids que a pessoa VIU. */
export interface ConfirmarAlteracoesDoClienteRequest {
  ids: string[];
}

export interface AlteracoesConfirmadas {
  /** Os ids que de fato foram marcados agora (os já resolvidos ou de outro cliente ficam de fora). */
  confirmadas: string[];
  /**
   * A lista da ficha, já atualizada (mesma regra de `CustomerDetail.alteracoes`).
   * `null` = a confirmação gravou, mas a releitura falhou: recarregue a ficha.
   */
  alteracoes: AlteracaoDoCliente[] | null;
}

/** O nome do campo no contrato da API de Parceiro (GET/POST /partner/v1/clientes). */
export type NomeNoContratoDoParceiro =
  | 'razao_social'
  | 'nome_fantasia'
  | 'cnpj_cpf'
  | 'inscricao_estadual'
  | 'whatsapp'
  | 'email'
  | 'observacoes'
  | 'endereco';

/**
 * Os dois representantes que importam na ficha.
 *
 * Quem CADASTROU (`rep_id`, o login que criou o cliente no app) e quem é o
 * DONO pelo código do Control (`rep_erp_id`, casado pelo miolo com o
 * `erp_rep_id` de um representante da mesma empresa). Em cliente que veio do
 * ERP o primeiro é nulo; em cliente nascido no app o segundo pode ainda não
 * existir. Só nomes de representante — nunca de outro cliente.
 */
export interface DonoDoCliente {
  rep_id: string | null;
  rep_nome: string | null;
  /** O código do representante no Control, como está no cadastro do cliente. */
  rep_erp_id: string | null;
  /** O login de representante com esse código. Nulo = nenhum login tem o código. */
  rep_pelo_codigo_id: string | null;
  rep_pelo_codigo_nome: string | null;
}

/**
 * O que está preso ao cliente e impede apagá-lo sem juntar em outro cadastro.
 * Convites, vitrines e tarefas contam os de qualquer situação (usados,
 * revogados, feitas): apagar o cliente apagaria ou soltaria todos eles.
 */
export interface VinculosDoCliente {
  pedidos: number;
  logins: number;
  convites: number;
  vitrines: number;
  tarefas: number;
}

/** GET /customers/:id/vinculos — o que o diálogo de exclusão mostra antes de confirmar. */
export interface VinculosParaExcluir {
  contagens: VinculosDoCliente;
  /** true = o banco ainda não tem a migração 050 e a exclusão vai ser recusada. */
  migracao_pendente: boolean;
}

/**
 * POST /customers/:id/excluir (só admin). `juntar_em` é o cadastro que fica com
 * pedidos, convites, vitrines, tarefas e login de loja — obrigatório quando o
 * cliente tem algum deles.
 */
export interface ExcluirClienteRequest {
  juntar_em?: string | null;
  motivo?: string | null;
}

/** O que a exclusão fez, para a tela dizer. */
export interface ClienteExcluido {
  customer_id: string;
  juntado_em: string | null;
  pedidos_movidos: number;
  convites_movidos: number;
  convites_revogados: number;
  vitrines_movidas: number;
  tarefas_movidas: number;
  /** O login de loja do excluído passou para o cadastro que ficou. */
  login_herdado: boolean;
  /** Logins de loja desligados (active=false, sem cliente) — nunca apagados. */
  logins_desligados: number;
}
