export interface WorkSummary {
  workKey: string;              // /works/OL166894W
  title: string;
  authors: string[];
  coverId: number | null;
  coverUrl: string | null;
  firstPublishYear: number | null;
  editionCount: number;
  languages: string[];
  /** Quantos usuários da Open Library têm a obra em alguma estante. */
  readingLogCount: number;
  ratingsCount: number;
  ratingsAverage: number | null;
  /**
   * De onde o resultado veio. 'openlibrary' tem workKey e abre a lista de
   * edições; 'google' não tem chave de obra e é adicionado direto.
   */
  fonte: 'openlibrary' | 'google';
  /** Só em resultados do Google: dados já prontos para o cadastro direto. */
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
  /** De onde veio o número de páginas, quando não foi a Open Library. */
  pagesSource?: 'google';
  editionKey: string;           // /books/OL7353617M
  title: string;
  publishers: string[];
  publishDate: string | null;
  numberOfPages: number | null;
  isbn: string | null;
  languages: string[];
  coverId: number | null;
  coverUrl: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** Resultado da leitura do código de barras: uma edição concreta, já identificada. */
export interface IsbnLookup {
  isbn: string;
  title: string;
  authors: string[];
  publisher: string | null;
  publishDate: string | null;
  numberOfPages: number | null;
  coverUrl: string | null;
  /** 'openlibrary' permite adicionar à biblioteca; 'google' é só informativo. */
  fonte: 'openlibrary' | 'google';
  /** Presentes apenas quando a fonte é a Open Library. */
  workKey: string | null;
  editionKey: string | null;
}
