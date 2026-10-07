import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError, asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { authService } from './auth.service.js';

/**
 * Não há rota de cadastro: a biblioteca é fechada e as contas são criadas à
 * mão, com `npm run criar-usuario`. O serviço `authService.register` continua
 * existindo porque é ele que o script (e os testes) usam.
 */

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Produção serve por HTTPS: o cookie de sessão tem de ser secure por padrão.
    // FORCE_SECURE_COOKIE continua servindo para forçar em ambiente de teste com TLS.
    secure: env.nodeEnv === 'production' || process.env.FORCE_SECURE_COOKIE === 'true',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  };
}

export const authRouter = Router();

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
    const user = await authService.findById(req.user!.id);
    if (!user) throw HttpError.unauthorized();
    res.json({ user });
  }),
);
