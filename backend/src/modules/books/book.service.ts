import { db } from '../../db/index.js';
import { HttpError } from '../../lib/http.js';
import { normalizarIsbn } from '../../lib/isbn.js';
import type { EditionSummary, IsbnLookup, Paginated, WorkDetail, WorkSummary } from './book.types.js';
import { GoogleBooksProvider, type VolumeGoogle } from './providers/googleBooks.provider.js';
import {
  OpenLibraryProvider,
  normalizeEditionKey,
  normalizeWorkKey,
} from './providers/openLibrary.provider.js';

/**
 * Quantas capas faltantes buscamos no Google por página de resultado.
 *
 * O teto cobre a página inteira: as consultas rodam em paralelo, então subir de
 * 8 para 20 não soma latência — ela é a da chamada mais lenta. Medido em
 * "dom casmurro": com teto 8, 3 livros sem capa nunca chegavam a ser
 * consultados, mesmo com o Google acertando 8 de 8 nos demais.
 *
 * O custo é cota (faixa gratuita ~1.000 req/dia), mitigado pelo cache de 6h do
 * GoogleBooksProvider. Baixe este número se a cota começar a estourar.
 */
const MAX_COVER_LOOKUPS_POR_PAGINA = 20;

/**
 * Teto de consultas para corrigir título transliterado. Menor que o das capas
 * porque o sintoma é raro: só entram os itens cujo título não casa com a busca.
 */
const MAX_TITULOS_POR_PAGINA = 6;

/**
 * Pesos do ordenamento dos resultados de busca.
 *
 * Nenhuma das fontes expõe venda: `edition_count` é o proxy mais próximo (uma obra
 * reimpressa 90 vezes vendeu mais que uma de tiragem única) e `readinglog_count` —
 * usuários da Open Library que puseram o livro numa estante — é o proxy de procura.
 *
 * A relevância continua com o maior peso de propósito. Ordenar só por popularidade
 * quebra a busca: `sort=readinglog` na Open Library devolve "Les Misérables" (1.049
 * leitores) como 1º resultado de "vidas secas".
 */
/**
 * Normaliza para comparar títulos entre fontes: sem acento, sem pontuação.
 *
 * Remover tudo que não é [a-z0-9] zerava qualquer título em alfabeto não latino
 * — russo, japonês e grego viravam a mesma string vazia, e livros diferentes
 * colidiam como duplicata. Quando a limpeza não deixa nada, caímos para o texto
 * original em minúsculas, que distingue os títulos entre si.
 */
export function chaveDeTitulo(titulo: string, autor?: string): string {
  const limpar = (s: string) => {
    const semAcento = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const soLatino = semAcento.replace(/[^a-z0-9]+/g, ' ').trim();
    return soLatino || semAcento.replace(/\s+/g, ' ').trim();
  };
  return `${limpar(titulo)}|${limpar(autor ?? '')}`;
}

/** ISBN-13 normalizado, para comparar edições entre as duas fontes. */
function isbnsDe(item: WorkSummary): string[] {
  const brutos = item.fonte === 'google' ? [item.volume?.isbn] : (item.isbns ?? []);
  return brutos.filter((i): i is string => Boolean(i)).map((i) => i.replace(/[^0-9Xx]/g, ''));
}

function volumeParaWork(v: VolumeGoogle): WorkSummary {
  const info = v.info;
  const capa = (info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null)
    ?.replace(/^http:/, 'https:')
    .replace(/&?edge=curl/, '') ?? null;

  return {
    // Sem chave de obra da Open Library: usamos o id do Google como
    // identificador, e o frontend trata pela `fonte`.
    workKey: `google:${v.id}`,
    title: info.subtitle ? `${info.title}: ${info.subtitle}` : (info.title ?? 'Sem título'),
    authors: info.authors ?? [],
    coverId: null,
    coverUrl: capa,
    firstPublishYear: info.publishedDate ? Number(info.publishedDate.slice(0, 4)) || null : null,
    editionCount: 1,
    languages: [],
    readingLogCount: 0,
    ratingsCount: 0,
    ratingsAverage: null,
    fonte: 'google',
    volume: {
      googleId: v.id,
      publisher: info.publisher ?? null,
      publishDate: info.publishedDate ?? null,
      numberOfPages: info.pageCount ?? null,
      isbn: v.isbn,
    },
  };
}

