import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Camada de acesso ao PostgreSQL.
 *
 * A forma `db.prepare(sql).get(params)` foi mantida de propósito, agora
 * assíncrona: ela vinha do better-sqlite3 e está em ~90 pontos do código.
 * Preservá-la deixou a migração mecânica (acrescentar `await`) em vez de uma
 * reescrita de cada consulta.
 *
 * A tradução de parâmetros (`?` e `@nome` para `$1, $2...`) acontece aqui, em
 * tempo de execução, então o texto SQL das consultas continua o mesmo.
 */

const { Pool, types } = pg;

// COUNT() e SUM() voltam como bigint, que o driver entrega em string por padrão.
// O app trata esses valores como número em toda parte.
types.setTypeParser(types.builtins.INT8, (valor) => Number(valor));

// AVG() devolve numeric, que o driver também entrega como string. O app faz
// conta com esses valores (averageRating.toFixed), então precisam ser número.
// Não há dinheiro no schema, logo a perda de precisão do float é irrelevante aqui.
types.setTypeParser(types.builtins.NUMERIC, (valor) => Number(valor));

// O app sempre tratou data como string (parseDate em lib/reading.ts aceita ISO).
// Converter para Date aqui mudaria o contrato de dezenas de respostas da API.
const paraIso = (valor: string | null) => (valor === null ? null : new Date(valor).toISOString());
types.setTypeParser(types.builtins.TIMESTAMPTZ, paraIso);
types.setTypeParser(types.builtins.TIMESTAMP, paraIso);

export const pool = new Pool({
  connectionString: env.databaseUrl,
  // Serverless cria um processo por requisição: mais de uma conexão por
  // instância não ajuda e esgota o limite do banco mais rápido.
  max: env.serverless ? 1 : 10,
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

type Params = unknown[] | Record<string, unknown>;

/** Converte `?` posicional e `@nome` para a numeração `$1..$n` do PostgreSQL. */
export function traduzirParametros(sql: string, params?: Params): { texto: string; valores: unknown[] } {
  if (!params) return { texto: sql, valores: [] };

  if (Array.isArray(params)) {
    let i = 0;
    const texto = sql.replace(/\?/g, () => `$${(i += 1)}`);
    return { texto, valores: params };
  }

  const valores: unknown[] = [];
  const posicaoDe = new Map<string, number>();
  const texto = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_todo, nome: string) => {
    // O mesmo @nome pode aparecer várias vezes; reaproveitamos o placeholder.
    let posicao = posicaoDe.get(nome);
    if (posicao === undefined) {
      valores.push((params as Record<string, unknown>)[nome] ?? null);
      posicao = valores.length;
      posicaoDe.set(nome, posicao);
    }
    return `$${posicao}`;
  });
  return { texto, valores };
}

/** INSERT sem RETURNING não devolve o id gerado; acrescentamos para manter lastInsertRowid. */
function comRetorno(sql: string): { texto: string; pediuRetorno: boolean } {
  const ehInsert = /^\s*insert\s/i.test(sql);
  const jaTem = /\breturning\b/i.test(sql);
  return ehInsert && !jaTem ? { texto: `${sql} RETURNING id`, pediuRetorno: true } : { texto: sql, pediuRetorno: false };
}

export interface ResultadoRun {
  changes: number;
  /** Indefinido quando o INSERT não inseriu nada (ON CONFLICT DO NOTHING). */
  lastInsertRowid: number | undefined;
}

export interface Consulta {
  get<T>(...params: unknown[]): Promise<T | undefined>;
  all<T>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<ResultadoRun>;
}

/**
 * Aceita as três formas que o better-sqlite3 aceitava, para os pontos de
 * chamada não precisarem mudar: `.run(a, b, c)`, `.run([a, b, c])` e
 * `.run({ nome: valor })`.
 */
function normalizar(params: unknown[]): Params | undefined {
  if (params.length === 0) return undefined;
  if (params.length === 1) {
    const unico = params[0];
    if (Array.isArray(unico)) return unico;
    if (unico !== null && typeof unico === 'object') return unico as Record<string, unknown>;
  }
  return params;
}

