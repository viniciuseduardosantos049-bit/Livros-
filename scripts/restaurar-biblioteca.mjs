/**
 * Restaura no PostgreSQL os livros da biblioteca que sumiram do SQLite.
 *
 * Contexto: entre 29/09 12:08 e 30/09, as linhas de `user_library` do SQLite
 * foram apagadas (sobrou só "Noites Brancas") e o catálogo foi recriado com
 * outras edições. O backup de 29/09 12:08 ainda tem os 5 livros com progresso,
 * anotações e trechos.
 *
 * A restauração é ADITIVA: nada é apagado. Para cada livro do backup:
 *   1. resolve a edição no Postgres pela chave da Open Library;
 *   2. se ela não existir, importa a edição (e a obra) vinda do backup;
 *   3. insere o item da biblioteca com id novo e remapeia progresso,
 *      anotações e trechos para ele;
 *   4. se o usuário já tem aquela edição, pula.
 *
 * Uso: node scripts/restaurar-biblioteca.mjs [--aplicar]
 *      (sem --aplicar, só mostra o que faria)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'backend', 'package.json'));
const pg = require('pg');

const BACKUP = path.join(root, 'backend', 'data', 'backup', 'sqlite-29set-1208.db');
const APLICAR = process.argv.includes('--aplicar');

function lerEnv(chave) {
  const arquivo = path.join(root, 'backend', '.env');
  const linha = fs.readFileSync(arquivo, 'utf8').split('\n').find((l) => l.startsWith(`${chave}=`));
  if (!linha) throw new Error(`${chave} não encontrada em backend/.env`);
  return linha.slice(chave.length + 1).trim();
}

function consultar(sql) {
  const saida = execFileSync('sqlite3', ['-json', BACKUP, sql], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return saida.trim() ? JSON.parse(saida) : [];
}

const paraIso = (valor) => {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texto) ? `${texto.replace(' ', 'T')}Z` : texto;
};

async function main() {
  const pool = new pg.Pool({ connectionString: lerEnv('DATABASE_URL') });
  const c = await pool.connect();
  const relatorio = [];

  try {
    await c.query('BEGIN');

    const itens = consultar(`
      SELECT ul.*, e.ol_edition_key, e.title AS edicao_titulo, e.publisher, e.publish_date,
             e.number_of_pages, e.isbn, e.language, e.cover_id, e.is_custom,
             w.ol_work_key, w.title AS obra_titulo, w.authors, w.cover_id AS obra_cover,
             w.first_publish_year, w.subjects
        FROM user_library ul
        JOIN book_editions e ON e.id = ul.edition_id
        JOIN book_works    w ON w.id = e.work_id
       ORDER BY ul.id`);

    for (const item of itens) {
      // 1. o usuário já tem essa edição?
      const jaTem = await c.query(
        `SELECT ul.id FROM user_library ul
           JOIN book_editions e ON e.id = ul.edition_id
          WHERE ul.user_id = $1 AND e.ol_edition_key = $2`,
        [item.user_id, item.ol_edition_key],
      );
      if (jaTem.rows.length > 0) {
        relatorio.push(`  = ${item.obra_titulo} — já estava na biblioteca`);
        continue;
      }

      // 2. obra: reaproveita a existente ou cria
      let obra = await c.query('SELECT id FROM book_works WHERE ol_work_key = $1', [item.ol_work_key]);
      if (obra.rows.length === 0) {
        obra = await c.query(
          `INSERT INTO book_works (ol_work_key, title, authors, cover_id, first_publish_year, subjects)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [item.ol_work_key, item.obra_titulo, item.authors, item.obra_cover, item.first_publish_year, item.subjects],
        );
      }
      const workId = obra.rows[0].id;

      // 3. edição: reaproveita a existente ou importa a do backup
      let edicao = await c.query('SELECT id FROM book_editions WHERE ol_edition_key = $1', [item.ol_edition_key]);
      if (edicao.rows.length === 0) {
        edicao = await c.query(
          `INSERT INTO book_editions
             (work_id, ol_edition_key, title, publisher, publish_date, number_of_pages, isbn, language, cover_id, is_custom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [workId, item.ol_edition_key, item.edicao_titulo, item.publisher, item.publish_date,
           item.number_of_pages, item.isbn, item.language, item.cover_id, item.is_custom],
        );
      }
      const editionId = edicao.rows[0].id;

      // 4. o item da biblioteca, com id novo
      const novo = await c.query(
        `INSERT INTO user_library
           (user_id, edition_id, status, total_pages, current_page, rating, is_favorite, notes,
            added_at, started_at, finished_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [item.user_id, editionId, item.status, item.total_pages, item.current_page, item.rating,
         item.is_favorite, item.notes, paraIso(item.added_at), paraIso(item.started_at),
         paraIso(item.finished_at), paraIso(item.updated_at)],
      );
      const itemId = novo.rows[0].id;

      // 5. o que estava pendurado nele
      const progresso = consultar(`SELECT * FROM reading_progress WHERE library_item_id = ${item.id} ORDER BY id`);
      for (const p of progresso) {
        await c.query(
          `INSERT INTO reading_progress (library_item_id, page_from, page_to, pages_read, note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [itemId, p.page_from, p.page_to, p.pages_read, p.note, paraIso(p.created_at)],
        );
      }

      const anotacoes = consultar(`SELECT * FROM annotations WHERE library_item_id = ${item.id} ORDER BY id`);
      for (const a of anotacoes) {
        await c.query(
          `INSERT INTO annotations (library_item_id, page, title, content, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [itemId, a.page, a.title, a.content, paraIso(a.created_at), paraIso(a.updated_at)],
        );
      }

      const trechos = consultar(`SELECT * FROM quotes WHERE library_item_id = ${item.id} ORDER BY id`);
      for (const q of trechos) {
        await c.query(
          `INSERT INTO quotes (library_item_id, page, text, comment, is_favorite, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [itemId, q.page, q.text, q.comment, q.is_favorite, paraIso(q.created_at), paraIso(q.updated_at)],
        );
      }

      relatorio.push(
        `  + ${item.obra_titulo} — pág. ${item.current_page}/${item.total_pages ?? '?'}, ` +
          `${progresso.length} registros, ${anotacoes.length} anotações, ${trechos.length} trechos`,
      );
    }

    console.log(relatorio.join('\n'));

    if (APLICAR) {
      await c.query('COMMIT');
      console.log('\n✓ Restauração aplicada.');
    } else {
      await c.query('ROLLBACK');
      console.log('\n(simulação — rode com --aplicar para gravar)');
    }
  } catch (erro) {
    await c.query('ROLLBACK');
    console.error('\n✗ Nada foi alterado. Erro:', erro.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

main();
