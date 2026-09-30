import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { READING_STATUSES, libraryService } from './library.service.js';

const statusSchema = z.enum(READING_STATUSES);
const idParam = z.coerce.number().int().positive();
const pageField = z.coerce.number().int().min(0).nullable().optional();

export const libraryRouter = Router();
libraryRouter.use(requireAuth);

const addSchema = z.object({
  workKey: z.string().min(3),
  editionKey: z.string().min(3).nullish(),
  status: statusSchema.optional(),
  totalPages: z.coerce.number().int().positive().nullish(),
  currentPage: z.coerce.number().int().min(0).optional(),
  customEdition: z
    .object({
      title: z.string().trim().max(300).optional(),
      publisher: z.string().trim().max(200).optional(),
      publishDate: z.string().trim().max(50).optional(),
      numberOfPages: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

libraryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        status: statusSchema.optional(),
        q: z.string().trim().min(1).optional(),
        favorite: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    res.json({ items: libraryService.list(req.user!.id, { ...query, favorite: query.favorite === 'true' }) });
  }),
);

libraryRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = addSchema.parse(req.body);
    res.status(201).json({ item: await libraryService.add(req.user!.id, data) });
  }),
);

libraryRouter.get(
  '/notes/search',
  asyncHandler(async (req, res) => {
    const { q } = z.object({ q: z.string().trim().min(2, 'Informe ao menos 2 caracteres') }).parse(req.query);
    res.json(libraryService.searchNotes(req.user!.id, q));
  }),
);

libraryRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ item: libraryService.get(req.user!.id, idParam.parse(req.params.id)) });
  }),
);

libraryRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = z
      .object({
        status: statusSchema.optional(),
        rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
        isFavorite: z.boolean().optional(),
        totalPages: z.coerce.number().int().positive().nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
      })
      .parse(req.body);
    res.json({ item: libraryService.update(req.user!.id, idParam.parse(req.params.id), patch) });
  }),
);

libraryRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    libraryService.remove(req.user!.id, idParam.parse(req.params.id));
    res.status(204).end();
  }),
);

libraryRouter.post(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        currentPage: z.coerce.number().int().min(0).optional(),
        percent: z.coerce.number().min(0).max(100).optional(),
        note: z.string().trim().max(500).optional(),
      })
      .refine((value) => value.currentPage !== undefined || value.percent !== undefined, {
        message: 'Informe a página atual ou o percentual lido',
      })
      .parse(req.body);

    const item = libraryService.updateProgress(req.user!.id, idParam.parse(req.params.id), {
      page: data.currentPage,
      percent: data.percent,
      note: data.note,
    });
    res.json({ item });
  }),
);

libraryRouter.post(
  '/:id/progress/finish',
  asyncHandler(async (req, res) => {
    res.json({ item: libraryService.finishReading(req.user!.id, idParam.parse(req.params.id)) });
  }),
);

libraryRouter.delete(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    res.json({ item: libraryService.resetProgress(req.user!.id, idParam.parse(req.params.id)) });
  }),
);

libraryRouter.get(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    res.json(libraryService.progressHistory(req.user!.id, idParam.parse(req.params.id)));
  }),
);

// --- anotações ---------------------------------------------------------------
libraryRouter.get(
  '/:id/annotations',
  asyncHandler(async (req, res) => {
    res.json({ annotations: libraryService.listAnnotations(req.user!.id, idParam.parse(req.params.id)) });
  }),
);

libraryRouter.post(
  '/:id/annotations',
  asyncHandler(async (req, res) => {
    const data = z
      .object({ page: pageField, title: z.string().trim().max(150).nullish(), content: z.string().trim().min(1).max(10000) })
      .parse(req.body);
    res.status(201).json({ annotation: libraryService.createAnnotation(req.user!.id, idParam.parse(req.params.id), data) });
  }),
);

libraryRouter.patch(
  '/:id/annotations/:annotationId',
  asyncHandler(async (req, res) => {
    const data = z
      .object({ page: pageField, title: z.string().trim().max(150).nullish(), content: z.string().trim().min(1).max(10000).optional() })
      .parse(req.body);
    res.json({
      annotation: libraryService.updateAnnotation(
        req.user!.id,
        idParam.parse(req.params.id),
        idParam.parse(req.params.annotationId),
        data,
      ),
    });
  }),
);

libraryRouter.delete(
  '/:id/annotations/:annotationId',
  asyncHandler(async (req, res) => {
    libraryService.deleteAnnotation(req.user!.id, idParam.parse(req.params.id), idParam.parse(req.params.annotationId));
    res.status(204).end();
  }),
);

// --- frases e trechos --------------------------------------------------------
libraryRouter.get(
  '/:id/quotes',
  asyncHandler(async (req, res) => {
    res.json({ quotes: libraryService.listQuotes(req.user!.id, idParam.parse(req.params.id)) });
  }),
);

libraryRouter.post(
  '/:id/quotes',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        page: pageField,
        text: z.string().trim().min(1).max(5000),
        comment: z.string().trim().max(2000).nullish(),
        isFavorite: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json({ quote: libraryService.createQuote(req.user!.id, idParam.parse(req.params.id), data) });
  }),
);

libraryRouter.patch(
  '/:id/quotes/:quoteId',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        page: pageField,
        text: z.string().trim().min(1).max(5000).optional(),
        comment: z.string().trim().max(2000).nullish(),
        isFavorite: z.boolean().optional(),
      })
      .parse(req.body);
    res.json({
      quote: libraryService.updateQuote(
        req.user!.id,
        idParam.parse(req.params.id),
        idParam.parse(req.params.quoteId),
        data,
      ),
    });
  }),
);

libraryRouter.delete(
  '/:id/quotes/:quoteId',
  asyncHandler(async (req, res) => {
    libraryService.deleteQuote(req.user!.id, idParam.parse(req.params.id), idParam.parse(req.params.quoteId));
    res.status(204).end();
  }),
);
