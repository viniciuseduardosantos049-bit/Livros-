import { env } from '../../../config/env.js';
import { TtlCache } from '../../../lib/cache.js';
import { HttpError } from '../../../lib/http.js';
import { cleanDescription } from '../../../lib/text.js';
import type { EditionSummary, Paginated, WorkDetail, WorkSummary } from '../book.types.js';

const SEARCH_FIELDS = [
  'key',
  'title',
  'author_name',
  'cover_i',
  'first_publish_year',
  'edition_count',
  'language',
  // Sinais de popularidade usados para ordenar os resultados (ver book.service).
  'readinglog_count',
  'ratings_count',
  'ratings_average',
  // Usados para deduplicar entre fontes e para recuperar o título na língua da edição.
  'isbn',
  'cover_edition_key',
].join(',');

const WORK_KEY_PATTERN = /^\/works\/OL\d+W$/i;

export function coverUrl(coverId: number | null | undefined, size: 'S' | 'M' | 'L' = 'M'): string | null {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;
}

/**
 * Único ponto do projeto que conhece o formato da Open Library.
 * Qualquer outro provider (Google Books, etc.) só precisa implementar a mesma
 * interface pública: search / getWork / getEditions.
 */
export class OpenLibraryProvider {
  private readonly cache = new TtlCache<unknown>(1000 * 60 * 10);

