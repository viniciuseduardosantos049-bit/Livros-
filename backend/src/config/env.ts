import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /** 0 = o sistema operacional escolhe uma porta livre. */
  port: Number(process.env.PORT ?? 0),
  host: process.env.HOST ?? '127.0.0.1',
  jwtSecret: required('JWT_SECRET', 'dev-secret-nao-use-em-producao'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  cookieName: process.env.COOKIE_NAME ?? 'biblioteca_token',
  databaseFile: process.env.DATABASE_FILE
    ? path.resolve(rootDir, process.env.DATABASE_FILE)
    : path.resolve(rootDir, 'data', 'biblioteca.db'),
  openLibraryBaseUrl: process.env.OPEN_LIBRARY_BASE_URL ?? 'https://openlibrary.org',
  openLibraryTimeoutMs: Number(process.env.OPEN_LIBRARY_TIMEOUT_MS ?? 10000),
  aiProvider: process.env.AI_PROVIDER ?? '',
  aiApiKey: process.env.AI_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'gemini-flash-latest',
  aiFallbackModel: process.env.AI_FALLBACK_MODEL ?? 'gemini-flash-lite-latest',
  /** Fonte secundária só de capas; desligue com GOOGLE_BOOKS_ENABLED=false. */
  googleBooksEnabled: (process.env.GOOGLE_BOOKS_ENABLED ?? 'true') !== 'false',
  /** Opcional: sem chave a API funciona, mas com cota por IP bem menor. */
  googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null,
  googleBooksTimeoutMs: Number(process.env.GOOGLE_BOOKS_TIMEOUT_MS ?? 4000),
  userAgent:
    process.env.OPEN_LIBRARY_USER_AGENT ??
    'BibliotecaDeLeitura/1.0 (projeto de portfolio; contato via github)',
  rootDir,
  /** dist do frontend servido pelo próprio backend em produção */
  frontendDist: path.resolve(rootDir, '..', 'frontend', 'dist'),
} as const;
