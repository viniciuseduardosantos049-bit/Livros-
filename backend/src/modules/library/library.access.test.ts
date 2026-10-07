/**
 * Teste de integração do isolamento por usuário: cada leitor só enxerga e
 * altera os próprios livros. Roda contra um banco temporário.
 */
// Precisa vir antes de ler DATABASE_URL: o env.ts só carrega o .env quando é
// importado, e aqui a URL é lida antes disso para montar o schema de teste.
import 'dotenv/config';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

/**
 * Banco de teste isolado: um schema PostgreSQL próprio por processo, criado no
 * before e derrubado no after. Sem isso, rodar os testes apagaria o banco de
 * desenvolvimento — antes o isolamento vinha de um arquivo SQLite temporário.
 *
 * Exige um PostgreSQL acessível em TEST_DATABASE_URL (ou DATABASE_URL).
 */
const schemaDeTeste = `teste_${process.pid}`;
const urlBase = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
process.env.DATABASE_URL = urlBase
  ? `${urlBase}${urlBase.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schemaDeTeste}`
  : '';
process.env.JWT_SECRET = 'segredo-de-teste';
// Fixa a configuração de IA: o teste não pode depender do .env da máquina
// (dotenv não sobrescreve variáveis já definidas no processo).
process.env.AI_PROVIDER = '';
process.env.AI_API_KEY = '';

let baseUrl = '';
let server: import('node:http').Server;
let db: typeof import('../../db/index.js').db;
let authService: typeof import('../auth/auth.service.js').authService;

async function api(path: string, init: RequestInit & { cookie?: string } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpo de teste, checado por asserção
  const body: any = await response.json().catch(() => null);
  return { status: response.status, body, cookie };
}

/**
 * Não há rota de cadastro: as contas nascem pelo serviço (o mesmo caminho do
 * script `criar-usuario`), e a sessão vem do login normal.
 */
async function signUp(email: string) {
  await authService.register('Leitor', email, SENHA_DE_TESTE);
  const { cookie, body } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: SENHA_DE_TESTE }),
  });
  return { cookie, userId: body.user.id as number };
}

const SENHA_DE_TESTE = 'senha-de-teste-123';

