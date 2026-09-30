import { db } from '../../db/index.js';
import { HttpError } from '../../lib/http.js';
import type { AiProvider, ExplainInput, Explanation } from './ai.provider.js';
import { createAiProvider } from './provider.factory.js';

/**
 * Orquestra a explicação: monta o contexto a partir do que o usuário já
 * registrou (anotações e trechos daquele livro) e delega ao provider.
 * O contexto nunca sai daqui sem passar pelo filtro de user_id.
 */
export class AiService {
  constructor(private readonly provider: AiProvider = createAiProvider()) {}

  get enabled(): boolean {
    return this.provider.enabled;
  }

  get providerName(): string {
    return this.provider.name;
  }

  async explain(
    userId: number,
    input: ExplainInput & { libraryItemId?: number },
  ): Promise<Explanation> {
    const sources: string[] = [];
    let context = input.context ?? '';
    let bookTitle = input.bookTitle;

    if (input.libraryItemId) {
      const book = await db
        .prepare(
          `SELECT w.title AS title FROM user_library ul
             JOIN book_editions e ON e.id = ul.edition_id
             JOIN book_works    w ON w.id = e.work_id
            WHERE ul.id = ? AND ul.user_id = ?`,
        )
        .get(input.libraryItemId, userId) as { title: string } | undefined;
      if (!book) throw HttpError.notFound('Livro não encontrado na sua biblioteca');
      bookTitle = book.title;

      const related = await db
        .prepare(
          `SELECT text AS content FROM quotes WHERE library_item_id = @item
            UNION ALL
           SELECT content FROM annotations WHERE library_item_id = @item
            LIMIT 20`,
        )
        .all({ item: input.libraryItemId }) as { content: string }[];

      if (related.length > 0) {
        context = [context, ...related.map((r) => r.content)].filter(Boolean).join('\n---\n');
        sources.push(`${related.length} registros seus sobre "${book.title}"`);
      }
    }

    const explanation = await this.provider.explain({ ...input, context: context || undefined, bookTitle });

    // O provider não sabe de onde veio o contexto; quem montou foi este serviço.
    return { ...explanation, sources: [...sources, ...explanation.sources] };
  }
}

export const aiService = new AiService();
