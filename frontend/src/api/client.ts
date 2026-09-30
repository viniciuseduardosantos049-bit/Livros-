import type {
  AiExplanation, AiStatus, Annotation, EditionSummary, IsbnLookup, LibraryItem, NotesSearchResult, Paginated,
  ProgressEntry, ProgressSummary, Quote, ReadingStatus, Stats, User, WorkDetail, WorkSummary,
} from './types';

/** Disparado a cada resposta: detail=true quando veio do cache do service worker. */
export const EVENTO_DADOS_SALVOS = 'pwa:dados-salvos';

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, 'Não foi possível falar com o servidor. Verifique sua conexão.');
  }

  // O service worker marca a resposta quando ela veio do cache (servidor fora do
  // ar). A interface usa isso para avisar que o dado pode estar velho.
  window.dispatchEvent(
    new CustomEvent(EVENTO_DADOS_SALVOS, { detail: response.headers.get('X-Do-Cache') === '1' }),
  );

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? `Erro ${response.status}`;
    throw new ApiError(response.status, message, (payload as { details?: unknown } | null)?.details);
  }
  return payload as T;
}

const body = (data: unknown) => JSON.stringify(data);

export const api = {
  // auth
  register: (data: { name: string; email: string; password: string }) =>
    request<{ user: User }>('/auth/register', { method: 'POST', body: body(data) }),
  login: (data: { email: string; password: string }) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: body(data) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),

  // catálogo
  searchBooks: (q: string, page = 1, perPage = 12) =>
    request<Paginated<WorkSummary>>(`/books/search?q=${encodeURIComponent(q)}&page=${page}&perPage=${perPage}`),
  getWork: (workKey: string) => request<WorkDetail>(`/books/works/${encodeURIComponent(stripKey(workKey))}`),
  findByIsbn: (isbn: string) => request<IsbnLookup>(`/books/isbn/${encodeURIComponent(isbn)}`),
  getEditions: (workKey: string, page = 1, perPage = 10) =>
    request<Paginated<EditionSummary>>(`/books/works/${encodeURIComponent(stripKey(workKey))}/editions?page=${page}&perPage=${perPage}`),

  // biblioteca
  listLibrary: (params: { status?: ReadingStatus; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.q) search.set('q', params.q);
    const qs = search.toString();
    return request<{ items: LibraryItem[] }>(`/library${qs ? `?${qs}` : ''}`);
  },
  getLibraryItem: (id: number) => request<{ item: LibraryItem }>(`/library/${id}`),
  addToLibrary: (data: {
    workKey: string; editionKey?: string | null; status?: ReadingStatus;
    totalPages?: number | null; currentPage?: number;
    customEdition?: { title?: string; publisher?: string; publishDate?: string; numberOfPages?: number };
  }) => request<{ item: LibraryItem }>('/library', { method: 'POST', body: body(data) }),
  updateLibraryItem: (id: number, patch: Partial<{ status: ReadingStatus; rating: number | null; isFavorite: boolean; totalPages: number | null; notes: string | null }>) =>
    request<{ item: LibraryItem }>(`/library/${id}`, { method: 'PATCH', body: body(patch) }),
  removeLibraryItem: (id: number) => request<void>(`/library/${id}`, { method: 'DELETE' }),

  // progresso
  updateProgress: (id: number, data: { currentPage?: number; percent?: number; note?: string }) =>
    request<{ item: LibraryItem }>(`/library/${id}/progress`, { method: 'POST', body: body(data) }),
  finishReading: (id: number) => request<{ item: LibraryItem }>(`/library/${id}/progress/finish`, { method: 'POST' }),
  resetProgress: (id: number) => request<{ item: LibraryItem }>(`/library/${id}/progress`, { method: 'DELETE' }),
  progressHistory: (id: number) =>
    request<{ history: ProgressEntry[]; summary: ProgressSummary }>(`/library/${id}/progress`),

  // anotações
  listAnnotations: (id: number) => request<{ annotations: Annotation[] }>(`/library/${id}/annotations`),
  createAnnotation: (id: number, data: { page?: number | null; title?: string | null; content: string }) =>
    request<{ annotation: Annotation }>(`/library/${id}/annotations`, { method: 'POST', body: body(data) }),
  updateAnnotation: (id: number, annotationId: number, data: { page?: number | null; title?: string | null; content?: string }) =>
    request<{ annotation: Annotation }>(`/library/${id}/annotations/${annotationId}`, { method: 'PATCH', body: body(data) }),
  deleteAnnotation: (id: number, annotationId: number) =>
    request<void>(`/library/${id}/annotations/${annotationId}`, { method: 'DELETE' }),

  // trechos
  listQuotes: (id: number) => request<{ quotes: Quote[] }>(`/library/${id}/quotes`),
  createQuote: (id: number, data: { page?: number | null; text: string; comment?: string | null }) =>
    request<{ quote: Quote }>(`/library/${id}/quotes`, { method: 'POST', body: body(data) }),
  updateQuote: (id: number, quoteId: number, data: { page?: number | null; text?: string; comment?: string | null; isFavorite?: boolean }) =>
    request<{ quote: Quote }>(`/library/${id}/quotes/${quoteId}`, { method: 'PATCH', body: body(data) }),
  deleteQuote: (id: number, quoteId: number) => request<void>(`/library/${id}/quotes/${quoteId}`, { method: 'DELETE' }),

  // busca em anotações/trechos (ponto de extensão para a IA)
  searchNotes: (q: string) => request<NotesSearchResult>(`/library/notes/search?q=${encodeURIComponent(q)}`),

  stats: () => request<Stats>('/stats'),

  // IA (ponto de extensão — hoje responde 503 quando não há provider configurado)
  aiStatus: () => request<AiStatus>('/ai/status'),
  aiExplain: (data: { text: string; mode?: 'word' | 'passage' | 'concept'; context?: string; libraryItemId?: number }) =>
    request<{ explanation: AiExplanation }>('/ai/explain', { method: 'POST', body: body(data) }),
};

/** /works/OL166894W -> OL166894W (a rota aceita só o id) */
function stripKey(key: string): string {
  return key.replace(/^\/?(works|books)\//, '');
}
