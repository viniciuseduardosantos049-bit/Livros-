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
const expressHandler = serverless(app);

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

/**
 * Exportado como `handler`, e não como `default`, de propósito.
 *
 * A Netlify escolhe o formato da função pelo que o módulo exporta: com
 * `export default` ela trata como função v2 e invoca com objetos `Request`/
 * `Response` da Web API. Este código é v1 — lê `event.path` e devolve
 * `{ statusCode, body }`, que é o formato do `serverless-http`. Exportar como
 * default fazia a plataforma entregar um Request onde se esperava um evento,
 * e a função respondia 502.
 */
export const handler = async (event: Record<string, unknown>, context: unknown) => {
  normalizarCaminho(event);

  try {
    await garantirSchema();
  } catch (erro) {
    // A causa vai para o log da função; a resposta não a expõe, mas o 503
    // distingue "não alcancei o banco" do 502 genérico de função derrubada.
    console.error('Falha ao preparar o banco:', erro);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Banco de dados indisponível',
        dica: 'Verifique DATABASE_URL nas variáveis do site e se o banco aceita conexões externas.',
      }),
    };
  }

  return expressHandler(event, context);
};
