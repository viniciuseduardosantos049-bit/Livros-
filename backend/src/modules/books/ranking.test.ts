import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ordenarPorPopularidade } from './book.service.js';
import type { WorkSummary } from './book.types.js';

function obra(p: Partial<WorkSummary> & { title: string }): WorkSummary {
  return {
    workKey: `/works/${p.title.replace(/\W/g, '')}W`,
    title: p.title,
    authors: [],
    coverId: null,
    // 'coverUrl' in p, e não ?? — passar null explicitamente precisa significar "sem capa".
    coverUrl: 'coverUrl' in p ? p.coverUrl! : 'https://exemplo/capa.jpg',
    firstPublishYear: null,
    editionCount: p.editionCount ?? 1,
    languages: [],
    readingLogCount: p.readingLogCount ?? 0,
    ratingsCount: 0,
    ratingsAverage: null,
    fonte: 'openlibrary',
  };
}

const titulos = (items: WorkSummary[]) => items.map((i) => i.title);

describe('ordem dos resultados de busca', () => {
  it('sobe a obra canônica acima do ruído que veio antes dela', () => {
    // Ordem de chegada da Open Library: o cadastro obscuro primeiro.
    const ordenado = ordenarPorPopularidade([
      obra({ title: 'ruído', editionCount: 1, readingLogCount: 0 }),
      obra({ title: 'canônica', editionCount: 90, readingLogCount: 266 }),
    ]);

    assert.deepEqual(titulos(ordenado), ['canônica', 'ruído']);
  });

  it('não deixa um best-seller irrelevante passar na frente', () => {
    // Caso real: sort=readinglog puro põe Les Misérables em 1º numa busca por "vidas secas".
    const ordenado = ordenarPorPopularidade([
      obra({ title: 'Vidas secas', editionCount: 17, readingLogCount: 114 }),
      ...Array.from({ length: 18 }, (_, i) => obra({ title: `meio ${i}`, readingLogCount: 1 })),
      obra({ title: 'Les Misérables', editionCount: 400, readingLogCount: 1049 }),
    ]);

    assert.equal(ordenado[0].title, 'Vidas secas');
  });

  it('mantém a ordem original quando os sinais empatam', () => {
    const iguais = ['a', 'b', 'c'].map((t) => obra({ title: t, editionCount: 3, readingLogCount: 5 }));
    assert.deepEqual(titulos(ordenarPorPopularidade(iguais)), ['a', 'b', 'c']);
  });

  it('usa a capa para desempatar vizinhos numa página cheia', () => {
    // O peso da capa (0,05) é menor que a distância de relevância entre o 1º e o
    // último, mas maior que a distância entre vizinhos numa página de 20
    // (0,45/20 = 0,0225). Ou seja: capa remaneja vizinhos, nunca salva um
    // resultado irrelevante.
    const pagina = Array.from({ length: 20 }, (_, i) =>
      obra({ title: `item ${i}`, coverUrl: i === 3 ? null : 'https://exemplo/capa.jpg', editionCount: 5, readingLogCount: 10 }),
    );

    const ordenado = titulos(ordenarPorPopularidade(pagina));

    // O item 3, sem capa, cai abaixo de vizinhos que tinham relevância pior.
    assert.ok(ordenado.indexOf('item 3') > ordenado.indexOf('item 4'), 'sem capa deveria cair abaixo do vizinho seguinte');
    // Mas não despenca para o fim: continua acima de itens bem menos relevantes.
    assert.ok(ordenado.indexOf('item 3') < ordenado.indexOf('item 10'), 'não deveria despencar para o fim');
  });

  it('não quebra com lista vazia ou de um item só', () => {
    assert.deepEqual(ordenarPorPopularidade([]), []);
    assert.equal(ordenarPorPopularidade([obra({ title: 'único' })]).length, 1);
  });
});
