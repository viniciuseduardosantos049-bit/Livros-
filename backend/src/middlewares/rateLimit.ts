import type { NextFunction, Request, Response } from 'express';

interface Bucket { count: number; resetAt: number }

/** Limitador simples em memória — suficiente para uma app local / de portfólio. */
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    if (bucket.count >= options.max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: options.message ?? 'Muitas requisições. Tente novamente em instantes.' });
    }
    bucket.count += 1;
    return next();
  };
}
