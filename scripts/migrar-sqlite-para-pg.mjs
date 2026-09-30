/**
 * Copia os dados do banco SQLite antigo para o PostgreSQL.
 *
 * Lê pelo binário `sqlite3` (não pelo better-sqlite3, já removido do projeto),
 * o que também garante que o WAL pendente entre na leitura.
 *
 * Uso: node scripts/migrar-sqlite-para-pg.mjs [caminho-do-sqlite]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// O driver está instalado em backend/, não na raiz.
const require = createRequire(path.join(root, 'backend', 'package.json'));
const pg = require('pg');
const sqlitePath = process.argv[2] ?? path.join(root, 'backend', 'data', 'biblioteca.db');

const DATABASE_URL = lerEnv('DATABASE_URL');

// Ordem obrigatória: cada tabela depende das anteriores por chave estrangeira.
const TABELAS = [
  { nome: 'users', datas: ['created_at'] },
  { nome: 'book_works', datas: ['synced_at'] },
  { nome: 'book_editions', datas: ['synced_at'] },
  { nome: 'user_library', datas: ['added_at', 'started_at', 'finished_at', 'updated_at'] },
  { nome: 'reading_progress', datas: ['created_at'] },
  { nome: 'annotations', datas: ['created_at', 'updated_at'] },
  { nome: 'quotes', datas: ['created_at', 'updated_at'] },
];

function lerEnv(chave) {
  const arquivo = path.join(root, 'backend', '.env');
  const linha = fs.readFileSync(arquivo, 'utf8').split('\n').find((l) => l.startsWith(`${chave}=`));
  if (!linha) throw new Error(`${chave} não encontrada em backend/.env`);
  return linha.slice(chave.length + 1).trim();
}

function lerTabela(tabela) {
  const saida = execFileSync('sqlite3', ['-json', sqlitePath, `SELECT * FROM ${tabela};`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return saida.trim() ? JSON.parse(saida) : [];
}

/**
 * O SQLite guardava data como texto sem fuso, sempre em UTC (datetime('now')).
 * Sem o "Z" o Postgres leria no fuso do servidor e deslocaria tudo em 3 horas.
 */
function normalizarData(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texto)) return `${texto.replace(' ', 'T')}Z`;
  return texto;
}

async function main() {
  if (!fs.existsSync(sqlitePath)) {
    console.error(`Arquivo SQLite não encontrado: ${sqlitePath}`);
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const cliente = await pool.connect();

  try {
    console.log(`Origem : ${sqlitePath}`);
    console.log(`Destino: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}\n`);

    await cliente.query('BEGIN');

    // Substituição completa: o SQLite é a fonte da verdade nesta virada.
    await cliente.query(`TRUNCATE ${TABELAS.map((t) => t.nome).join(', ')} RESTART IDENTITY CASCADE`);

    for (const { nome, datas } of TABELAS) {
      const linhas = lerTabela(nome);
      if (linhas.length === 0) {
        console.log(`  ${nome.padEnd(18)} 0`);
        continue;
      }

      // Só copiamos colunas que existem nos dois lados.
      const { rows: colunasPg } = await cliente.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [nome],
      );
      const permitidas = new Set(colunasPg.map((c) => c.column_name));
      const colunas = Object.keys(linhas[0]).filter((c) => permitidas.has(c));
      const ignoradas = Object.keys(linhas[0]).filter((c) => !permitidas.has(c));

      const sql = `INSERT INTO ${nome} (${colunas.map((c) => `"${c}"`).join(', ')})
                   VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')})`;

      for (const linha of linhas) {
        const valores = colunas.map((coluna) =>
          datas.includes(coluna) ? normalizarData(linha[coluna]) : linha[coluna],
        );
        await cliente.query(sql, valores);
      }

      // As colunas de identidade não avançam sozinhas quando o id vem explícito.
      await cliente.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${nome}), 1))`,
        [nome],
      );

      console.log(
        `  ${nome.padEnd(18)} ${String(linhas.length).padStart(3)}` +
          (ignoradas.length ? `   (colunas ignoradas: ${ignoradas.join(', ')})` : ''),
      );
    }

    await cliente.query('COMMIT');
    console.log('\n✓ Migração concluída.');
  } catch (erro) {
    await cliente.query('ROLLBACK');
    console.error('\n✗ Nada foi alterado. Erro:', erro.message);
    process.exitCode = 1;
  } finally {
    cliente.release();
    await pool.end();
  }
}

main();
