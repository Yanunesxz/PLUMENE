import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email é obrigatório').email('Email inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token é obrigatório'),
});
