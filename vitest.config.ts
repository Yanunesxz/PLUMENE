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
  },
});
