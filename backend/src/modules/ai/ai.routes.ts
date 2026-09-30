import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { aiService } from './ai.service.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

/** Permite ao frontend esconder/desabilitar o recurso sem chutar. */
aiRouter.get('/status', (_req, res) => {
  res.json({ enabled: aiService.enabled, provider: aiService.providerName });
});

aiRouter.post(
  '/explain',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        mode: z.enum(['word', 'passage', 'concept']).default('word'),
        text: z.string().trim().min(1).max(2000),
        context: z.string().trim().max(4000).optional(),
        libraryItemId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body);

    res.json({ explanation: await aiService.explain(req.user!.id, data) });
  }),
);
