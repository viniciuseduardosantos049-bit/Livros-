import { db } from '../../db/index.js';
import { HttpError } from '../../lib/http.js';
import { bookService, type CustomEditionInput } from '../books/book.service.js';
import { coverUrl } from '../books/providers/openLibrary.provider.js';
import { computePace, computeStreak, pageToPercent, percentToPage, resolveStatusForProgress } from '../../lib/reading.js';

export const READING_STATUSES = ['WANT_TO_READ', 'READING', 'PAUSED', 'FINISHED', 'ABANDONED'] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

interface LibraryRow {
  id: number;
  user_id: number;
  status: ReadingStatus;
  total_pages: number | null;
  current_page: number;
  rating: number | null;
  is_favorite: number;
  notes: string | null;
  added_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  edition_id: number;
  ol_edition_key: string | null;
  edition_title: string;
  publisher: string | null;
  publish_date: string | null;
  edition_pages: number | null;
  isbn: string | null;
  language: string | null;
  edition_cover_id: number | null;
  edition_cover_url: string | null;
  is_custom: number;
  ol_work_key: string;
  work_title: string;
  authors: string;
  work_cover_id: number | null;
  work_cover_url: string | null;
  first_publish_year: number | null;
}

const BASE_SELECT = `
  SELECT ul.id, ul.user_id, ul.status, ul.total_pages, ul.current_page, ul.rating, ul.is_favorite,
         ul.notes, ul.added_at, ul.started_at, ul.finished_at, ul.updated_at,
         e.id AS edition_id, e.ol_edition_key, e.title AS edition_title, e.publisher, e.publish_date,
         e.number_of_pages AS edition_pages, e.isbn, e.language, e.cover_id AS edition_cover_id, e.cover_url AS edition_cover_url, e.is_custom,
         w.ol_work_key, w.title AS work_title, w.authors, w.cover_id AS work_cover_id, w.cover_url AS work_cover_url, w.first_publish_year
    FROM user_library ul
    JOIN book_editions e ON e.id = ul.edition_id
    JOIN book_works    w ON w.id = e.work_id
`;

function serialize(row: LibraryRow) {
  const totalPages = row.total_pages ?? row.edition_pages ?? null;
  // A capa da Open Library (cover_id) tem prioridade; cover_url guarda a de fonte
  // externa, usada só quando a Open Library não ilustra o livro.
  const cover = row.edition_cover_id ?? row.work_cover_id ?? null;
  const capa = coverUrl(cover, 'M') ?? row.edition_cover_url ?? row.work_cover_url ?? null;
  const percent = pageToPercent(row.current_page, totalPages);

  return {
    id: row.id,
    status: row.status,
    currentPage: row.current_page,
    totalPages,
    percent,
    rating: row.rating,
    isFavorite: Boolean(row.is_favorite),
    notes: row.notes,
    addedAt: row.added_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    work: {
      workKey: row.ol_work_key,
      title: row.work_title,
      authors: JSON.parse(row.authors) as string[],
      firstPublishYear: row.first_publish_year,
    },
    edition: {
      id: row.edition_id,
      editionKey: row.ol_edition_key,
      title: row.edition_title,
      publisher: row.publisher,
      publishDate: row.publish_date,
      catalogPages: row.edition_pages,
      isbn: row.isbn,
      language: row.language,
      isCustom: Boolean(row.is_custom),
      coverUrl: capa,
    },
  };
}

export type LibraryItem = ReturnType<typeof serialize>;

function ownedRow(userId: number, itemId: number): LibraryRow {
  const row = db.prepare(`${BASE_SELECT} WHERE ul.id = ? AND ul.user_id = ?`).get(itemId, userId) as
    | LibraryRow
    | undefined;
  // 404 em vez de 403: não revelamos a existência de itens de outros usuários.
  if (!row) throw HttpError.notFound('Livro não encontrado na sua biblioteca');
  return row;
}

