import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../dist/app.js';
import { migrate } from '../dist/db/index.js';

/**
 * Ponto de entrada serverless (Vercel).
 *
 * Diferente de server.ts, aqui não existe `listen`: a plataforma entrega a
 * requisição pronta. A convenção de porta livre vale só no desenvolvimento
 * local, onde há um processo de longa duração.
 */

const app = createApp();

/**
 * A migração roda uma vez por instância, não por requisição. A promessa é
 * guardada para requisições concorrentes na mesma instância esperarem a mesma
 * execução em vez de dispararem várias.
 */
let migracao: Promise<void> | null = null;
function garantirSchema(): Promise<void> {
  migracao ??= migrate().catch((erro) => {
    // Sem zerar, uma falha transitória de rede deixaria a instância quebrada
    // para sempre, já que a promessa rejeitada ficaria em cache.
    migracao = null;
    throw erro;
  });
  return migracao;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await garantirSchema();
  } catch (erro) {
    console.error('Falha ao preparar o banco:', erro);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Banco de dados indisponível' }));
    return;
  }

  app(req as never, res as never);
}
