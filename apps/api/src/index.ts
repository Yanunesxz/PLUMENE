/**
 * Servidor local / long-running (desenvolvimento e Docker).
 *
 * Na Vercel a entrada é `api/index.ts`, que usa a mesma `buildApp()` sem
 * `listen()`. O scheduler do ERP vive só aqui: depende de processo ligado o
 * tempo todo, o que não existe em serverless. Em produção quem sincroniza é o
 * agente instalado no servidor da fábrica.
 */
import dns from 'node:dns';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startErpSyncScheduler, stopErpSyncScheduler } from './jobs/erpSyncScheduler.js';

// O Node moderno prefere IPv6 quando o DNS oferece os dois — e o container do
// Railway não tem saída IPv6: conectar no Gmail dava ENETUNREACH 2607:… e o
// e-mail de pedido morria calado (provado pelo /public/health-email em
// 14/08/2026). IPv4 primeiro resolve; quem só tem IPv6 não passa por aqui.
dns.setDefaultResultOrder('ipv4first');

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
