import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');

// Caminho explícito em vez de 'dotenv/config': o processo é iniciado a partir da
// raiz do repositório (scripts/dev.mjs), onde não existe .env. Depender do cwd
// fazia o backend subir sem as variáveis conforme quem o chamava.
dotenv.config({ path: path.resolve(rootDir, '.env') });

/**
 * Plataformas serverless nem sempre definem NODE_ENV no runtime da função, e
 * delas depende coisa séria: cookie `secure`, TLS no banco e a recusa de subir
 * com segredo padrão. Por isso a marca da própria plataforma também conta.
 */
const emProducao =
  (process.env.NODE_ENV ?? 'development') === 'production' ||
  process.env.NETLIFY === 'true';

/**
 * Rodando como função serverless. `NETLIFY` cobre o build e as funções;
 * `AWS_LAMBDA_FUNCTION_NAME` só existe dentro da função em si, que é onde o
 * limite de conexões importa de verdade.
 */
const emServerless = process.env.NETLIFY === 'true' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/**
 * Em produção o fallback é ignorado de propósito: subir com segredo conhecido
 * é o mesmo que não ter autenticação — qualquer um forja um token válido.
 * Melhor o deploy falhar no boot do que rodar inseguro em silêncio.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? (emProducao ? undefined : fallback);
  if (!value) {
    throw new Error(
      emProducao
        ? `Variável de ambiente obrigatória ausente em produção: ${name}`
        : `Variável de ambiente obrigatória ausente: ${name}`,
    );
  }
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
  /** String de conexão do PostgreSQL. Obrigatória: não há mais banco em arquivo. */
  databaseUrl: required('DATABASE_URL'),
  /** Provedores gerenciados (Neon, Supabase) exigem TLS. */
  databaseSsl: (process.env.DATABASE_SSL ?? (emProducao ? 'true' : 'false')) === 'true',
  /**
   * Em serverless cada instância atende uma requisição por vez: abrir um pool
   * de 10 só consome o limite de conexões do banco sem ganho nenhum.
   */
  serverless: emServerless,
  /**
   * Abaixo do tempo limite da plataforma (10s na Netlify), para a falha de
   * conexão virar uma resposta nossa em vez de a função ser morta.
   */
  dbConnectTimeoutMs: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 5000),
  dbStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 8000),
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
