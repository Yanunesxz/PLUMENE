import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { env } from './config/env.js';

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

const start = async (): Promise<void> => {
  try {
    await server.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

await start();

export { server };
