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
  define: {
    // Carimbo do build, mostrado na "Minha área". Serve ao suporte: em vez de
    // "não está atualizando", o representante lê a data da versão que está no
    // aparelho dele e dá para saber na hora se o problema é o app ou a conta.
    __VERSAO_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt', não 'autoUpdate'.
      //
      // Com 'autoUpdate' o service worker novo assumia o controle no meio da
      // sessão (skipWaiting + clientsClaim) enquanto a aba continuava rodando o
      // JavaScript velho. Ao abrir uma tela que só baixa quando é pedida
      // (painel, importar), o pedaço antigo já não existia no
      // servidor: erro de carregamento, tela branca — e a saída que sobrava
      // para o representante era limpar o cache na mão.
      //
      // Em 'prompt' nada troca por baixo dos pés: a versão nova baixa inteira e
      // fica em espera, e quem decide a hora de trocar é o app. Ele troca
      // sozinho, sem avisar ninguém, num momento em que a tela não está sendo
      // usada — ver `atualizarApp.ts`. O nome do modo diz "perguntar", mas o
      // que ele dá é o controle do instante da troca; a pergunta é opcional, e
      // aqui não existe.
      registerType: 'prompt',
      // O registro é nosso (`observarAtualizacao`, no arranque): precisamos da
      // referência do registration para procurar versão nova de tempos em
      // tempos. O script que o plugin injeta sozinho não devolve nada.
      injectRegister: null,
      includeAssets: ['logo.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
      manifest: {
        name: 'Representantes Corpo Sensual',
        short_name: 'Representantes',
        description: 'Plataforma comercial para representantes',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // O tamanho declarado tem de ser o tamanho REAL do arquivo: o Chrome
        // baixa o ícone e confere. Apontar a logo de 1091px como se fosse de
        // 192 reprovava o ícone, e sem ícone válido ele nunca dispara o convite
        // de instalação — foi assim que o "Deixe na tela inicial" sumiu.
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            // Separado do 'any': o sistema recorta o maskable em círculo, e usar
            // a mesma arte nos dois faz a logo aparecer cortada no Android.
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // O cache da versão anterior é apagado quando a nova assume. É isto que
        // dispensa "limpar o cache" a cada publicação: a faxina é do próprio
        // service worker, e as fotos dos produtos (cache separado, abaixo) não
        // entram nela — elas continuam no aparelho, senão o catálogo inteiro
        // desceria de novo pelo 3G da loja a cada atualização.
        cleanupOutdatedCaches: true,
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
            // MODELO DA PLANILHA OFICIAL — os três .xlsx que a exportação
            // preenche. Somam ~154 KB e mudam quando a fábrica publica a
            // planilha do ano, o que acontece uma vez por coleção.
            //
            // Ficam fora do precache de propósito: quem só tira pedido no
            // celular nunca exporta, e não é para descer 154 KB no 3G dele por
            // causa de uma tela que ele não abre. CacheFirst resolve o resto —
            // a primeira exportação baixa, e da segunda em diante funciona
            // offline, que é quando o representante precisa.
            urlPattern: /\/modelos\/pedido-cs-[123]\.xlsx$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'modelos-de-planilha',
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 180 },
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
