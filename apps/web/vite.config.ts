import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Representantes Corpo Sensual',
        short_name: 'Representantes',
        description: 'Plataforma comercial para representantes',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'logo.png', sizes: '192x192', type: 'image/png' },
          { src: 'logo.png', sizes: '512x512', type: 'image/png' },
          { src: 'logo.png', sizes: '1091x1091', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // As fontes vêm fatiadas por alfabeto e o navegador escolhe pelo
        // unicode-range — em português só o latino é buscado. Sem isto o
        // precache guardaria cirílico, grego e matemático no celular do
        // representante, que nunca serão exibidos.
        globIgnores: [
          '**/*-cyrillic*-normal-*.woff2',
          '**/*-greek*-normal-*.woff2',
          '**/*-vietnamese-normal-*.woff2',
          '**/*-math-*-normal-*.woff2',
          '**/*-symbols-*-normal-*.woff2',
        ],
        runtimeCaching: [
          {
            // FOTO DE PRODUTO — a maior parte dos bytes do catálogo.
            //
            // Estava em NetworkFirst com 50 entradas, e as duas coisas doíam: a
            // foto já baixada ia à REDE de novo antes de aparecer (no 3G da
            // loja, a tela ficava cinza esperando), e 50 entradas não cobrem 313
            // produtos — o começo do catálogo era despejado ao rolar até o fim.
            //
            // CacheFirst porque a URL da foto é fixa por produto: baixada uma
            // vez, ela é a resposta certa. Trocar a foto de um produto é uma
            // operação manual e rara; quando acontece, a nova aparece no fim da
            // validade. Foto velha por alguns dias custa menos do que catálogo
            // que não abre.
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*\.(?:png|jpe?g|webp|avif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fotos-produtos',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Resto do Supabase (o que não é foto): dado pode mudar, então a
            // rede continua vindo primeiro, com o cache como rede de segurança.
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
});
