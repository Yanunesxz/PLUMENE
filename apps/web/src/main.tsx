import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router/index.js';
import '@fontsource-variable/inter';
// Só os títulos usam a serifada — é a letra do monograma da marca.
import '@fontsource-variable/bodoni-moda';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
