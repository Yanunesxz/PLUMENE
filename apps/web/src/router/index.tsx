import { createBrowserRouter, Navigate } from 'react-router-dom';
import { PrivateRoute } from './PrivateRoute.js';
import { AppLayout } from '../components/layout/AppLayout.js';
import { PaginaLogin } from '../modules/login/PaginaLogin.js';
import { PaginaCatalogo } from '../modules/catalogo/PaginaCatalogo.js';
import { PaginaPedidos } from '../modules/pedidos/PaginaPedidos.js';
import { PaginaNovoPedido } from '../modules/pedidos/PaginaNovoPedido.js';
import { PaginaDetalhePedido } from '../modules/pedidos/PaginaDetalhePedido.js';
import { PaginaClientes } from '../modules/clientes/PaginaClientes.js';
import { PaginaPainel } from '../modules/painel/PaginaPainel.js';
import { PaginaRepresentantes } from '../modules/representantes/PaginaRepresentantes.js';
import { PaginaComissoes } from '../modules/comissoes/PaginaComissoes.js';
import { PaginaMinhaArea } from '../modules/minha-area/PaginaMinhaArea.js';
import { PaginaAssistente } from '../modules/assistente/PaginaAssistente.js';
import { PaginaSemAcesso } from '../modules/sistema/PaginaSemAcesso.js';
import { PaginaNaoEncontrada } from '../modules/sistema/PaginaNaoEncontrada.js';

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  {
    path: '/login',
    element: <PaginaLogin />,
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
          { path: 'assistente', element: <PaginaAssistente /> },
          { path: 'orders', element: <PaginaPedidos /> },
          { path: 'orders/new', element: <PaginaNovoPedido /> },
          { path: 'orders/:id', element: <PaginaDetalhePedido /> },
          { path: 'customers', element: <PaginaClientes /> },
          {
            path: 'dashboard',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <PaginaPainel /> }],
          },
          {
            path: 'representantes',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <PaginaRepresentantes /> }],
          },
          {
            path: 'comissoes',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <PaginaComissoes /> }],
          },
        ],
      },
    ],
  },
  { path: '/unauthorized', element: <PaginaSemAcesso /> },
  { path: '*', element: <PaginaNaoEncontrada /> },
]);
