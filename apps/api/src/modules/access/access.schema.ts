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
});

export const aceitarConviteSchema = z.object({
  email: z.string().email('Informe um e-mail válido').max(160),
  password: z.string().min(6, 'A senha precisa de ao menos 6 caracteres').max(72),
});