type Executor = { query(texto: string, valores: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> };

function criarConsulta(executor: Executor, sql: string): Consulta {
  return {
    async get<T>(...params: unknown[]) {
      const { texto, valores } = traduzirParametros(sql, normalizar(params));
      const r = await executor.query(texto, valores);
      return r.rows[0] as T | undefined;
    },
    async all<T>(...params: unknown[]) {
      const { texto, valores } = traduzirParametros(sql, normalizar(params));
      const r = await executor.query(texto, valores);
      return r.rows as T[];
    },
    async run(...params: unknown[]) {
      const { texto: comId, pediuRetorno } = comRetorno(sql);
      const { texto, valores } = traduzirParametros(comId, normalizar(params));
      const r = await executor.query(texto, valores);
      const primeira = r.rows[0] as { id?: number } | undefined;
      return {
        changes: r.rowCount ?? 0,
        lastInsertRowid: pediuRetorno ? primeira?.id : undefined,
      };
    },
  };
}

export const db = {
  prepare: (sql: string): Consulta => criarConsulta(pool, sql),

  async exec(sql: string): Promise<void> {
    await pool.query(sql);
  },

  /**
   * Transação real, numa conexão dedicada. Substitui db.transaction() do
   * better-sqlite3, que era síncrona.
   */
  async transaction<T>(fn: (tx: { prepare: (sql: string) => Consulta }) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const resultado = await fn({ prepare: (sql: string) => criarConsulta(client, sql) });
      await client.query('COMMIT');
      return resultado;
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  },
};

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * Onde procurar o schema, em ordem. O terceiro caminho é o serverless: lá o
 * código chega empacotado, `import.meta.url` aponta para o bundle e o arquivo
 * .sql entra pela raiz da função (includeFiles no vercel.json).
 */
const CAMINHOS_SCHEMA = [
  path.resolve(aqui, 'schema.pg.sql'),
  path.resolve(env.rootDir, 'src', 'db', 'schema.pg.sql'),
  path.resolve(process.cwd(), 'src', 'db', 'schema.pg.sql'),
  path.resolve(process.cwd(), 'backend', 'src', 'db', 'schema.pg.sql'),
];

/**
 * Colunas acrescentadas depois que bancos já existiam. O schema só cria tabelas
 * (CREATE TABLE IF NOT EXISTS), então não alcança um banco antigo.
 */
const COLUNAS_ADICIONADAS: { tabela: string; coluna: string; tipo: string }[] = [
  { tabela: 'book_works', coluna: 'cover_url', tipo: 'TEXT' },
  { tabela: 'book_editions', coluna: 'cover_url', tipo: 'TEXT' },
];

/** O schema já foi aplicado alguma vez neste banco? */
async function schemaJaExiste(): Promise<boolean> {
  const linha = (await db
    .prepare("SELECT to_regclass('public.users') IS NOT NULL AS existe")
    .get()) as { existe: boolean } | undefined;
  return linha?.existe === true;
}

export async function migrate(): Promise<void> {
  const arquivo = CAMINHOS_SCHEMA.find((caminho) => fs.existsSync(caminho));

  if (arquivo) {
    await db.exec(fs.readFileSync(arquivo, 'utf8'));
  } else if (await schemaJaExiste()) {
    // Empacotamentos que não levam o .sql junto ainda funcionam contra um banco
    // já provisionado — só não conseguem criar um do zero.
    console.warn('[db] schema.pg.sql não encontrado; o banco já tem as tabelas, seguindo.');
  } else {
    throw new Error(
      `schema.pg.sql não encontrado e o banco está vazio. Procurei em:\n  ${CAMINHOS_SCHEMA.join('\n  ')}`,
    );
  }

  for (const { tabela, coluna, tipo } of COLUNAS_ADICIONADAS) {
    // IF NOT EXISTS existe no ADD COLUMN do PostgreSQL, então é idempotente.
    await db.exec(`ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS ${coluna} ${tipo}`);
  }
}
