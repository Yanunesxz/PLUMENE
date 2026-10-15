/**
 * IA sob demanda — a rota só trabalha (e só custa) quando alguém aperta o botão.
 *
 * Rate limit próprio e apertado: cada chamada vira uma cobrança em dólar na
 * conta da Anthropic, então um loop acidental no front não pode virar fatura.
 *
 * O VISUALIZADOR (054) fica FORA, e a decisão merece o parágrafo porque é o
 * único ponto onde o pedido do Yan de 15/10/2026 se dobra sobre si mesmo: ele
 * manda liberar "relatórios" (e este POST só lê — nada é gravado), e manda que
 * nenhuma rota de escrita aceite o papel. Fica de fora por dois motivos:
 *   • o guarda que vale é o teste de inventário, que varre POST/PATCH/PUT/
 *     DELETE. Abrir uma exceção aqui significaria ensinar o teste a aceitar
 *     exceções de papel, e é esse teste que vai pegar a rota nova de 2027;
 *   • a rota custa dinheiro por toque, e quem só acompanha não precisa dela —
 *     os números do relatório estão no Painel, que ele abre.
 * Se o Yan quiser liberar, a exceção tem de ser nomeada DENTRO do teste de
 * inventário, com o nome da rota e o porquê — nunca por regex solta.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { relatorioDaCarteiraHandler } from './ia.controller.js';

export async function iaRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/ia/relatorio-carteira',
    {
      preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'financeiro'])],
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    relatorioDaCarteiraHandler,
  );
}
