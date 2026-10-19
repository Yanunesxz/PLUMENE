import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { PrivateRoute } from './PrivateRoute.js';
import { AppLayout } from '../components/layout/AppLayout.js';
import { PaginaLogin } from '../modules/login/PaginaLogin.js';
import { PaginaCatalogo } from '../modules/catalogo/PaginaCatalogo.js';
import { PaginaPedidos } from '../modules/pedidos/PaginaPedidos.js';
import { PaginaNovoPedido } from '../modules/pedidos/PaginaNovoPedido.js';
import { PaginaDetalhePedido } from '../modules/pedidos/PaginaDetalhePedido.js';
import { PaginaClientes } from '../modules/clientes/PaginaClientes.js';
import { PaginaCliente } from '../modules/clientes/PaginaCliente.js';
import { PaginaMinhaArea } from '../modules/minha-area/PaginaMinhaArea.js';
import { PaginaConvite } from '../modules/publico/PaginaConvite.js';
import { PaginaPedidoPublico } from '../modules/publico/PaginaPedidoPublico.js';
import { PaginaSemAcesso } from '../modules/sistema/PaginaSemAcesso.js';
import { PaginaLimparCache } from '../modules/sistema/PaginaLimparCache.js';
import { PaginaNaoEncontrada } from '../modules/sistema/PaginaNaoEncontrada.js';

// Telas que só gerente/admin abrem. O representante — que é quem usa o app no
// celular, em campo — não precisa baixar nada disto para ver o catálogo.
// PaginaImportar sozinha carrega a biblioteca de planilhas.
const PaginaPainel = lazy(() => import('../modules/painel/PaginaPainel.js').then((m) => ({ default: m.PaginaPainel })));
const PaginaDashboard = lazy(() => import('../modules/painel/PaginaDashboard.js').then((m) => ({ default: m.PaginaDashboard })));
const PaginaRepresentantes = lazy(() => import('../modules/representantes/PaginaRepresentantes.js').then((m) => ({ default: m.PaginaRepresentantes })));
const PaginaImportar = lazy(() => import('../modules/importar/PaginaImportar.js').then((m) => ({ default: m.PaginaImportar })));
const PaginaAcessos = lazy(() => import('../modules/acessos/PaginaAcessos.js').then((m) => ({ default: m.PaginaAcessos })));
const PaginaLogins = lazy(() => import('../modules/logins/PaginaLogins.js').then((m) => ({ default: m.PaginaLogins })));
const PaginaMinhaAreaLoja = lazy(() => import('../modules/loja/PaginaMinhaAreaLoja.js').then((m) => ({ default: m.PaginaMinhaAreaLoja })));
const PaginaAtividades = lazy(() => import('../modules/atividades/PaginaAtividades.js').then((m) => ({ default: m.PaginaAtividades })));
const PaginaAlertas = lazy(() => import('../modules/alertas/PaginaAlertas.js').then((m) => ({ default: m.PaginaAlertas })));
const PaginaIntegracao = lazy(() => import('../modules/integracao/PaginaIntegracao.js').then((m) => ({ default: m.PaginaIntegracao })));
// A vitrine carrega o catálogo inteiro para um visitante anônimo — só desce
// quando alguém abre o link.
const PaginaVitrine = lazy(() => import('../modules/publico/PaginaVitrine.js').then((m) => ({ default: m.PaginaVitrine })));

/** Enquanto o pedaço da tela baixa. Some rápido demais para merecer esqueleto. */
function AoCarregar({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando…</div>}>{children}</Suspense>;
}

/**
 * "Minha área" é o mesmo endereço para papéis diferentes.
 *
 * Quem vende vê desempenho e a fila de pedidos que chegaram; quem compra vê o
 * próprio histórico. Um endereço só porque é assim que as duas pessoas falam
 * disso — "a minha área" — e porque o menu de cada papel já leva ao lugar certo.
 */
function MinhaArea() {
  const papel = useAuthStore((s) => s.user?.role);
  if (papel === 'store') {
    return (
      <AoCarregar>
        <PaginaMinhaAreaLoja />
      </AoCarregar>
    );
  }
  // O relacionamento não vende — a "área" dele são as Atividades.
  if (papel === 'relacionamento') return <Navigate to="/atividades" replace />;
  // O visualizador (054) não tem "minha área": a tela é toda de ação — ativar
  // avisos, gerar relatório, dar OK em tarefa, sincronizar a fila offline — e
  // ele "nao altera nada" (Yan, 15/10/2026). O Painel é a leitura equivalente.
  if (papel === 'visualizador') return <Navigate to="/dashboard" replace />;
  return <PaginaMinhaArea />;
}

/**
 * A porta de entrada muda com o papel: o financeiro cai direto nos PEDIDOS —
 * é a mesa de trabalho dele ("depois de aprovado pela fábrica cai no
 * financeiro"). Os demais seguem no catálogo, como sempre foi.
 */
