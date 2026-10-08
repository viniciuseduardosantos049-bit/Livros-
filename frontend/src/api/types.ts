export type ReadingStatus = 'WANT_TO_READ' | 'READING' | 'PAUSED' | 'FINISHED' | 'ABANDONED';

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  WANT_TO_READ: 'Quero ler',
  READING: 'Lendo',
  PAUSED: 'Pausado',
  FINISHED: 'Concluído',
  ABANDONED: 'Abandonado',
};

export const STATUS_ORDER: ReadingStatus[] = ['READING', 'WANT_TO_READ', 'PAUSED', 'FINISHED', 'ABANDONED'];

export interface User { id: number; name: string; email: string; createdAt: string }

export interface WorkSummary {
  workKey: string;
  title: string;
  authors: string[];
  coverId: number | null;
  coverUrl: string | null;
  firstPublishYear: number | null;
  editionCount: number;
  languages: string[];
  readingLogCount: number;
  ratingsCount: number;
  ratingsAverage: number | null;
  fonte: 'openlibrary' | 'google';
  /** Título catalogado, quando foi substituído pelo da edição na língua da busca. */
  tituloOriginal?: string;
  /** Só em resultados do Google: dados prontos para identificar a edição. */
  volume?: {
    googleId: string;
    publisher: string | null;
    publishDate: string | null;
    numberOfPages: number | null;
    isbn: string | null;
  };
}

export interface WorkDetail extends WorkSummary {
  description: string | null;
  subjects: string[];
}

export interface EditionSummary {
  /** Presente quando o número de páginas não veio da Open Library. */
  pagesSource?: 'google';
  editionKey: string;
  title: string;
  publishers: string[];
  publishDate: string | null;
  numberOfPages: number | null;
  isbn: string | null;
  languages: string[];
  coverId: number | null;
  coverUrl: string | null;
}

export interface Paginated<T> { items: T[]; page: number; perPage: number; total: number; totalPages: number }

export interface LibraryItem {
  id: number;
  status: ReadingStatus;
  currentPage: number;
  totalPages: number | null;
  percent: number | null;
  rating: number | null;
  isFavorite: boolean;
  notes: string | null;
  addedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  work: { workKey: string; title: string; authors: string[]; firstPublishYear: number | null };
  edition: {
    id: number;
    editionKey: string | null;
    title: string;
    publisher: string | null;
    publishDate: string | null;
    catalogPages: number | null;
    isbn: string | null;
    language: string | null;
    isCustom: boolean;
    coverUrl: string | null;
  };
}

export interface ProgressSummary {
  daysReading: number;
  pagesPerDay: number;
  pagesRemaining: number | null;
  daysRemaining: number | null;
  estimatedFinishDate: string | null;
  sessions: number;
  streak: number;
}

export interface ProgressEntry { id: number; pageFrom: number; pageTo: number; pagesRead: number; note: string | null; createdAt: string }
export interface Annotation { id: number; page: number | null; title: string | null; content: string; createdAt: string; updatedAt: string }
export interface Quote { id: number; page: number | null; text: string; comment: string | null; isFavorite: number | boolean; createdAt: string; updatedAt: string }

export interface NotesSearchResult {
  term: string;
  annotations: (Annotation & { libraryItemId: number; bookTitle: string; authors: string[] })[];
  quotes: (Quote & { libraryItemId: number; bookTitle: string; authors: string[] })[];
}

export type AiMotivoDesligado = 'sem-provider' | 'provider-desconhecido' | 'sem-chave' | null;
export interface AiStatus { enabled: boolean; provider: string; motivo?: AiMotivoDesligado }

export interface PushChavePublica { enabled: boolean; publicKey: string | null }

export interface AiExplanation { text: string; mode: string; provider: string; sources: string[] }

export interface Stats {
  byStatus: Partial<Record<ReadingStatus, number>>;
  streak: number;
  pagesLast30: number;
  averagePagesPerDay: number;
  totals: { books: number; pagesRead: number; averageRating: number; annotations: number; quotes: number };
  daily: { day: string; pages: number }[];
  recent: { id: number; pageFrom: number; pageTo: number; pagesRead: number; createdAt: string; libraryItemId: number; bookTitle: string }[];
  reading: ReadingNow[];
}

/** Livro em andamento, com a projeção de ritmo já calculada pelo servidor. */
export interface ReadingNow {
  libraryItemId: number;
  workKey: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  currentPage: number;
  totalPages: number | null;
  percent: number | null;
  daysRemaining: number | null;
  pagesRemaining: number | null;
  estimatedFinishDate: string | null;
}

/** Livro identificado pelo código de barras da contracapa. */
export interface IsbnLookup {
  isbn: string;
  title: string;
  authors: string[];
  publisher: string | null;
  publishDate: string | null;
  numberOfPages: number | null;
  coverUrl: string | null;
  fonte: 'openlibrary' | 'google';
  workKey: string | null;
  editionKey: string | null;
}
