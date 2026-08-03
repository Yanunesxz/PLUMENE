import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router/index.js';
import { observarInstalacao } from './lib/instalarApp.js';
import '@fontsource-variable/inter';
// Só os títulos usam a serifada — é a letra do monograma da marca.
import '@fontsource-variable/bodoni-moda';
import './styles/globals.css';

// Antes de renderizar: o navegador avisa que dá para instalar assim que a
// página carrega, e esse aviso não se repete. Se a escuta só existisse dentro de
// uma tela, o convite já teria passado quando ela montasse.
observarInstalacao();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
