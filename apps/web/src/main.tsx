import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router/index.js';
import { observarInstalacao } from './lib/instalarApp.js';
import { observarAtualizacao } from './lib/atualizarApp.js';
// Manrope em tudo (Padrão Yan Nunes). Do pacote, e não do Google Fonts: o app
// trabalha offline na rua, e a fonte tem de estar dentro dele.
import '@fontsource-variable/manrope';
import './styles/globals.css';
import { iniciarTema } from './lib/tema.js';

// Antes de renderizar: o navegador avisa que dá para instalar assim que a
// página carrega, e esse aviso não se repete. Se a escuta só existisse dentro de
// uma tela, o convite já teria passado quando ela montasse.
iniciarTema();
observarInstalacao();

// Registra o service worker e passa a conferir sozinho se saiu versão nova.
// Fora do React de propósito: o registro tem de acontecer uma vez por aba, e no
// arranque — não a cada montagem de tela.
observarAtualizacao();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
