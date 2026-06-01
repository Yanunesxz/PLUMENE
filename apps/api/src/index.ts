import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.router.js';
import { catalogRouter } from './modules/catalog/catalog.router.js';
import { customersRouter } from './modules/customers/customers.router.js';
import { ordersRouter } from './modules/orders/orders.router.js';
import { syncRouter } from './modules/sync/sync.router.js';
import { startErpSyncScheduler, stopErpSyncScheduler } from './jobs/erpSyncScheduler.js';

const server = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

await server.register(helmet, { global: true });
await server.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
});
await server.register(jwt, {
  secret: env.JWT_SECRET,
});

server.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  env: env.NODE_ENV,
}));

await server.register(authRouter);
await server.register(catalogRouter);
await server.register(customersRouter);
await server.register(ordersRouter);
await server.register(syncRouter);

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
