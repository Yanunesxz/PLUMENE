import { createBrowserRouter, Navigate } from 'react-router-dom';
import { PrivateRoute } from './PrivateRoute.js';
import { AppLayout } from '../components/layout/AppLayout.js';
import { LoginPage } from '../modules/auth/LoginPage.js';
import { CatalogPage } from '../modules/catalog/CatalogPage.js';
import { OrdersPage } from '../modules/orders/OrdersPage.js';
import { NewOrderPage } from '../modules/orders/NewOrderPage.js';
import { OrderDetailPage } from '../modules/orders/OrderDetailPage.js';
import { CustomersPage } from '../modules/customers/CustomersPage.js';
import { DashboardPage } from '../modules/dashboard/DashboardPage.js';
import { RepsPage } from '../modules/reps/RepsPage.js';
import { UnauthorizedPage } from '../modules/system/UnauthorizedPage.js';
import { NotFoundPage } from '../modules/system/NotFoundPage.js';

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <PrivateRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/catalog" replace /> },
          { path: 'catalog', element: <CatalogPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/new', element: <NewOrderPage /> },
          { path: 'orders/:id', element: <OrderDetailPage /> },
          { path: 'customers', element: <CustomersPage /> },
          {
            path: 'dashboard',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <DashboardPage /> }],
          },
          {
            path: 'representantes',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <RepsPage /> }],
          },
        ],
      },
    ],
  },
  { path: '/unauthorized', element: <UnauthorizedPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