function touch(itemId: number) {
  db.prepare("UPDATE user_library SET updated_at = datetime('now') WHERE id = ?").run(itemId);
}

export interface AddToLibraryInput {
  workKey: string;
  editionKey?: string | null;
  status?: ReadingStatus;
  totalPages?: number | null;
  currentPage?: number;
  customEdition?: CustomEditionInput;
}

export const libraryService = {
  list(userId: number, filters: { status?: ReadingStatus; q?: string; favorite?: boolean }) {
    const where: string[] = ['ul.user_id = @userId'];
    const params: Record<string, unknown> = { userId };

    if (filters.status) {
      where.push('ul.status = @status');
      params.status = filters.status;
    }
    if (filters.favorite) where.push('ul.is_favorite = 1');
    if (filters.q) {
      where.push('(w.title LIKE @q OR e.title LIKE @q OR w.authors LIKE @q)');
      params.q = `%${filters.q}%`;
    }

    const rows = db
      .prepare(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ul.updated_at DESC`)
      .all(params) as LibraryRow[];
    return rows.map(serialize);
  },

  get(userId: number, itemId: number): LibraryItem {
    return serialize(ownedRow(userId, itemId));
  },

  async add(userId: number, input: AddToLibraryInput): Promise<LibraryItem> {
    const edition = await bookService.ensureEdition(input.workKey, input.editionKey, input.customEdition);

    const already = db
      .prepare('SELECT id FROM user_library WHERE user_id = ? AND edition_id = ?')
      .get(userId, edition.id) as { id: number } | undefined;
    if (already) throw HttpError.conflict('Esta edição já está na sua biblioteca');

    const status = input.status ?? 'WANT_TO_READ';
    const totalPages = input.totalPages ?? edition.number_of_pages ?? null;
    const currentPage = Math.max(0, input.currentPage ?? 0);
    if (totalPages && currentPage > totalPages) {
      throw HttpError.badRequest('A página atual não pode ser maior que o total de páginas');
    }

    const info = db
      .prepare(
        `INSERT INTO user_library (user_id, edition_id, status, total_pages, current_page, started_at)
         VALUES (@userId, @editionId, @status, @totalPages, @currentPage, @startedAt)`,
      )
      .run({
        userId,
        editionId: edition.id,
        status,
        totalPages,
        currentPage,
        startedAt: status === 'READING' || currentPage > 0 ? new Date().toISOString() : null,
      });

    const itemId = info.lastInsertRowid as number;
    if (currentPage > 0) {
      db.prepare(
        `INSERT INTO reading_progress (library_item_id, page_from, page_to, pages_read, note)
         VALUES (?, 0, ?, ?, 'Progresso inicial informado ao adicionar o livro')`,
      ).run(itemId, currentPage, currentPage);
    }

    return this.get(userId, itemId);
  },

  update(
    userId: number,
    itemId: number,
    patch: {
      status?: ReadingStatus;
      rating?: number | null;
      isFavorite?: boolean;
      totalPages?: number | null;
      notes?: string | null;
    },
  ): LibraryItem {
    const row = ownedRow(userId, itemId);
    const status = patch.status ?? row.status;
    const totalPages = patch.totalPages !== undefined ? patch.totalPages : row.total_pages;
    const effectiveTotal = totalPages ?? row.edition_pages;

    if (effectiveTotal && row.current_page > effectiveTotal) {
      throw HttpError.badRequest('O total de páginas informado é menor que a página atual registrada');
    }

    let startedAt = row.started_at;
    let finishedAt = row.finished_at;
    if (status === 'READING' && !startedAt) startedAt = new Date().toISOString();
    if (status === 'FINISHED' && !finishedAt) finishedAt = new Date().toISOString();
    if (status !== 'FINISHED') finishedAt = null;

    db.prepare(
      `UPDATE user_library
          SET status = @status,
              rating = @rating,
              is_favorite = @isFavorite,
              total_pages = @totalPages,
              notes = @notes,
              started_at = @startedAt,
              finished_at = @finishedAt,
              updated_at = datetime('now')
        WHERE id = @id AND user_id = @userId`,
    ).run({
      id: itemId,
      userId,
      status,
      rating: patch.rating !== undefined ? patch.rating : row.rating,
      isFavorite: (patch.isFavorite !== undefined ? patch.isFavorite : Boolean(row.is_favorite)) ? 1 : 0,
      totalPages,
      notes: patch.notes !== undefined ? patch.notes : row.notes,
      startedAt,
      finishedAt,
    });

    return this.get(userId, itemId);
  },

  remove(userId: number, itemId: number): void {
    ownedRow(userId, itemId);
    db.prepare('DELETE FROM user_library WHERE id = ? AND user_id = ?').run(itemId, userId);
  },

  /**
   * Item 7 — registro de progresso.
   * Aceita página absoluta ou percentual; o percentual só existe quando o total
   * de páginas do exemplar é conhecido. Toda atualização vira um evento no
   * histórico, inclusive correções para trás (pages_read negativo).
   */
  updateProgress(
    userId: number,
    itemId: number,
    input: { page?: number; percent?: number; note?: string },
  ): LibraryItem {
    const row = ownedRow(userId, itemId);
    const totalPages = row.total_pages ?? row.edition_pages ?? null;

    if (input.page === undefined && input.percent === undefined) {
      throw HttpError.badRequest('Informe a página atual ou o percentual lido');
    }
    if (input.percent !== undefined && !totalPages) {
      throw HttpError.badRequest(
        'Para usar percentual, informe antes quantas páginas tem o seu exemplar',
      );
    }

    const currentPage =
      input.page !== undefined ? input.page : percentToPage(input.percent!, totalPages!);

    if (currentPage < 0) throw HttpError.badRequest('A página atual não pode ser negativa');
    if (totalPages && currentPage > totalPages) {
      throw HttpError.badRequest(`Esta edição tem ${totalPages} páginas`);
    }
    if (currentPage === row.current_page && !input.note) {
      // Nada mudou: evita poluir o histórico com registros repetidos.
      return this.get(userId, itemId);
    }

    const transition = resolveStatusForProgress(row.status, currentPage, totalPages, {
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    });
    const pagesRead = currentPage - row.current_page;

    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO reading_progress (library_item_id, page_from, page_to, pages_read, note)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(itemId, row.current_page, currentPage, pagesRead, input.note?.trim() || null);

      db.prepare(
        `UPDATE user_library
            SET current_page = @currentPage,
                status = @status,
                started_at = @startedAt,
                finished_at = @finishedAt,
                updated_at = datetime('now')
          WHERE id = @id AND user_id = @userId`,
      ).run({
        id: itemId,
        userId,
        currentPage,
        status: transition.status,
        startedAt: transition.startedAt,
        finishedAt: transition.finishedAt,
      });
    });
    run();

    return this.get(userId, itemId);
  },

  /** Atalho de "terminei o livro": pula para a última página. */
  finishReading(userId: number, itemId: number): LibraryItem {
    const row = ownedRow(userId, itemId);
    const totalPages = row.total_pages ?? row.edition_pages ?? null;
    if (!totalPages) {
      throw HttpError.badRequest('Informe quantas páginas tem o seu exemplar antes de concluir');
    }
    return this.updateProgress(userId, itemId, { page: totalPages, note: 'Leitura concluída' });
  },

  /** Zera o progresso e o histórico, mantendo anotações e trechos. */
  resetProgress(userId: number, itemId: number): LibraryItem {
    ownedRow(userId, itemId);
    const run = db.transaction(() => {
      db.prepare('DELETE FROM reading_progress WHERE library_item_id = ?').run(itemId);
      db.prepare(
        `UPDATE user_library
            SET current_page = 0, status = 'WANT_TO_READ', started_at = NULL, finished_at = NULL,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      ).run(itemId, userId);
    });
    run();
    return this.get(userId, itemId);
  },

  progressHistory(userId: number, itemId: number) {
    const row = ownedRow(userId, itemId);
    const history = db
      .prepare(
        `SELECT id, page_from AS pageFrom, page_to AS pageTo, pages_read AS pagesRead, note, created_at AS createdAt
           FROM reading_progress WHERE library_item_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(itemId) as { createdAt: string }[];

    const days = db
      .prepare('SELECT DISTINCT date(created_at) AS day FROM reading_progress WHERE library_item_id = ?')
      .all(itemId) as { day: string }[];

    const pace = computePace({
      currentPage: row.current_page,
      totalPages: row.total_pages ?? row.edition_pages ?? null,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    });

    return {
      history,
      summary: { ...pace, sessions: history.length, streak: computeStreak(days.map((d) => d.day)) },
    };
  },

  // -------------------------------------------------------------------------
  // Anotações
  // -------------------------------------------------------------------------
  listAnnotations(userId: number, itemId: number) {
    ownedRow(userId, itemId);
    return db
      .prepare(
        `SELECT id, page, title, content, created_at AS createdAt, updated_at AS updatedAt
           FROM annotations WHERE library_item_id = ? ORDER BY COALESCE(page, 0), created_at DESC`,
      )
      .all(itemId);
  },

  createAnnotation(userId: number, itemId: number, data: { page?: number | null; title?: string | null; content: string }) {
    ownedRow(userId, itemId);
    const info = db
      .prepare('INSERT INTO annotations (library_item_id, page, title, content) VALUES (?, ?, ?, ?)')
      .run(itemId, data.page ?? null, data.title?.trim() || null, data.content.trim());
    touch(itemId);
    return db.prepare('SELECT id, page, title, content, created_at AS createdAt, updated_at AS updatedAt FROM annotations WHERE id = ?')
      .get(info.lastInsertRowid as number);
  },

  updateAnnotation(userId: number, itemId: number, annotationId: number, data: { page?: number | null; title?: string | null; content?: string }) {
    ownedRow(userId, itemId);
    const current = db.prepare('SELECT * FROM annotations WHERE id = ? AND library_item_id = ?').get(annotationId, itemId) as
      | { page: number | null; title: string | null; content: string }
      | undefined;
    if (!current) throw HttpError.notFound('Anotação não encontrada');

    db.prepare(
      `UPDATE annotations SET page = @page, title = @title, content = @content, updated_at = datetime('now')
        WHERE id = @id AND library_item_id = @itemId`,
    ).run({
      id: annotationId,
      itemId,
      page: data.page !== undefined ? data.page : current.page,
      title: data.title !== undefined ? data.title : current.title,
      content: data.content !== undefined ? data.content.trim() : current.content,
    });
    touch(itemId);
    return db.prepare('SELECT id, page, title, content, created_at AS createdAt, updated_at AS updatedAt FROM annotations WHERE id = ?')
      .get(annotationId);
  },

  deleteAnnotation(userId: number, itemId: number, annotationId: number) {
    ownedRow(userId, itemId);
    const info = db.prepare('DELETE FROM annotations WHERE id = ? AND library_item_id = ?').run(annotationId, itemId);
    if (info.changes === 0) throw HttpError.notFound('Anotação não encontrada');
  },

  // -------------------------------------------------------------------------
  // Frases e trechos
  // -------------------------------------------------------------------------
  listQuotes(userId: number, itemId: number) {
    ownedRow(userId, itemId);
    return db
      .prepare(
        `SELECT id, page, text, comment, is_favorite AS isFavorite, created_at AS createdAt, updated_at AS updatedAt
           FROM quotes WHERE library_item_id = ? ORDER BY COALESCE(page, 0), created_at DESC`,
      )
      .all(itemId);
  },

  createQuote(userId: number, itemId: number, data: { page?: number | null; text: string; comment?: string | null; isFavorite?: boolean }) {
    ownedRow(userId, itemId);
    const info = db
      .prepare('INSERT INTO quotes (library_item_id, page, text, comment, is_favorite) VALUES (?, ?, ?, ?, ?)')
      .run(itemId, data.page ?? null, data.text.trim(), data.comment?.trim() || null, data.isFavorite ? 1 : 0);
    touch(itemId);
    return db.prepare('SELECT id, page, text, comment, is_favorite AS isFavorite, created_at AS createdAt, updated_at AS updatedAt FROM quotes WHERE id = ?')
      .get(info.lastInsertRowid as number);
  },

  updateQuote(userId: number, itemId: number, quoteId: number, data: { page?: number | null; text?: string; comment?: string | null; isFavorite?: boolean }) {
    ownedRow(userId, itemId);
    const current = db.prepare('SELECT * FROM quotes WHERE id = ? AND library_item_id = ?').get(quoteId, itemId) as
      | { page: number | null; text: string; comment: string | null; is_favorite: number }
      | undefined;
    if (!current) throw HttpError.notFound('Trecho não encontrado');

    db.prepare(
      `UPDATE quotes SET page = @page, text = @text, comment = @comment, is_favorite = @isFavorite,
              updated_at = datetime('now')
        WHERE id = @id AND library_item_id = @itemId`,
    ).run({
      id: quoteId,
      itemId,
      page: data.page !== undefined ? data.page : current.page,
      text: data.text !== undefined ? data.text.trim() : current.text,
      comment: data.comment !== undefined ? data.comment : current.comment,
      isFavorite: (data.isFavorite !== undefined ? data.isFavorite : Boolean(current.is_favorite)) ? 1 : 0,
    });
    touch(itemId);
    return db.prepare('SELECT id, page, text, comment, is_favorite AS isFavorite, created_at AS createdAt, updated_at AS updatedAt FROM quotes WHERE id = ?')
      .get(quoteId);
  },

  deleteQuote(userId: number, itemId: number, quoteId: number) {
    ownedRow(userId, itemId);
    const info = db.prepare('DELETE FROM quotes WHERE id = ? AND library_item_id = ?').run(quoteId, itemId);
    if (info.changes === 0) throw HttpError.notFound('Trecho não encontrado');
  },

  /**
   * Busca por palavras/conceitos nas anotações e trechos do usuário.
   * É o gancho onde a IA vai entrar depois (mesma assinatura, resultados enriquecidos).
   */
  searchNotes(userId: number, term: string) {
    const like = `%${term}%`;
    const annotations = db
      .prepare(
        `SELECT a.id, a.page, a.title, a.content, a.created_at AS createdAt,
                ul.id AS libraryItemId, w.title AS bookTitle, w.authors
           FROM annotations a
           JOIN user_library ul ON ul.id = a.library_item_id
           JOIN book_editions e ON e.id = ul.edition_id
           JOIN book_works    w ON w.id = e.work_id
          WHERE ul.user_id = ? AND (a.content LIKE ? OR a.title LIKE ?)
          ORDER BY a.created_at DESC LIMIT 100`,
      )
      .all(userId, like, like) as Array<Record<string, unknown> & { authors: string }>;

    const quotes = db
      .prepare(
        `SELECT q.id, q.page, q.text, q.comment, q.is_favorite AS isFavorite, q.created_at AS createdAt,
                ul.id AS libraryItemId, w.title AS bookTitle, w.authors
           FROM quotes q
           JOIN user_library ul ON ul.id = q.library_item_id
           JOIN book_editions e ON e.id = ul.edition_id
           JOIN book_works    w ON w.id = e.work_id
          WHERE ul.user_id = ? AND (q.text LIKE ? OR q.comment LIKE ?)
          ORDER BY q.created_at DESC LIMIT 100`,
      )
      .all(userId, like, like) as Array<Record<string, unknown> & { authors: string }>;

    const parse = (rows: Array<Record<string, unknown> & { authors: string }>) =>
      rows.map((r) => ({ ...r, authors: JSON.parse(r.authors) as string[] }));

    return { term, annotations: parse(annotations), quotes: parse(quotes) };
  },
};
