import { env } from '../../../config/env.js';
import { TtlCache } from '../../../lib/cache.js';

/**
 * Fonte secundária de capas. A Open Library não tem imagem para boa parte do
 * catálogo em português — medido em ~35% a 85% de cobertura, dependendo da busca —
 * e não há de onde tirar mais: o `cover_i` da busca já é a melhor capa entre as
 * edições da obra.
 *
 * Este provider preenche só a capa. Título, autor e edições continuam vindo da
 * Open Library: nada aqui vira fonte de verdade sobre o livro.
 *
 * Falhar aqui nunca é erro — o chamador recebe `null` e cai no marcador gerado
 * no frontend. Por isso nada neste arquivo lança.
 */
export class GoogleBooksProvider {
  // Capa muda muito pouco; cache longo evita repetir a consulta a cada digitada na busca.
  private readonly cache = new TtlCache<string | null>(1000 * 60 * 60 * 6, 2000);

  get enabled(): boolean {
    return env.googleBooksEnabled;
  }

  /**
   * Devolve a URL da capa, ou null se não achar / falhar / estiver desligado.
   * `isbn` tem prioridade por ser identificador exato; título+autor é aproximação.
   */
  async findCover(input: { title: string; authors?: string[]; isbn?: string | null }): Promise<string | null> {
    if (!this.enabled) return null;

    const tentativas = buildQueries(input);
    if (tentativas.length === 0) return null;

    // Cacheamos pela entrada, não por consulta: a cadeia de tentativas inteira
    // é um resultado só, e repetir a busca não deve refazer o encadeamento.
    const chave = tentativas.join(' | ');
    const cached = this.cache.get(chave);
    if (cached !== undefined) return cached;

    let cover: string | null = null;
    for (const query of tentativas) {
      cover = await this.fetchCover(query);
      if (cover) break;
    }

    this.cache.set(chave, cover);
    return cover;
  }

  /**
   * Volume completo por ISBN, usado quando a Open Library não tem a edição.
   * Serve para exibir o livro identificado; não vira cadastro, porque não há
   * chave de obra da Open Library para ligar.
   */
  async findVolumeByIsbn(isbn: string): Promise<GoogleVolumeInfo | null> {
    if (!this.enabled) return null;

    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', `isbn:${isbn}`);
    url.searchParams.set('maxResults', '1');
    url.searchParams.set('country', 'BR');
    if (env.googleBooksApiKey) url.searchParams.set('key', env.googleBooksApiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.googleBooksTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': env.userAgent },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { items?: { volumeInfo?: GoogleVolumeInfo }[] };
      return data.items?.[0]?.volumeInfo ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchCover(query: string): Promise<string | null> {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '1');
    url.searchParams.set('fields', 'items(volumeInfo/imageLinks)');
    url.searchParams.set('country', 'BR');
    if (env.googleBooksApiKey) url.searchParams.set('key', env.googleBooksApiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.googleBooksTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': env.userAgent },
      });
      // 429 (cota estourada) e 403 (chave inválida) são degradação esperada, não exceção.
      if (!response.ok) return null;

      const data = (await response.json()) as GoogleVolumesResponse;
      const links = data.items?.[0]?.volumeInfo?.imageLinks;
      if (!links) return null;

      const raw = links.thumbnail ?? links.smallThumbnail;
      return raw ? normalizeCoverUrl(raw) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Consultas a tentar, em ordem. Mais de uma porque título+autor falha em casos
 * reais em que só o título acerta — medido com "Para o silêncio da história",
 * que volta vazio com o autor e traz capa sem ele.
 */
function buildQueries(input: { title: string; authors?: string[]; isbn?: string | null }): string[] {
  const isbn = input.isbn?.replace(/[^0-9Xx]/g, '');
  if (isbn && (isbn.length === 10 || isbn.length === 13)) return [`isbn:${isbn}`];

  const title = normalizeTitle(input.title);
  if (!title) return [];

  const author = input.authors?.[0]?.trim();
  if (!author) return [`intitle:${title}`];
  return [`intitle:${title} inauthor:${author}`, `intitle:${title}`];
}

/** Título máximo enviado ao Google; acima disso a busca deixa de casar. */
const MAX_TITULO = 70;

/**
 * A Open Library às vezes traz a transcrição do documento inteiro como título,
 * com reticências no meio — "Dona Maria por graça de Deos ... faço saber aos que
 * esta carta virem ... establecido a Mesa censoria ..." tem 170 caracteres e não
 * casa com nada. Cortamos na primeira reticência e limitamos o tamanho.
 */
function normalizeTitle(raw: string | undefined): string | null {
  const title = raw?.trim();
  if (!title || title === 'Sem título') return null;

  let limpo = title.split(/\s*(?:\.\.\.|…)\s*/)[0].trim();
  limpo = limpo.replace(/\s+/g, ' ');
  if (limpo.length > MAX_TITULO) {
    const corte = limpo.slice(0, MAX_TITULO);
    const ultimoEspaco = corte.lastIndexOf(' ');
    limpo = (ultimoEspaco > 30 ? corte.slice(0, ultimoEspaco) : corte).trim();
  }
  return limpo || null;
}

/**
 * O Google devolve http:// e `edge=curl` (a moldura de página dobrada).
 * https é obrigatório — a página é servida por https e o browser bloquearia a imagem.
 */
function normalizeCoverUrl(raw: string): string {
  return raw.replace(/^http:/, 'https:').replace(/&?edge=curl/, '');
}

export interface GoogleVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
}

interface GoogleVolumesResponse {
  items?: { volumeInfo?: { imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }[];
}
