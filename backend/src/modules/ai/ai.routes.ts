import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { diagnosticarProvider } from './provider.factory.js';
import { aiService } from './ai.service.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

/** Permite ao frontend esconder/desabilitar o recurso sem chutar. */
aiRouter.get('/status', (_req, res) => {
  const enabled = aiService.enabled;
  // O motivo nunca expõe a chave em si, só diz qual das duas variáveis falta —
  // "enabled: false" sozinho não distingue "sem AI_PROVIDER" de "sem AI_API_KEY".
  res.json({ enabled, provider: aiService.providerName, motivo: enabled ? null : diagnosticarProvider() });
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