/**
 * Junta as fontes sem repetir o mesmo livro.
 *
 * A Open Library vem primeiro por ter chave de obra — o que permite escolher a
 * edição e adicionar à biblioteca. O Google entra só com o que ela não trouxe,
 * comparado por título+autor normalizados (sem acento nem pontuação), porque as
 * duas bases grafam de formas diferentes.
 */
function mesclarFontes(daOpenLibrary: WorkSummary[], doGoogle: WorkSummary[]): WorkSummary[] {
  const titulosVistos = new Set(daOpenLibrary.map((i) => chaveDeTitulo(i.title, i.authors[0])));
  // ISBN pega o que o título não pega: a mesma edição grafada de formas diferentes.
  const isbnsVistos = new Set(daOpenLibrary.flatMap(isbnsDe));
  const novos: WorkSummary[] = [];

  for (const item of doGoogle) {
    const chave = chaveDeTitulo(item.title, item.authors[0]);
    if (titulosVistos.has(chave)) continue;
    if (isbnsDe(item).some((i) => isbnsVistos.has(i))) continue;

    titulosVistos.add(chave);
    isbnsDe(item).forEach((i) => isbnsVistos.add(i));
    novos.push(item);
  }

  return [...daOpenLibrary, ...novos];
}

const PESOS = { relevancia: 0.45, procura: 0.30, edicoes: 0.20, capa: 0.05 };

/** log10 normalizado: diferencia 1 de 100 sem deixar um best-seller esmagar o resto. */
function escalaLog(valor: number, maximo: number): number {
  if (maximo <= 0) return 0;
  return Math.log10(1 + Math.max(0, valor)) / Math.log10(1 + maximo);
}

/**
 * Reordena a página por "mais vendidos e mais buscados", sem perder a relevância
 * que a Open Library já aplicou. Atua só sobre os itens da página — um resultado
 * que a Open Library mandou para a página 3 não sobe para a 1.
 */
export function ordenarPorPopularidade(items: WorkSummary[]): WorkSummary[] {
  if (items.length <= 1) return items;

  const maxProcura = Math.max(...items.map((i) => i.readingLogCount ?? 0));
  const maxEdicoes = Math.max(...items.map((i) => i.editionCount ?? 0));

  return items
    .map((item, indice) => ({
      item,
      indice,
      score:
        PESOS.relevancia * (1 - indice / items.length) +
        PESOS.procura * escalaLog(item.readingLogCount ?? 0, maxProcura) +
        PESOS.edicoes * escalaLog(item.editionCount ?? 0, maxEdicoes) +
        PESOS.capa * (item.coverUrl ? 1 : 0),
    }))
    // Empate volta à ordem da Open Library, para o resultado ser determinístico.
    .sort((a, b) => b.score - a.score || a.indice - b.indice)
    .map((x) => x.item);
}

export interface EditionRow {
  id: number;
  work_id: number;
  ol_edition_key: string | null;
  title: string;
  publisher: string | null;
  publish_date: string | null;
  number_of_pages: number | null;
  isbn: string | null;
  language: string | null;
  cover_id: number | null;
  is_custom: number;
}

export interface CustomEditionInput {
  title?: string;
  publisher?: string;
  publishDate?: string;
  numberOfPages?: number;
}

/**
 * Camada de domínio para livros. As rotas nunca falam com a Open Library
 * diretamente — passam sempre por aqui, e só este serviço conhece o provider.
 */
/** Teto de consultas extras por página listada, para não estourar a cota do Google. */
const MAX_PAGE_LOOKUPS_POR_PAGINA = 12;

export class BookService {
  constructor(
    private readonly provider = new OpenLibraryProvider(),
    private readonly covers = new GoogleBooksProvider(),
  ) {}

