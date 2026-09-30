import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { GoogleBooksProvider } from './googleBooks.provider.js';

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

const IMAGE_LINKS = {
  smallThumbnail: 'http://books.google.com/books?id=X&img=1&zoom=5&edge=curl',
  thumbnail: 'http://books.google.com/books?id=X&img=1&zoom=1&edge=curl',
};

/** Substitui o fetch e registra as URLs chamadas, para inspecionar a consulta montada. */
function mockFetch(status: number, body: unknown): string[] {
  const chamadas: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    chamadas.push(String(url));
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return chamadas;
}

const consultaDe = (url: string) => decodeURIComponent(new URL(url).searchParams.get('q') ?? '');

describe('capas do Google Books', () => {
  it('prefere thumbnail, força https e tira a moldura edge=curl', async () => {
    const chamadas = mockFetch(200, { items: [{ volumeInfo: { imageLinks: IMAGE_LINKS } }] });

    const url = await new GoogleBooksProvider().findCover({
      title: 'Dom Casmurro',
      authors: ['Machado de Assis'],
    });

    assert.equal(url, 'https://books.google.com/books?id=X&img=1&zoom=1');
    assert.equal(consultaDe(chamadas[0]), 'intitle:Dom Casmurro inauthor:Machado de Assis');
  });

  it('consulta por ISBN quando há um, ignorando título e autor', async () => {
    const chamadas = mockFetch(200, { items: [{ volumeInfo: { imageLinks: IMAGE_LINKS } }] });

    await new GoogleBooksProvider().findCover({
      title: 'Dom Casmurro',
      authors: ['Machado de Assis'],
      isbn: '978-85-01-00558-8',
    });

    assert.equal(consultaDe(chamadas[0]), 'isbn:9788501005588');
  });

  it('devolve null sem lançar quando a cota estoura', async () => {
    mockFetch(429, { error: { code: 429 } });
    assert.equal(await new GoogleBooksProvider().findCover({ title: 'Qualquer' }), null);
  });

  it('devolve null sem lançar quando a rede falha', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNRESET'); }) as typeof fetch;
    assert.equal(await new GoogleBooksProvider().findCover({ title: 'Qualquer' }), null);
  });

  it('devolve null quando o volume não tem imagem', async () => {
    mockFetch(200, { items: [{ volumeInfo: {} }] });
    assert.equal(await new GoogleBooksProvider().findCover({ title: 'Sem imagem' }), null);
  });

  it('não consulta duas vezes o mesmo livro', async () => {
    const chamadas = mockFetch(200, { items: [{ volumeInfo: { imageLinks: IMAGE_LINKS } }] });
    const provider = new GoogleBooksProvider();

    await provider.findCover({ title: 'Cacheado' });
    await provider.findCover({ title: 'Cacheado' });

    assert.equal(chamadas.length, 1);
  });

  it('corta o título na primeira reticência e limita o tamanho', async () => {
    const chamadas = mockFetch(200, { items: [{ volumeInfo: { imageLinks: IMAGE_LINKS } }] });

    await new GoogleBooksProvider().findCover({
      title: 'Dona Maria por graça de Deos rainha de Portugal ... faço saber aos que esta carta virem ... establecido a Mesa censoria ...',
    });

    assert.equal(consultaDe(chamadas[0]), 'intitle:Dona Maria por graça de Deos rainha de Portugal');
  });

  it('tenta de novo só com o título quando título+autor não acha capa', async () => {
    const chamadas: string[] = [];
    // Primeira resposta sem imagem (título+autor), segunda com imagem (só título).
    let n = 0;
    globalThis.fetch = (async (url: unknown) => {
      chamadas.push(String(url));
      n += 1;
      const body = n === 1 ? { items: [{ volumeInfo: {} }] } : { items: [{ volumeInfo: { imageLinks: IMAGE_LINKS } }] };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch;

    const url = await new GoogleBooksProvider().findCover({
      title: 'Para o silêncio da história',
      authors: ['Alfredo Pinheiro Marques'],
    });

    assert.equal(url, 'https://books.google.com/books?id=X&img=1&zoom=1');
    assert.equal(chamadas.length, 2);
    assert.equal(consultaDe(chamadas[0]), 'intitle:Para o silêncio da história inauthor:Alfredo Pinheiro Marques');
    assert.equal(consultaDe(chamadas[1]), 'intitle:Para o silêncio da história');
  });

  it('não tenta de novo quando a primeira consulta já acha capa', async () => {
    const chamadas = mockFetch(200, { items: [{ volumeInfo: { imageLinks: IMAGE_LINKS } }] });
    await new GoogleBooksProvider().findCover({ title: 'Angústia', authors: ['Graciliano Ramos'] });
    assert.equal(chamadas.length, 1);
  });

  it('não gasta requisição com o título placeholder da Open Library', async () => {
    const chamadas = mockFetch(200, { items: [{ volumeInfo: { imageLinks: IMAGE_LINKS } }] });
    assert.equal(await new GoogleBooksProvider().findCover({ title: 'Sem título' }), null);
    assert.equal(chamadas.length, 0);
  });
});
