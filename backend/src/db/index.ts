import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

fs.mkdirSync(path.dirname(env.databaseFile), { recursive: true });

export const db = new Database(env.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
const schemaFallback = path.resolve(env.rootDir, 'src', 'db', 'schema.sql');

/**
 * Colunas adicionadas depois que bancos já existiam. O schema.sql só cria
 * tabelas (CREATE TABLE IF NOT EXISTS), então ele não alcança um banco antigo:
 * cada coluna nova precisa de um ALTER idempotente aqui.
 */
const COLUNAS_ADICIONADAS: { tabela: string; coluna: string; tipo: string }[] = [
  { tabela: 'book_works', coluna: 'cover_url', tipo: 'TEXT' },
  { tabela: 'book_editions', coluna: 'cover_url', tipo: 'TEXT' },
];

function aplicarColunasFaltantes(): void {
  for (const { tabela, coluna, tipo } of COLUNAS_ADICIONADAS) {
    const existe = (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[])
      .some((c) => c.name === coluna);
    if (!existe) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  }
}

export function migrate(): void {
  const file = fs.existsSync(schemaPath) ? schemaPath : schemaFallback;
  db.exec(fs.readFileSync(file, 'utf8'));
  aplicarColunasFaltantes();
}
