import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email é obrigatório').email('Email inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token é obrigatório'),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Informe a senha atual'),
  new_password: z.string().min(6, 'A nova senha deve ter ao menos 6 caracteres'),
});
