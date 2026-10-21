import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middlewares/auth.js';
import { computePace, computeStreak, pageToPercent } from '../../lib/reading.js';

export const statsRouter = Router();
statsRouter.use(requireAuth);

/** Cria ou atualiza a meta de livros do ano corrente. */
statsRouter.put(
  '/meta',
  asyncHandler(async (req, res) => {
    const { target } = z.object({ target: z.coerce.number().int().min(1).max(999) }).parse(req.body);
    const year = new Date().getFullYear();

    await db
      .prepare(
        `INSERT INTO reading_goals (user_id, year, target) VALUES (?, ?, ?)
         ON CONFLICT (user_id, year) DO UPDATE SET target = EXCLUDED.target, updated_at = now()`,
      )
      .run(req.user!.id, year, target);

    res.status(204).end();
  }),
);

statsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    const byStatus = await db
      .prepare('SELECT status, COUNT(*) AS total FROM user_library WHERE user_id = ? GROUP BY status')
      .all(userId) as { status: string; total: number }[];

    const totals = await db
      .prepare(
        `SELECT COUNT(*) AS books,
                COALESCE(SUM(ul.current_page), 0) AS "pagesRead",
                COALESCE(AVG(ul.rating), 0) AS "averageRating"
           FROM user_library ul WHERE ul.user_id = ?`,
      )
      .get(userId) as { books: number; pagesRead: number; averageRating: number };

    // Meta do ano corrente: null quando a pessoa nunca definiu uma.
    const ano = new Date().getFullYear();
    const metaRow = (await db.prepare('SELECT target FROM reading_goals WHERE user_id = ? AND year = ?').get(userId, ano)) as
      | { target: number }
      | undefined;
    const concluidosNoAno = (await db
      .prepare(
        `SELECT COUNT(*) AS total FROM user_library
          WHERE user_id = ? AND status = 'FINISHED' AND finished_at >= ? AND finished_at < ?`,
      )
      .get(userId, `${ano}-01-01`, `${ano + 1}-01-01`)) as { total: number };

    const counters = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM annotations a JOIN user_library ul ON ul.id = a.library_item_id WHERE ul.user_id = @u) AS annotations,
           (SELECT COUNT(*) FROM quotes q      JOIN user_library ul ON ul.id = q.library_item_id WHERE ul.user_id = @u) AS quotes`,
      )
      .get({ u: userId }) as { annotations: number; quotes: number };

    // Páginas lidas por dia nos últimos 30 dias (histórico de leitura).
    const daily = await db
      .prepare(
        `SELECT to_char(rp.created_at, 'YYYY-MM-DD') AS day, SUM(GREATEST(rp.pages_read, 0)) AS pages
           FROM reading_progress rp
           JOIN user_library ul ON ul.id = rp.library_item_id
          WHERE ul.user_id = ? AND rp.created_at >= now() - interval '30 days'
          GROUP BY day ORDER BY day`,
      )
      .all(userId) as { day: string; pages: number }[];

    const recent = await db
      .prepare(
        `SELECT rp.id, rp.page_from AS "pageFrom", rp.page_to AS "pageTo", rp.pages_read AS "pagesRead",
                rp.created_at AS "createdAt", ul.id AS "libraryItemId", w.title AS "bookTitle"
           FROM reading_progress rp
           JOIN user_library ul ON ul.id = rp.library_item_id
           JOIN book_editions e ON e.id = ul.edition_id
           JOIN book_works    w ON w.id = e.work_id
          WHERE ul.user_id = ?
          ORDER BY rp.created_at DESC, rp.id DESC LIMIT 15`,
      )
      .all(userId);

    const allDays = await db
      .prepare(
        `SELECT DISTINCT to_char(rp.created_at, 'YYYY-MM-DD') AS day
           FROM reading_progress rp JOIN user_library ul ON ul.id = rp.library_item_id
          WHERE ul.user_id = ? AND rp.pages_read > 0`,
      )
      .all(userId) as { day: string }[];

    const pagesLast30 = daily.reduce((sum, day) => sum + day.pages, 0);

    // Livros em andamento, do mais recente para o mais antigo. A tela de
    // estatísticas abre por eles, então a projeção de ritmo vem pronta daqui
    // em vez de o frontend pedir /progress de cada item (N+1).
    const emLeitura = await db
      .prepare(
        `SELECT ul.id, ul.current_page AS "currentPage", ul.total_pages AS "totalPages",
                ul.started_at AS "startedAt", ul.updated_at AS "updatedAt",
                w.title, w.authors, w.ol_work_key AS "workKey",
                COALESCE(e.cover_id, w.cover_id) AS "coverId",
                COALESCE(e.cover_url, w.cover_url) AS "coverUrlExterna"
           FROM user_library ul
           JOIN book_editions e ON e.id = ul.edition_id
           JOIN book_works    w ON w.id = e.work_id
          WHERE ul.user_id = ? AND ul.status = 'READING'
          ORDER BY ul.updated_at DESC`,
      )
      .all(userId) as {
        id: number; currentPage: number; totalPages: number | null;
        startedAt: string | null; updatedAt: string;
        title: string; authors: string; workKey: string;
        coverId: number | null; coverUrlExterna: string | null;
      }[];

    const reading = emLeitura.map((item) => {
      const pace = computePace({
        currentPage: item.currentPage,
        totalPages: item.totalPages,
        startedAt: item.startedAt,
        finishedAt: null,
      });
      return {
        libraryItemId: item.id,
        workKey: item.workKey,
        title: item.title,
        authors: JSON.parse(item.authors) as string[],
        coverUrl: item.coverId
          ? `https://covers.openlibrary.org/b/id/${item.coverId}-M.jpg`
          : item.coverUrlExterna,
        currentPage: item.currentPage,
        totalPages: item.totalPages,
        percent: pageToPercent(item.currentPage, item.totalPages),
        daysRemaining: pace.daysRemaining,
        pagesRemaining: pace.pagesRemaining,
        estimatedFinishDate: pace.estimatedFinishDate,
      };
    });

    res.json({
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.total])),
      streak: computeStreak(allDays.map((d) => d.day)),
      pagesLast30,
      averagePagesPerDay: Number((pagesLast30 / 30).toFixed(1)),
      totals: {
        books: totals.books,
        pagesRead: totals.pagesRead,
        averageRating: Number(totals.averageRating?.toFixed(2) ?? 0),
        annotations: counters.annotations,
        quotes: counters.quotes,
      },
      daily,
      recent,
      reading,
      goal: metaRow ? { year: ano, target: metaRow.target, completed: concluidosNoAno.total } : null,
    });
  }),
);
