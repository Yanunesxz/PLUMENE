/**
 * Servidor local / long-running (desenvolvimento e Docker).
 *
 * Na Vercel a entrada é `api/index.ts`, que usa a mesma `buildApp()` sem
 * `listen()`. O scheduler do ERP vive só aqui: depende de processo ligado o
 * tempo todo, o que não existe em serverless. Em produção quem sincroniza é o
 * agente instalado no servidor da fábrica.
 */
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startErpSyncScheduler, stopErpSyncScheduler } from './jobs/erpSyncScheduler.js';

const server = await buildApp();

const start = async (): Promise<void> => {
  try {
    await server.listen({ port: env.PORT, host: '0.0.0.0' });
    startErpSyncScheduler();
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

const stop = async (): Promise<void> => {
  stopErpSyncScheduler();
  await server.close();
};

process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });

await start();

export { server };
