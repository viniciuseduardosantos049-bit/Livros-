import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { env } from './config/env.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { bookRouter } from './modules/books/book.routes.js';
import { libraryRouter } from './modules/library/library.routes.js';
import { pushRouter } from './modules/push/push.routes.js';
import { statsRouter } from './modules/stats/stats.routes.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { rateLimit } from './middlewares/rateLimit.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 20 }), authRouter);
  app.use('/api/books', rateLimit({ windowMs: 60_000, max: 90 }), bookRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/ai', rateLimit({ windowMs: 60_000, max: 30 }), aiRouter);
  app.use('/api/push', rateLimit({ windowMs: 60_000, max: 20 }), pushRouter);

  app.use('/api', notFoundHandler);

  // Em produção o próprio backend serve o build do frontend (uma única porta).
  if (fs.existsSync(env.frontendDist)) {
    app.use(express.static(env.frontendDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(env.frontendDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
