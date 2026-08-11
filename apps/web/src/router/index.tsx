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
import { PaginaSemAcesso } from '../modules/sistema/PaginaSemAcesso.js';
import { PaginaNaoEncontrada } from '../modules/sistema/PaginaNaoEncontrada.js';

// Telas que só gerente/admin abrem. O representante — que é quem usa o app no
// celular, em campo — não precisa baixar nada disto para ver o catálogo.
// PaginaImportar sozinha carrega a biblioteca de planilhas.
const PaginaPainel = lazy(() => import('../modules/painel/PaginaPainel.js').then((m) => ({ default: m.PaginaPainel })));
const PaginaRepresentantes = lazy(() => import('../modules/representantes/PaginaRepresentantes.js').then((m) => ({ default: m.PaginaRepresentantes })));
const PaginaImportar = lazy(() => import('../modules/importar/PaginaImportar.js').then((m) => ({ default: m.PaginaImportar })));
const PaginaAcessos = lazy(() => import('../modules/acessos/PaginaAcessos.js').then((m) => ({ default: m.PaginaAcessos })));
const PaginaLogins = lazy(() => import('../modules/logins/PaginaLogins.js').then((m) => ({ default: m.PaginaLogins })));
const PaginaMinhaAreaLoja = lazy(() => import('../modules/loja/PaginaMinhaAreaLoja.js').then((m) => ({ default: m.PaginaMinhaAreaLoja })));
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
  return <PaginaMinhaArea />;
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
          { path: 'minha-area', element: <MinhaArea /> },
          { path: 'catalog', element: <PaginaCatalogo /> },
          { path: 'orders', element: <PaginaPedidos /> },
          { path: 'orders/new', element: <PaginaNovoPedido /> },
          { path: 'orders/:id', element: <PaginaDetalhePedido /> },
          { path: 'customers', element: <PaginaClientes /> },
          { path: 'customers/:id', element: <PaginaCliente /> },
          {
            path: 'acessos',
            element: <PrivateRoute roles={['rep', 'manager', 'admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaAcessos /></AoCarregar> }],
          },
          // Endereço antigo da loja: quem tem o app instalado tem este link
          // salvo. Leva para o novo lugar em vez de dar "página não encontrada".
          { path: 'minha-conta', element: <Navigate to="/minha-area" replace /> },
          {
            path: 'dashboard',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaPainel /></AoCarregar> }],
          },
          {
            path: 'representantes',
            element: <PrivateRoute roles={['manager', 'admin']} permissao="gerenciar_representantes" />,
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
            path: 'logins',
            element: <PrivateRoute roles={['admin']} />,
            children: [{ index: true, element: <AoCarregar><PaginaLogins /></AoCarregar> }],
          },
        ],
      },
    ],
  },
  { path: '/unauthorized', element: <PaginaSemAcesso /> },
  { path: '*', element: <PaginaNaoEncontrada /> },
]);
