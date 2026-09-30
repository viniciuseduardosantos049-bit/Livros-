/**
 * Popula o banco com um usuário de demonstração e alguns livros já catalogados.
 * As obras/edições são inseridas direto no cache local (sem depender da rede);
 * o fluxo real de catalogação continua sendo a Open Library.
 */
import bcrypt from 'bcryptjs';
import { db, migrate, pool } from './index.js';

const SEED_USER = {
  name: process.env.SEED_NAME ?? 'Leitor Demo',
  email: (process.env.SEED_EMAIL ?? 'demo@biblioteca.local').toLowerCase(),
  password: process.env.SEED_PASSWORD ?? 'Leitura@2026',
};

interface SeedBook {
  workKey: string;
  title: string;
  authors: string[];
  coverId: number | null;
  year: number | null;
  subjects: string[];
  edition: { key: string; title: string; publisher: string; publishDate: string; pages: number; isbn: string; language: string; coverId: number | null };
  status: string;
  currentPage: number;
}

const BOOKS: SeedBook[] = [
  {
    workKey: '/works/OL166894W',
    title: 'Crime e Castigo',
    authors: ['Fiódor Dostoiévski'],
    coverId: 9411873,
    year: 1866,
    subjects: ['Ficção russa', 'Romance psicológico', 'Culpa'],
    edition: {
      key: '/books/OL30247809M',
      title: 'Crime and Punishment',
      publisher: 'W. W. Norton & Company',
      publishDate: '2020',
      pages: 592,
      isbn: '9780393427950',
      language: 'eng',
      coverId: 13254527,
    },
    status: 'READING',
    currentPage: 214,
  },
  {
    workKey: '/works/OL27513W',
    title: 'O Senhor dos Anéis: A Sociedade do Anel',
    authors: ['J. R. R. Tolkien'],
    coverId: 14627060,
    year: 1954,
    subjects: ['Fantasia', 'Terra-média'],
    edition: {
      key: '/books/OL53723416M',
      title: 'O Senhor dos Anéis: A Sociedade do Anel',
      publisher: 'HarperCollins',
      publishDate: '2022',
      pages: 608,
      isbn: '9789897773921',
      language: 'por',
      coverId: 15120679,
    },
    status: 'PAUSED',
    currentPage: 120,
  },
  {
    workKey: '/works/OL31247718W',
    title: 'Vidas Secas',
    authors: ['Graciliano Ramos'],
    coverId: 14158825,
    year: 1938,
    subjects: ['Literatura brasileira', 'Regionalismo'],
    edition: {
      key: '/books/OL9155420M',
      title: 'Vidas Secas',
      publisher: 'Record',
      publishDate: '2002',
      pages: 155,
      isbn: '9788501005588',
      language: 'por',
      coverId: 14285600,
    },
    status: 'FINISHED',
    currentPage: 155,
  },
  {
    workKey: '/works/OL1268413W',
    title: 'O Homem em Busca de um Sentido',
    authors: ['Viktor Frankl'],
    coverId: 8516506,
    year: 1946,
    subjects: ['Logoterapia', 'Holocausto', 'Psicologia'],
    edition: {
      key: '/books/OL51732370M',
      title: "Man's Search for Meaning",
      publisher: 'Rider',
      publishDate: '2008',
      pages: 154,
      isbn: '9781846041242',
      language: 'eng',
      coverId: 14633660,
    },
    status: 'WANT_TO_READ',
    currentPage: 0,
  },
];