function Inicio() {
  const papel = useAuthStore((s) => s.user?.role);
  if (papel === 'relacionamento') return <Navigate to="/atividades" replace />;
  // O visualizador (054) abre no PAINEL: é a visão de cima — o que vendeu, o
  // que está na mesa do financeiro, os top clientes. O catálogo, para quem não
  // monta pedido, é o lugar errado para começar.
  if (papel === 'visualizador') return <Navigate to="/dashboard" replace />;
  return <Navigate to={papel === 'financeiro' ? '/orders' : '/catalog'} replace />;
}

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  {
    path: '/login',
    element: <PaginaLogin />,
  },
  // Públicas: fora do PrivateRoute de propósito — quem abre estes links ainda
  // não tem (ou nunca terá) conta.
  { path: '/convite/:token', element: <PaginaConvite /> },
  { path: '/pedido/:token', element: <PaginaPedidoPublico /> },
  // Sem login: é o link que se manda para o aparelho que travou (07/10/2026).
  { path: '/limpar-cache', element: <PaginaLimparCache /> },
  {
    path: '/vitrine/:token',
    element: (
      <AoCarregar>
        <PaginaVitrine />
      </AoCarregar>
    ),
  },
  {
    path: '/',
    element: <PrivateRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Inicio /> },
          { path: 'minha-area', element: <MinhaArea /> },
          { path: 'catalog', element: <PaginaCatalogo /> },
          { path: 'orders', element: <PaginaPedidos /> },
          {
            // A tela é 100% de escrita (escolher cliente, grade, desconto,
            // condição, salvar/enviar), e até 15/10/2026 estava aberta a
            // qualquer papel autenticado. A guarda é a mesma lista do
            // `POST /orders`: quem monta pedido. O visualizador não entra —
            // sem isto ele montaria o carrinho inteiro para tomar 403 no envio.
            path: 'orders/new',
            element: <PrivateRoute roles={['rep', 'manager', 'admin', 'financeiro', 'store']} />,
            children: [{ index: true, element: <PaginaNovoPedido /> }],
          },
          { path: 'orders/:id', element: <PaginaDetalhePedido /> },
          { path: 'customers', element: <PaginaClientes /> },
          { path: 'customers/:id', element: <PaginaCliente /> },
          {
            path: 'acessos',
            element: <PrivateRoute roles={['rep', 'manager', 'admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaAcessos /></AoCarregar> }],
          },
          {
            // A central de pendências do representante — os 3 degraus de
            // alerta com o botão de resolver ali (atualizar, avisos, instalar).
            path: 'alertas',
            element: <PrivateRoute roles={['rep']} />,
            children: [{ index: true, element: <AoCarregar><PaginaAlertas /></AoCarregar> }],
          },
          {
            // Metas e desempenho da equipe (19/10/2026) — leitura do gerente
            // comercial; o admin e o visualizador também leem.
            path: 'desempenho',
            element: <PrivateRoute roles={['manager', 'admin', 'visualizador']} />,
            children: [{ index: true, element: <AoCarregar><PaginaDashboard /></AoCarregar> }],
          },
          // Endereço antigo da loja: quem tem o app instalado tem este link
          // salvo. Leva para o novo lugar em vez de dar "página não encontrada".
          { path: 'minha-conta', element: <Navigate to="/minha-area" replace /> },
          {
            // A mesa de quem marca tarefa: Fabian, Bruna e a gerência. O rep
            // não entra — as tarefas DELE chegam na Minha Área.
            // O visualizador (054) entra só para LER o andamento; "Excluir"
            // da tarefa não aparece para ele.
            path: 'atividades',
            element: <PrivateRoute roles={['manager', 'admin', 'financeiro', 'relacionamento', 'visualizador']} />,
            children: [{ index: true, element: <AoCarregar><PaginaAtividades /></AoCarregar> }],
          },
          {
            // O visualizador (054) entra: métricas, Top clientes e filas são
            // leitura. A régua e os motivos de cancelamento já são `admin`, e
            // o envio de aviso em massa some para ele.
            path: 'dashboard',
            element: <PrivateRoute roles={['manager', 'admin', 'visualizador']} />,
            children: [{ index: true, element: <AoCarregar><PaginaPainel /></AoCarregar> }],
          },
          {
            // O financeiro entra para VER (a tecla não se aplica a ele e a API
            // nega as escritas); a tela esconde os botões de mexer. O
            // visualizador (054) entra pelo mesmo caminho — e atenção: a
            // `permissao` desta rota NÃO o segura (temPermissao devolve true
            // para quem não é gerente), então quem esconde botão é a tela.
            path: 'representantes',
            element: <PrivateRoute roles={['manager', 'admin', 'financeiro', 'visualizador']} permissao="gerenciar_representantes" />,
            children: [{ index: true, element: <AoCarregar><PaginaRepresentantes /></AoCarregar> }],
          },
          // Era `roles={['admin']}`: o admin continua entrando sempre (tecla não
          // se aplica a ele) e o gerente só entra se o admin ligar a dele.
          {
            path: 'importar',
            element: <PrivateRoute roles={['manager', 'admin']} permissao="importar_produtos" />,
            children: [{ index: true, element: <AoCarregar><PaginaImportar /></AoCarregar> }],
          },
          {
            // O visualizador (054) entra para ver QUEM TEM ACESSO — "nao pode
            // mudar logins e etc.." (Yan, 15/10/2026). A tela esconde "Novo
            // login" e os três botões de cada cartão; a API nega o resto.
            path: 'logins',
            element: <PrivateRoute roles={['admin', 'visualizador']} />,
            children: [{ index: true, element: <AoCarregar><PaginaLogins /></AoCarregar> }],
          },
          {
            // O estado da integração com o Control e o botão de pedir uma
            // passada agora. O gerente olha; financeiro e admin pedem (a
            // API nega o PATCH ao gerente e a tela esconde o botão).
            // O visualizador (054) olha como o gerente: `podePedir` já o nega.
            path: 'integracao',
            element: <PrivateRoute roles={['manager', 'admin', 'financeiro', 'visualizador']} />,
            children: [{ index: true, element: <AoCarregar><PaginaIntegracao /></AoCarregar> }],
          },
        ],
      },
    ],
  },
  { path: '/unauthorized', element: <PaginaSemAcesso /> },
  { path: '*', element: <PaginaNaoEncontrada /> },
]);