  async search(query: string, page: number, perPage: number): Promise<Paginated<WorkSummary>> {
    const q = query.trim();
    if (q.length < 2) throw HttpError.badRequest('Informe ao menos 2 caracteres para pesquisar');

    // As duas fontes em paralelo: a Open Library cataloga o acervo histórico, o
    // Google cobre edição recente e editora menor — sobretudo no Brasil.
    // Só a primeira página agrega; da segunda em diante o Google não pagina
    // junto e misturar geraria repetição.
    const [result, volumes] = await Promise.all([
      this.provider.search(q, page, perPage),
      page === 1 ? this.covers.search(q, perPage) : Promise.resolve([]),
    ]);

    const doGoogle = volumes.map((v) => volumeParaWork(v));

    // Ordenar ANTES de cortar. Cortando primeiro, os itens do Google — que são
    // anexados no fim — eram descartados sempre que a Open Library enchia a
    // página sozinha, e a agregação só funcionava em busca de poucos resultados.
    const mesclado = ordenarPorPopularidade(mesclarFontes(result.items, doGoogle));
    result.items = mesclado.slice(0, perPage);

    await Promise.all([
      this.preencherCapasFaltantes(result.items),
      this.corrigirTitulosTransliterados(result.items, q),
    ]);
    return result;
  }

  async getWork(workKey: string): Promise<WorkDetail> {
    const work = await this.provider.getWork(workKey);
    await this.preencherCapasFaltantes([work]);
    return work;
  }

  /**
   * Troca o título da obra pelo da edição de capa quando o catalogado não é o
   * que o leitor procurou.
   *
   * A Open Library guarda o título da OBRA, que costuma ser o original ou uma
   * transliteração: quem busca "memórias do subsolo" recebe "Zapiski Iz
   * Podpolia", com a capa da edição brasileira — título e imagem não combinam.
   * A edição de capa tem o título na língua daquela edição.
   *
   * Só age quando o título catalogado não compartilha nenhuma palavra com a
   * busca, que é exatamente o sintoma. Sem esse corte, seriam 20 consultas
   * extras por página para corrigir casos que já estão certos.
   */
  private async corrigirTitulosTransliterados(items: WorkSummary[], consulta: string): Promise<void> {
    const palavras = (texto: string) =>
      new Set(
        texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .split(/[^a-z0-9]+/).filter((p) => p.length > 2),
      );

    const daBusca = palavras(consulta);
    if (daBusca.size === 0) return;

    const candidatos = items
      .filter((i) => i.fonte === 'openlibrary' && i.coverEditionKey)
      .filter((i) => ![...palavras(i.title)].some((p) => daBusca.has(p)))
      .slice(0, MAX_TITULOS_POR_PAGINA);

    await Promise.all(
      candidatos.map(async (item) => {
        const titulo = await this.provider.getTituloDaEdicao(item.coverEditionKey!);
        // Só troca se o título da edição de fato responde à busca; senão a obra
        // simplesmente tem outro nome e trocar seria pior.
        if (titulo && [...palavras(titulo)].some((p) => daBusca.has(p))) {
          item.tituloOriginal = item.title;
          item.title = titulo;
        }
      }),
    );
  }

  /**
   * Preenche `coverUrl` pelo Google Books nos itens que a Open Library deixou sem capa.
   * Roda em paralelo e nunca rejeita: capa é enfeite, não pode derrubar a busca.
   */
  private async preencherCapasFaltantes(items: WorkSummary[]): Promise<void> {
    if (!this.covers.enabled) return;

    const semCapa = items.filter((item) => !item.coverUrl).slice(0, MAX_COVER_LOOKUPS_POR_PAGINA);
    if (semCapa.length === 0) return;

    await Promise.all(
      semCapa.map(async (item) => {
        item.coverUrl = await this.covers.findCover({ title: item.title, authors: item.authors });
      }),
    );
  }

