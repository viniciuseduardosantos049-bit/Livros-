import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError, asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { pushService } from './push.service.js';

export const pushRouter = Router();

const assinaturaSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/**
 * Disparado por um gatilho externo (cron-job.org ou similar) — a Netlify, no
 * plano gratuito, não tem agendador embutido. Protegido por segredo
 * compartilhado no header, não por sessão: quem chama não é uma pessoa logada.
 */
pushRouter.post(
  '/lembretes-cron',
  asyncHandler(async (req, res) => {
    if (!env.cronSecret || req.headers['x-cron-secret'] !== env.cronSecret) {
      throw HttpError.unauthorized();
    }
    const resultado = await pushService.enviarLembretesDeInatividade(env.pushDiasInatividade);
    res.json(resultado);
  }),
);

pushRouter.use(requireAuth);

/** Permite ao frontend esconder o botão de ativar quando o recurso está desligado. */
pushRouter.get('/chave-publica', (_req, res) => {
  res.json({ enabled: pushService.enabled, publicKey: pushService.enabled ? pushService.publicKey : null });
});

pushRouter.post(
  '/inscrever',
  asyncHandler(async (req, res) => {
    const sub = assinaturaSchema.parse(req.body);
    await pushService.inscrever(req.user!.id, sub);
    res.status(204).end();
  }),
);

pushRouter.post(
  '/cancelar',
  asyncHandler(async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
    await pushService.cancelar(req.user!.id, endpoint);
    res.status(204).end();
  }),
);
