import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../lib/http.js';

export interface AuthUser {
  id: number;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function readToken(req: Request): string | null {
  const cookie = req.cookies?.[env.cookieName];
  if (typeof cookie === 'string' && cookie.length > 0) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Bloqueia a requisição quando não há sessão válida. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next(HttpError.unauthorized());
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    if (!payload.sub) return next(HttpError.unauthorized());
    req.user = { id: Number(payload.sub), email: String(payload.email ?? '') };
    return next();
  } catch {
    return next(HttpError.unauthorized('Sessão expirada ou inválida'));
  }
}
