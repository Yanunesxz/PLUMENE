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