  private async request<T>(pathname: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(pathname, env.openLibraryBaseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached) return cached as T;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.openLibraryTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': env.userAgent },
      });
      if (response.status === 404) throw HttpError.notFound('Registro não encontrado na Open Library');
      if (!response.ok) throw HttpError.badGateway(`Open Library respondeu ${response.status}`);
      const data = (await response.json()) as T;
      this.cache.set(cacheKey, data);
      return data;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw HttpError.badGateway('Tempo limite excedido ao consultar a Open Library');
      }
      throw HttpError.badGateway('Falha de comunicação com a Open Library');
    } finally {
      clearTimeout(timer);
    }
  }

  async search(query: string, page = 1, perPage = 20): Promise<Paginated<WorkSummary>> {
    const data = await this.request<{ numFound: number; docs: OlSearchDoc[] }>('/search.json', {
      q: query,
      page,
      limit: perPage,
      fields: SEARCH_FIELDS,
    });

    // A busca pode repetir a mesma obra em páginas/edições diferentes: deduplicamos pela work key.
    const seen = new Set<string>();
    const items: WorkSummary[] = [];
    for (const doc of data.docs ?? []) {
      // A Open Library também devolve edições órfãs (key /books/OL...M, sem obra associada).
      // Elas não abrem em /obras/:workId, então ficam de fora dos resultados.
      if (!doc.key || !WORK_KEY_PATTERN.test(doc.key) || seen.has(doc.key)) continue;
      seen.add(doc.key);
      items.push(this.toWorkSummary(doc));
    }

    // Registros sem capa costumam ser cadastros incompletos: vão para o fim da página,
    // sem sumir da lista. sort() é estável, então a ordem de relevância da API é preservada.
    items.sort((a, b) => Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl)));

    const total = data.numFound ?? items.length;
    return { items, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  /**
   * Título da edição que a Open Library elegeu como representativa.
   *
   * O título da OBRA costuma ser o original ou uma transliteração — a obra de
   * "Memórias do subsolo" está catalogada como "Zapiski Iz Podpolia". A edição
   * da capa, por outro lado, é quase sempre a da língua do leitor. Devolve null
   * em qualquer falha: isto é melhoria de exibição, não pode quebrar a busca.
   */
  async getTituloDaEdicao(editionKey: string): Promise<string | null> {
    try {
      const entry = await this.request<OlEdition>(`/books/${editionKey}.json`);
      return entry.title?.trim() || null;
    } catch {
      return null;
    }
  }

  async getWork(workKey: string): Promise<WorkDetail> {
    const key = normalizeWorkKey(workKey);
    const work = await this.request<OlWork>(`${key}.json`);

    // O endpoint da obra não traz autores por nome; a busca por key resolve isso em 1 chamada.
    const search = await this.request<{ docs: OlSearchDoc[] }>('/search.json', {
      q: `key:${key}`,
      limit: 1,
      fields: SEARCH_FIELDS,
    });
    const doc = search.docs?.[0];

    return {
      workKey: key,
      title: work.title ?? doc?.title ?? 'Sem título',
      authors: doc?.author_name ?? [],
      coverId: work.covers?.[0] ?? doc?.cover_i ?? null,
      coverUrl: coverUrl(work.covers?.[0] ?? doc?.cover_i ?? null, 'L'),
      firstPublishYear: doc?.first_publish_year ?? null,
      editionCount: doc?.edition_count ?? 0,
      languages: doc?.language ?? [],
      readingLogCount: doc?.readinglog_count ?? 0,
      ratingsCount: doc?.ratings_count ?? 0,
      ratingsAverage: doc?.ratings_average ?? null,
      fonte: 'openlibrary',
      isbns: doc?.isbn ?? [],
      coverEditionKey: doc?.cover_edition_key ?? null,
      description: readDescription(work.description),
      subjects: (work.subjects ?? []).slice(0, 12),
    };
  }

  async getEditions(workKey: string, page = 1, perPage = 20): Promise<Paginated<EditionSummary>> {
    const key = normalizeWorkKey(workKey);
    const offset = (page - 1) * perPage;
    const data = await this.request<{ size: number; entries: OlEdition[] }>(`${key}/editions.json`, {
      limit: perPage,
      offset,
    });

    const items = (data.entries ?? []).map((entry) => this.toEditionSummary(entry));
    const total = data.size ?? items.length;
    return { items, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  /**
   * Edição a partir do ISBN. A Open Library responde /isbn/<isbn>.json com
   * redirect para a edição canônica; o fetch já segue o 302.
   * Devolve null quando não está catalogado — não é erro, é ausência.
   */
  async getEditionByIsbn(isbn: string): Promise<(EditionSummary & { workKey: string | null }) | null> {
    try {
      const entry = await this.request<OlEdition>(`/isbn/${isbn}.json`);
      return {
        ...this.toEditionSummary(entry),
        workKey: entry.works?.[0]?.key ?? null,
      };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getEdition(editionKey: string): Promise<EditionSummary & { workKey: string | null }> {
    const key = normalizeEditionKey(editionKey);
    const entry = await this.request<OlEdition>(`${key}.json`);
    return {
      ...this.toEditionSummary(entry),
      workKey: entry.works?.[0]?.key ?? null,
    };
  }

  private toWorkSummary(doc: OlSearchDoc): WorkSummary {
    return {
      workKey: doc.key,
      title: doc.title ?? 'Sem título',
      authors: doc.author_name ?? [],
      coverId: doc.cover_i ?? null,
      coverUrl: coverUrl(doc.cover_i ?? null),
      firstPublishYear: doc.first_publish_year ?? null,
      editionCount: doc.edition_count ?? 0,
      languages: doc.language ?? [],
      readingLogCount: doc.readinglog_count ?? 0,
      ratingsCount: doc.ratings_count ?? 0,
      ratingsAverage: doc.ratings_average ?? null,
      fonte: 'openlibrary',
      isbns: doc.isbn ?? [],
      coverEditionKey: doc.cover_edition_key ?? null,
    };
  }

  private toEditionSummary(entry: OlEdition): EditionSummary {
    const isbn = entry.isbn_13?.[0] ?? entry.isbn_10?.[0] ?? null;
    return {
      editionKey: entry.key,
      title: entry.title ?? 'Sem título',
      publishers: entry.publishers ?? [],
      publishDate: entry.publish_date ?? null,
      numberOfPages: typeof entry.number_of_pages === 'number' ? entry.number_of_pages : null,
      isbn,
      languages: (entry.languages ?? []).map((l) => l.key.replace('/languages/', '')),
      coverId: entry.covers?.[0] ?? null,
      coverUrl: coverUrl(entry.covers?.[0] ?? null),
    };
  }
}

export function normalizeWorkKey(input: string): string {
  const raw = decodeURIComponent(input).trim();
  const id = raw.replace(/^\/?works\//, '').replace(/^\//, '');
  if (!/^OL\d+W$/i.test(id)) throw HttpError.badRequest(`Chave de obra inválida: ${input}`);
  return `/works/${id.toUpperCase()}`;
}

export function normalizeEditionKey(input: string): string {
  const raw = decodeURIComponent(input).trim();
  const id = raw.replace(/^\/?books\//, '').replace(/^\//, '');
  if (!/^OL\d+M$/i.test(id)) throw HttpError.badRequest(`Chave de edição inválida: ${input}`);
  return `/books/${id.toUpperCase()}`;
}

function readDescription(value: OlWork['description']): string | null {
  if (!value) return null;
  return cleanDescription(typeof value === 'string' ? value : value.value);
}

interface OlSearchDoc {
  key: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  edition_count?: number;
  language?: string[];
  /** Quantos usuários da Open Library puseram a obra em alguma estante. */
  readinglog_count?: number;
  ratings_count?: number;
  ratings_average?: number;
  isbn?: string[];
  cover_edition_key?: string;
}

interface OlWork {
  title?: string;
  covers?: number[];
  subjects?: string[];
  description?: string | { value?: string };
}

interface OlEdition {
  key: string;
  title?: string;
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  isbn_10?: string[];
  isbn_13?: string[];
  languages?: { key: string }[];
  covers?: number[];
  works?: { key: string }[];
}
