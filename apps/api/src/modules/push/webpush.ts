/**
 * Embrulho fino do web-push, com um propósito só: os testes trocam ESTE
 * módulo por um dublê (vi.doMock por caminho relativo, como o do supabase).
 * Mockar 'web-push' pelo nome não alcança a resolução do pnpm dentro de
 * apps/api — o dublê aplicava num id e o serviço importava outro.
 */
export { default as webpush } from 'web-push';
