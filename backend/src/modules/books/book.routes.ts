import { Router } from 'express';
import { z } from 'zod';
import { HttpError, asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { bookService } from './book.service.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

const searchSchema = paginationSchema.extend({
  q: z.string().min(2, 'Informe ao menos 2 caracteres'),
});

export const bookRouter = Router();

// A busca também exige login: assim o consumo da Open Library fica sob controle.
bookRouter.use(requireAuth);

bookRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { q, page, perPage } = searchSchema.parse(req.query);
    res.json(await bookService.search(q, page, perPage));
  }),
);

bookRouter.get(
  '/isbn/:isbn',
  asyncHandler(async (req, res) => {
    const resultado = await bookService.findByIsbn(String(req.params.isbn));
    if (!resultado) {
      throw HttpError.notFound('Código lido, mas o livro não está em nenhum dos catálogos');
    }
    res.json(resultado);
  }),
);

bookRouter.get(
  '/works/:workId',
  asyncHandler(async (req, res) => {
    res.json(await bookService.getWork(String(req.params.workId)));
  }),
);

bookRouter.get(
  '/works/:workId/editions',
  asyncHandler(async (req, res) => {
    const { page, perPage } = paginationSchema.parse(req.query);
    res.json(await bookService.getEditions(String(req.params.workId), page, perPage));
  }),
);
