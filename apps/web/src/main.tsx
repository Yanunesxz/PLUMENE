import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router/index.js';
import { initTheme } from './lib/theme.js';
import '@fontsource-variable/inter';
import './styles/globals.css';

// Antes do primeiro render: sem isso o app pisca branco ao abrir no escuro.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
