import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { PrivateRoute } from './PrivateRoute.js';
import { AppLayout } from '../components/layout/AppLayout.js';
import { PaginaLogin } from '../modules/login/PaginaLogin.js';
import { PaginaCatalogo } from '../modules/catalogo/PaginaCatalogo.js';
import { PaginaPedidos } from '../modules/pedidos/PaginaPedidos.js';
import { PaginaNovoPedido } from '../modules/pedidos/PaginaNovoPedido.js';
import { PaginaDetalhePedido } from '../modules/pedidos/PaginaDetalhePedido.js';
import { PaginaClientes } from '../modules/clientes/PaginaClientes.js';
import { PaginaMinhaArea } from '../modules/minha-area/PaginaMinhaArea.js';
import { PaginaConvite } from '../modules/publico/PaginaConvite.js';
import { PaginaSemAcesso } from '../modules/sistema/PaginaSemAcesso.js';
import { PaginaNaoEncontrada } from '../modules/sistema/PaginaNaoEncontrada.js';

// Telas que só gerente/admin abrem. O representante — que é quem usa o app no
// celular, em campo — não precisa baixar nada disto para ver o catálogo.
// PaginaImportar sozinha carrega a biblioteca de planilhas.
const PaginaPainel = lazy(() => import('../modules/painel/PaginaPainel.js').then((m) => ({ default: m.PaginaPainel })));
const PaginaRepresentantes = lazy(() => import('../modules/representantes/PaginaRepresentantes.js').then((m) => ({ default: m.PaginaRepresentantes })));
const PaginaComissoes = lazy(() => import('../modules/comissoes/PaginaComissoes.js').then((m) => ({ default: m.PaginaComissoes })));
const PaginaImportar = lazy(() => import('../modules/importar/PaginaImportar.js').then((m) => ({ default: m.PaginaImportar })));
const PaginaAcessos = lazy(() => import('../modules/acessos/PaginaAcessos.js').then((m) => ({ default: m.PaginaAcessos })));
const PaginaMinhaConta = lazy(() => import('../modules/loja/PaginaMinhaConta.js').then((m) => ({ default: m.PaginaMinhaConta })));
// A vitrine carrega o catálogo inteiro para um visitante anônimo — só desce
// quando alguém abre o link.
const PaginaVitrine = lazy(() => import('../modules/publico/PaginaVitrine.js').then((m) => ({ default: m.PaginaVitrine })));

/** Enquanto o pedaço da tela baixa. Some rápido demais para merecer esqueleto. */
function AoCarregar({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando…</div>}>{children}</Suspense>;
}

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  {
    path: '/login',
    element: <PaginaLogin />,
  },
  // Públicas: fora do PrivateRoute de propósito — quem abre estes links ainda
  // não tem (ou nunca terá) conta.
  { path: '/convite/:token', element: <PaginaConvite /> },
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
          { index: true, element: <Navigate to="/catalog" replace /> },
          { path: 'minha-area', element: <PaginaMinhaArea /> },
          { path: 'catalog', element: <PaginaCatalogo /> },
          { path: 'orders', element: <PaginaPedidos /> },
          { path: 'orders/new', element: <PaginaNovoPedido /> },
          { path: 'orders/:id', element: <PaginaDetalhePedido /> },
          { path: 'customers', element: <PaginaClientes /> },
          {
            path: 'acessos',
            element: <PrivateRoute roles={['rep', 'manager', 'admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaAcessos /></AoCarregar> }],
          },
          {
            path: 'minha-conta',
            element: <PrivateRoute roles={['store']} />,
            children: [{ index: true, element: <AoCarregar><PaginaMinhaConta /></AoCarregar> }],
          },
          {
            path: 'dashboard',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaPainel /></AoCarregar> }],
          },
          {
            path: 'representantes',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaRepresentantes /></AoCarregar> }],
          },
          {
            path: 'comissoes',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaComissoes /></AoCarregar> }],
          },
          {
            path: 'importar',
            element: <PrivateRoute roles={['admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaImportar /></AoCarregar> }],
          },
        ],
      },
    ],
  },
  { path: '/unauthorized', element: <PaginaSemAcesso /> },
  { path: '*', element: <PaginaNaoEncontrada /> },
]);