  /**
   * Identifica a edição pelo ISBN lido no código de barras.
   *
   * Open Library primeiro porque ela devolve a chave de obra, sem a qual não dá
   * para adicionar à biblioteca. O Google Books entra como segunda opinião: em
   * livro brasileiro ele cobre casos que a Open Library não catalogou, mas o
   * resultado é só informativo.
   */
  async findByIsbn(bruto: string): Promise<IsbnLookup | null> {
    const isbn = normalizarIsbn(bruto);
    if (!isbn) throw HttpError.badRequest(`ISBN inválido: ${bruto}`);

    const edicao = await this.provider.getEditionByIsbn(isbn);
    if (edicao) {
      const work = edicao.workKey ? await this.getWork(edicao.workKey).catch(() => null) : null;
      return {
        isbn,
        title: edicao.title || work?.title || 'Sem título',
        authors: work?.authors ?? [],
        publisher: edicao.publishers[0] ?? null,
        publishDate: edicao.publishDate,
        numberOfPages: edicao.numberOfPages,
        coverUrl: edicao.coverUrl ?? work?.coverUrl ?? null,
        fonte: 'openlibrary',
        workKey: edicao.workKey,
        editionKey: edicao.editionKey,
      };
    }

    const volume = await this.covers.findVolumeByIsbn(isbn);
    if (!volume?.title) return null;

    return {
      isbn,
      title: volume.subtitle ? `${volume.title}: ${volume.subtitle}` : volume.title,
      authors: volume.authors ?? [],
      publisher: volume.publisher ?? null,
      publishDate: volume.publishedDate ?? null,
      numberOfPages: volume.pageCount ?? null,
      coverUrl: (volume.imageLinks?.thumbnail ?? volume.imageLinks?.smallThumbnail ?? null)
        ?.replace(/^http:/, 'https:')
        .replace(/&?edge=curl/, '') ?? null,
      fonte: 'google',
      workKey: null,
      editionKey: null,
    };
  }

  async getEditions(workKey: string, page: number, perPage: number): Promise<Paginated<EditionSummary>> {
    const result = await this.provider.getEditions(workKey, page, perPage);
    await this.preencherPaginasFaltantes(result.items);
    return result;
  }

  /**
   * A Open Library deixa `number_of_pages` vazio em boa parte das edições, e é
   * justamente esse número que o app usa para calcular progresso. O Google Books
   * costuma ter o dado — e, casando por ISBN, é a *mesma* edição, não outra com
   * paginação diferente. Sem ISBN não tentamos: chutar páginas de outra tiragem
   * seria pior do que deixar em branco.
   */
  private async preencherPaginasFaltantes(edicoes: EditionSummary[]): Promise<void> {
    if (!this.covers.enabled) return;

    const semPaginas = edicoes
      .filter((edicao) => !edicao.numberOfPages && edicao.isbn)
      .slice(0, MAX_PAGE_LOOKUPS_POR_PAGINA);
    if (semPaginas.length === 0) return;

    await Promise.all(
      semPaginas.map(async (edicao) => {
        const paginas = await this.paginasPorIsbn(edicao.isbn);
        if (paginas) {
          edicao.numberOfPages = paginas;
          edicao.pagesSource = 'google';
        }
      }),
    );
  }

  /** Número de páginas pelo ISBN, via Google Books. Nunca rejeita. */
  async paginasPorIsbn(isbn: string | null): Promise<number | null> {
    if (!isbn || !this.covers.enabled) return null;
    try {
      const volume = await this.covers.findVolumeByIsbn(isbn);
      const paginas = volume?.pageCount;
      return typeof paginas === 'number' && paginas > 0 ? paginas : null;
    } catch {
      return null;
    }
  }

  /**
   * Capa de fonte externa para uma edição sem imagem na Open Library. Tenta pelo
   * ISBN da edição (identificador exato) e, falhando, herda a capa da obra.
   */
  private async capaExterna(edition: EditionSummary, work: WorkDetail): Promise<string | null> {
    const porIsbn = await this.covers.findCover({ title: edition.title || work.title, isbn: edition.isbn });
    return porIsbn ?? work.coverUrl ?? null;
  }

