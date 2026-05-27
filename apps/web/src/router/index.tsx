import { createBrowserRouter, Navigate } from 'react-router-dom';
import { PrivateRoute } from './PrivateRoute.js';
import { AppLayout } from '../components/layout/AppLayout.js';
import { LoginPage } from '../modules/auth/LoginPage.js';
import { CatalogPage } from '../modules/catalog/CatalogPage.js';
import { OrdersPage } from '../modules/orders/OrdersPage.js';
import { NewOrderPage } from '../modules/orders/NewOrderPage.js';
import { CustomersPage } from '../modules/customers/CustomersPage.js';
import { DashboardPage } from '../modules/dashboard/DashboardPage.js';

export const router = createBrowserRouter([
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
          { path: 'customers', element: <CustomersPage /> },
          {
            path: 'dashboard',
            element: <PrivateRoute roles={['manager', 'admin']} />,
            children: [{ index: true, element: <DashboardPage /> }],
          },
        ],
      },
    ],
  },
  {
    path: '/unauthorized',
    element: (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Acesso não autorizado.</p>
      </div>
    ),
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
