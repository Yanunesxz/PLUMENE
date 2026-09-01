import { z } from 'zod';
import { SHOWCASE_DURATIONS } from '@csb/shared';

export const criarConviteSchema = z.object({
  customer_id: z.string().uuid('Cliente inválido'),
});

export const criarVitrineSchema = z.object({
  // Só as quatro validades combinadas: 1h, 6h, 12h e 24h.
  hours: z.union([
    z.literal(SHOWCASE_DURATIONS[0]),
    z.literal(SHOWCASE_DURATIONS[1]),
    z.literal(SHOWCASE_DURATIONS[2]),
    z.literal(SHOWCASE_DURATIONS[3]),
  ]),
  // "Mesmo temporário tem que ter algum cliente atrelado" (Yan, 31/08/2026):
  // o link nasce amarrado, como a conta de loja — o pedido cai no cadastro
  // certo e no preço certo. Cliente novo se cadastra primeiro.
  customer_id: z.string().uuid('Escolha o cliente do link'),
  // Com qual tabela o link abre. Omitido, o servidor usa a do representante —
  // quem tem duas ou mais precisa escolher, e essa regra é do controller.
  price_table_id: z.string().uuid('Tabela de preço inválida').nullable().optional(),
});

export const aceitarConviteSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da loja').max(120),
  email: z.string().email('Informe um e-mail válido').max(160),
  password: z.string().min(6, 'A senha precisa de ao menos 6 caracteres').max(72),
});
