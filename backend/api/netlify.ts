import serverless from 'serverless-http';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/index.js';

/**
 * Ponto de entrada das Netlify Functions.
 *
 * Mesma ideia do arquivo irmão da Vercel: não há `listen`, a plataforma entrega
 * a requisição pronta. O que muda é o formato — aqui o Express precisa da ponte
 * do `serverless-http`, porque a Netlify fala o protocolo de eventos da AWS.
 */

const app = createApp();
const handler = serverless(app);

/**
 * A Netlify entrega o caminho interno da função. O Express conhece as rotas por
 * `/api/...`, então devolvemos o caminho ao formato que a aplicação espera —
 * a mesma URL que o navegador pediu.
 */
const PREFIXO_FUNCAO = '/.netlify/functions/api';
function normalizarCaminho(evento: Record<string, unknown>): void {
  const caminho = evento.path;
  if (typeof caminho !== 'string' || !caminho.startsWith(PREFIXO_FUNCAO)) return;
  const resto = caminho.slice(PREFIXO_FUNCAO.length);
  evento.path = `/api${resto === '/' ? '' : resto}`;
}

/**
 * A migração roda uma vez por instância, não por requisição. A promessa fica
 * guardada para requisições concorrentes esperarem a mesma execução; em caso de
 * falha ela é zerada, senão uma queda momentânea de rede deixaria a instância
 * quebrada para sempre.
 */
let migracao: Promise<void> | null = null;
function garantirSchema(): Promise<void> {
  migracao ??= migrate().catch((erro) => {
    migracao = null;
    throw erro;
  });
  return migracao;
}

export default async function netlifyHandler(event: Record<string, unknown>, context: unknown) {
  normalizarCaminho(event);

  try {
    await garantirSchema();
  } catch (erro) {
    console.error('Falha ao preparar o banco:', erro);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Banco de dados indisponível' }),
    };
  }

  return handler(event, context);
}