before(async () => {
  const { createApp } = await import('../../app.js');
  const dbModule = await import('../../db/index.js');
  await dbModule.pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaDeTeste}`);
  await dbModule.migrate();
  db = dbModule.db;
  authService = (await import('../auth/auth.service.js')).authService;

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  const dbModule = await import('../../db/index.js');
  await dbModule.pool.query(`DROP SCHEMA IF EXISTS ${schemaDeTeste} CASCADE`);
  await dbModule.pool.end();
});

describe('autenticação', () => {
  it('bloqueia rotas privadas sem sessão', async () => {
    assert.equal((await api('/api/library')).status, 401);
    assert.equal((await api('/api/stats')).status, 401);
  });

  it('não expõe rota de cadastro', async () => {
    const { status } = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Intruso', email: 'intruso@teste.local', password: 'senha-de-teste-123' }),
    });
    assert.equal(status, 404);
  });

  it('não permite dois cadastros com o mesmo e-mail', async () => {
    await signUp('duplicado@teste.local');
    await assert.rejects(
      () => authService.register('Outro', 'duplicado@teste.local', SENHA_DE_TESTE),
      (erro: { status?: number }) => erro.status === 409,
    );
  });

  it('rejeita senha errada sem revelar se o e-mail existe', async () => {
    const existente = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'duplicado@teste.local', password: 'errada' }),
    });
    const inexistente = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ninguem@teste.local', password: 'errada' }),
    });
    assert.equal(existente.status, 401);
    assert.equal(inexistente.status, 401);
    assert.equal(existente.body.error, inexistente.body.error);
  });
});

describe('isolamento da biblioteca', () => {
  it('não devolve nem altera o livro de outro usuário', async () => {
    const alice = await signUp('alice@teste.local');
    const bob = await signUp('bob@teste.local');

    // catálogo direto no banco: o foco aqui é a autorização, não a Open Library
    const workId = (await db
      .prepare("INSERT INTO book_works (ol_work_key, title, authors) VALUES ('/works/OL1W', 'Obra', '[]')")
      .run()).lastInsertRowid as number;
    const editionId = (await db
      .prepare(
        "INSERT INTO book_editions (work_id, ol_edition_key, title, number_of_pages) VALUES (?, '/books/OL1M', 'Edição', 300)",
      )
      .run(workId)).lastInsertRowid as number;
    const itemId = (await db
      .prepare("INSERT INTO user_library (user_id, edition_id, status, total_pages) VALUES (?, ?, 'READING', 300)")
      .run(alice.userId, editionId)).lastInsertRowid as number;

    const dela = await api(`/api/library/${itemId}`, { cookie: alice.cookie });
    assert.equal(dela.status, 200);

    // 404 (e não 403) para não revelar que o registro existe
    assert.equal((await api(`/api/library/${itemId}`, { cookie: bob.cookie })).status, 404);
    assert.equal(
      (await api(`/api/library/${itemId}/progress`, {
        method: 'POST', cookie: bob.cookie, body: JSON.stringify({ currentPage: 10 }),
      })).status,
      404,
    );
    assert.equal((await api(`/api/library/${itemId}`, { method: 'DELETE', cookie: bob.cookie })).status, 404);
    assert.equal((await api('/api/library', { cookie: bob.cookie })).body.items.length, 0);
  });
});

describe('progresso de leitura', () => {
  it('valida a página, aceita percentual e conclui sozinho', async () => {
    const leitor = await signUp('progresso@teste.local');
    const workId = (await db
      .prepare("INSERT INTO book_works (ol_work_key, title, authors) VALUES ('/works/OL2W', 'Obra 2', '[]')")
      .run()).lastInsertRowid as number;
    const editionId = (await db
      .prepare("INSERT INTO book_editions (work_id, ol_edition_key, title, number_of_pages) VALUES (?, '/books/OL2M', 'Edição 2', 200)")
      .run(workId)).lastInsertRowid as number;
    const itemId = (await db
      .prepare("INSERT INTO user_library (user_id, edition_id, status, total_pages) VALUES (?, ?, 'WANT_TO_READ', 200)")
      .run(leitor.userId, editionId)).lastInsertRowid as number;

    const alem = await api(`/api/library/${itemId}/progress`, {
      method: 'POST', cookie: leitor.cookie, body: JSON.stringify({ currentPage: 500 }),
    });
    assert.equal(alem.status, 400);

    const metade = await api(`/api/library/${itemId}/progress`, {
      method: 'POST', cookie: leitor.cookie, body: JSON.stringify({ percent: 50 }),
    });
    assert.equal(metade.body.item.currentPage, 100);
    assert.equal(metade.body.item.status, 'READING');

    const fim = await api(`/api/library/${itemId}/progress/finish`, { method: 'POST', cookie: leitor.cookie });
    assert.equal(fim.body.item.status, 'FINISHED');
    assert.equal(fim.body.item.percent, 100);
    assert.ok(fim.body.item.finishedAt);

    const historico = await api(`/api/library/${itemId}/progress`, { cookie: leitor.cookie });
    assert.equal(historico.body.history.length, 2);
    assert.ok(historico.body.summary.pagesPerDay > 0);

    const zerado = await api(`/api/library/${itemId}/progress`, { method: 'DELETE', cookie: leitor.cookie });
    assert.equal(zerado.body.item.currentPage, 0);
    assert.equal(zerado.body.item.status, 'WANT_TO_READ');
  });
});

describe('assistência por IA', () => {
  it('responde 503 com instrução quando não há provider configurado', async () => {
    const leitor = await signUp('ia@teste.local');
    const status = await api('/api/ai/status', { cookie: leitor.cookie });
    assert.equal(status.body.enabled, false);

    const explicacao = await api('/api/ai/explain', {
      method: 'POST', cookie: leitor.cookie, body: JSON.stringify({ text: 'anagnórise' }),
    });
    assert.equal(explicacao.status, 503);
  });
});
