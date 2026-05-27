import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { listCustomers } from './customers.controller.js';

export async function customersRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/customers', { preHandler: authenticate }, listCustomers);
}
