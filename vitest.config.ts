import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Um projeto de teste só para o monorepo inteiro. Os testes não encostam no
 * Supabase real: `supabase.ts` é trocado por um dublê em cada arquivo que
 * precisa (ver tests/supabaseFake.ts).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@csb/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
    // Os testes de rota sobem o app inteiro (buildApp) e a PRIMEIRA requisição
    // de cada arquivo leva 1,5 a 4,6 s só para carregar a API. Com o `pnpm
    // verify` rodando typecheck e lint ao lado, isso passava dos 5 s padrão e
    // o portão de produção falhava por carga da máquina, não por defeito
    // (15/09/2026: desconto-em-valor e cadastro-cliente, isolados, 7/7 e 20/20).
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