  /** Grava (ou atualiza) a obra no cache local e devolve o id interno. */
  private async upsertWork(work: WorkDetail | WorkSummary): Promise<number> {
    const key = normalizeWorkKey(work.workKey);
    await db.prepare(
      `INSERT INTO book_works (ol_work_key, title, authors, cover_id, cover_url, first_publish_year, subjects, synced_at)
       VALUES (@key, @title, @authors, @coverId, @coverUrl, @year, @subjects, now())
       ON CONFLICT(ol_work_key) DO UPDATE SET
         title = excluded.title,
         authors = excluded.authors,
         cover_id = COALESCE(excluded.cover_id, book_works.cover_id),
         cover_url = COALESCE(excluded.cover_url, book_works.cover_url),
         first_publish_year = COALESCE(excluded.first_publish_year, book_works.first_publish_year),
         subjects = excluded.subjects,
         synced_at = now()`,
    ).run({
      key,
      title: work.title,
      authors: JSON.stringify(work.authors ?? []),
      coverId: work.coverId ?? null,
      // Só guardamos a URL quando ela não é derivável do cover_id da Open Library,
      // ou seja, quando veio de fora (Google Books).
      coverUrl: work.coverId ? null : (work.coverUrl ?? null),
      year: work.firstPublishYear ?? null,
      subjects: JSON.stringify('subjects' in work ? (work.subjects ?? []) : []),
    });

    const row = await db.prepare('SELECT id FROM book_works WHERE ol_work_key = ?').get(key) as { id: number };
    return row.id;
  }

  /**
   * Garante que a edição escolhida exista localmente (criando obra + edição se preciso)
   * e devolve a linha persistida. É o ponto de entrada usado ao adicionar à biblioteca.
   */
  async ensureEdition(workKey: string, editionKey?: string | null, custom?: CustomEditionInput): Promise<EditionRow> {
    const normalizedWork = normalizeWorkKey(workKey);

    if (editionKey) {
      const normalizedEdition = normalizeEditionKey(editionKey);
      const existing = await db
        .prepare('SELECT * FROM book_editions WHERE ol_edition_key = ?')
        .get(normalizedEdition) as EditionRow | undefined;
      if (existing) return existing;

      // this.getWork (e não this.provider.getWork) para a obra chegar aqui já
      // enriquecida com a capa do Google quando a Open Library não tem imagem.
      const [work, edition] = await Promise.all([
        this.getWork(normalizedWork),
        this.provider.getEdition(normalizedEdition),
      ]);
      const workId = await this.upsertWork(work);

      await db.prepare(
        `INSERT INTO book_editions
           (work_id, ol_edition_key, title, publisher, publish_date, number_of_pages, isbn, language, cover_id, cover_url, is_custom)
         VALUES (@workId, @key, @title, @publisher, @publishDate, @pages, @isbn, @language, @coverId, @coverUrl, 0)`,
      ).run({
        workId,
        key: edition.editionKey,
        title: edition.title || work.title,
        publisher: edition.publishers[0] ?? null,
        publishDate: edition.publishDate,
        pages: custom?.numberOfPages ?? edition.numberOfPages,
        isbn: edition.isbn,
        language: edition.languages[0] ?? null,
        coverId: edition.coverId ?? work.coverId ?? null,
        coverUrl: edition.coverId || work.coverId ? null : await this.capaExterna(edition, work),
      });

      return await db.prepare('SELECT * FROM book_editions WHERE ol_edition_key = ?').get(edition.editionKey) as EditionRow;
    }

    // Edição manual: o usuário tem uma cópia que não está catalogada na Open Library.
    const work = await this.provider.getWork(normalizedWork);
    const workId = await this.upsertWork(work);
    const info = await db.prepare(
      `INSERT INTO book_editions
         (work_id, ol_edition_key, title, publisher, publish_date, number_of_pages, isbn, language, cover_id, cover_url, is_custom)
       VALUES (@workId, NULL, @title, @publisher, @publishDate, @pages, NULL, NULL, @coverId, @coverUrl, 1)`,
    ).run({
      workId,
      title: custom?.title?.trim() || work.title,
      publisher: custom?.publisher?.trim() || null,
      publishDate: custom?.publishDate?.trim() || null,
      pages: custom?.numberOfPages ?? null,
      coverId: work.coverId ?? null,
      coverUrl: work.coverId ? null : (work.coverUrl ?? null),
    });

    return await db.prepare('SELECT * FROM book_editions WHERE id = ?').get(info.lastInsertRowid as number) as EditionRow;
  }
}

export const bookService = new BookService();