async function seed(): Promise<void> {
  await migrate();

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(SEED_USER.email) as { id: number } | undefined;
  if (existing) {
    console.log(`Usuário de demonstração já existe (${SEED_USER.email}). Nada a fazer.`);
    return;
  }

  const passwordHash = bcrypt.hashSync(SEED_USER.password, 12);
  const userId = (await db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(SEED_USER.name, SEED_USER.email, passwordHash)).lastInsertRowid as number;

  const insertWork = await db.prepare(
    `INSERT INTO book_works (ol_work_key, title, authors, cover_id, first_publish_year, subjects)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ol_work_key) DO NOTHING`,
  );
  const insertEdition = await db.prepare(
    `INSERT INTO book_editions (work_id, ol_edition_key, title, publisher, publish_date, number_of_pages, isbn, language, cover_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ol_edition_key) DO NOTHING`,
  );

  for (const book of BOOKS) {
    await insertWork.run(book.workKey, book.title, JSON.stringify(book.authors), book.coverId, book.year, JSON.stringify(book.subjects));
    const workId = (await db.prepare('SELECT id FROM book_works WHERE ol_work_key = ?').get(book.workKey) as { id: number }).id;
    await insertEdition.run(
      workId,
      book.edition.key,
      book.edition.title,
      book.edition.publisher,
      book.edition.publishDate,
      book.edition.pages,
      book.edition.isbn,
      book.edition.language,
      book.edition.coverId,
    );
    const editionId = (await db.prepare('SELECT id FROM book_editions WHERE ol_edition_key = ?').get(book.edition.key) as { id: number }).id;

    const itemId = (await db
      .prepare(
        `INSERT INTO user_library (user_id, edition_id, status, total_pages, current_page, started_at, finished_at, rating, is_favorite)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        editionId,
        book.status,
        book.edition.pages,
        book.currentPage,
        book.status === 'WANT_TO_READ' ? null : new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
        book.status === 'FINISHED' ? new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() : null,
        book.status === 'FINISHED' ? 5 : null,
        book.status === 'READING' ? 1 : 0,
      )).lastInsertRowid as number;

    if (book.currentPage > 0) {
      // histórico distribuído nos últimos dias, para as estatísticas terem forma
      let from = 0;
      const steps = 4;
      for (let i = 1; i <= steps; i += 1) {
        const to = Math.round((book.currentPage / steps) * i);
        await db.prepare(
          `INSERT INTO reading_progress (library_item_id, page_from, page_to, pages_read, note, created_at)
           VALUES (?, ?, ?, ?, ?, now() - make_interval(days => ?))`,
        ).run(itemId, from, to, to - from, null, (steps - i) * 3);
        from = to;
      }
    }
  }

  const crimeItem = (await db
    .prepare(
      `SELECT ul.id FROM user_library ul JOIN book_editions e ON e.id = ul.edition_id
        WHERE ul.user_id = ? AND e.ol_edition_key = ?`,
    )
    .get(userId, BOOKS[0].edition.key)) as { id: number };

  await db.prepare('INSERT INTO annotations (library_item_id, page, title, content) VALUES (?, ?, ?, ?)').run(
    crimeItem.id,
    76,
    'A teoria do homem extraordinário',
    'Raskólnikov separa a humanidade em ordinários e extraordinários. Vale comparar com o conceito de super-homem em Nietzsche — e lembrar que o romance é anterior.',
  );
  await db.prepare('INSERT INTO annotations (library_item_id, page, title, content) VALUES (?, ?, ?, ?)').run(
    crimeItem.id,
    198,
    'Porfíri Petróvitch',
    'O interrogatório não busca provas, busca confissão. A pressão é psicológica o tempo todo.',
  );
  await db.prepare('INSERT INTO quotes (library_item_id, page, text, comment, is_favorite) VALUES (?, ?, ?, ?, 1)').run(
    crimeItem.id,
    132,
    'A dor e o sofrimento são sempre inevitáveis para uma inteligência ampla e um coração profundo.',
    'Frase central para entender a culpa do protagonista.',
  );

  console.log('Seed concluído.');
  console.log(`  e-mail: ${SEED_USER.email}`);
  console.log('  senha : (definida em SEED_PASSWORD / CREDENCIAIS.md)');
}

seed()
  .then(() => pool.end())
  .catch(async (erro) => {
    console.error('Falha ao popular o banco:', erro);
    await pool.end();
    process.exit(1);
  });
