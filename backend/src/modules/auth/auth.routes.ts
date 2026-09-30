import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError, asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { authService } from './auth.service.js';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(80),
  email: z.string().trim().email('E-mail inválido'),
  password: z
    .string()
    .min(8, 'A senha deve ter ao menos 8 caracteres')
    .max(72, 'A senha deve ter no máximo 72 caracteres'),
});

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.nodeEnv === 'production' && process.env.FORCE_SECURE_COOKIE === 'true',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  };
}

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);
    const user = await authService.register(name, email, password);
    res.cookie(env.cookieName, authService.issueToken(user), cookieOptions());
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await authService.login(email, password);
    res.cookie(env.cookieName, authService.issueToken(user), cookieOptions());
    res.json({ user });
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(env.cookieName, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = authService.findById(req.user!.id);
    if (!user) throw HttpError.unauthorized();
    res.json({ user });
  }),
);
