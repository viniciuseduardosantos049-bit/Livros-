import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  static badRequest(msg: string, details?: unknown) { return new HttpError(400, msg, details); }
  static unauthorized(msg = 'Não autenticado') { return new HttpError(401, msg); }
  static forbidden(msg = 'Acesso negado') { return new HttpError(403, msg); }
  static notFound(msg = 'Recurso não encontrado') { return new HttpError(404, msg); }
  static conflict(msg: string) { return new HttpError(409, msg); }
  static badGateway(msg: string) { return new HttpError(502, msg); }
}

/** Encaminha erros de handlers async para o middleware de erro. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
