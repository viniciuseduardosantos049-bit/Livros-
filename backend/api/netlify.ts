/**
 * Ponto de entrada das Netlify Functions.
 *
 * Não há `listen`: a plataforma entrega a requisição pronta. O Express precisa
 * da ponte do `serverless-http`, porque a Netlify fala o protocolo de eventos
 * da AWS.
 *
 * Exportado como `handler`, e não como `default`, de propósito: a Netlify
 * escolhe o formato da função pelo que o módulo exporta, e `export default`
 * seria tratado como função v2 (objetos Request/Response da Web API). Este
 * código é v1 — lê `event.path` e devolve `{ statusCode, body }`.
 *
 * Os imports da aplicação são dinâmicos, dentro do handler. Isso é deliberado:
 * `config/env.ts` lança quando falta variável obrigatória, e no import estático
 * essa exceção acontecia antes de qualquer código nosso rodar — a plataforma
 * devolvia a pilha de erro crua, com caminhos internos, para qualquer visitante.
 */

const PREFIXO_FUNCAO = '/.netlify/functions/api';

type Evento = Record<string, unknown>;
type Resposta = { statusCode: number; headers?: Record<string, string>; body: string };

/**
 * A Netlify entrega o caminho interno da função. O Express conhece as rotas por
 * `/api/...`, então devolvemos o caminho ao formato que a aplicação espera.
 */
function normalizarCaminho(evento: Evento): void {
  const caminho = evento.path;
  if (typeof caminho !== 'string' || !caminho.startsWith(PREFIXO_FUNCAO)) return;
  const resto = caminho.slice(PREFIXO_FUNCAO.length);
  evento.path = `/api${resto === '/' ? '' : resto}`;
}

function json(statusCode: number, corpo: unknown): Resposta {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(corpo),
  };
}

/**
 * Carrega a aplicação uma vez por instância. A promessa é guardada para
 * requisições concorrentes esperarem a mesma execução; em caso de falha ela é
 * zerada, senão um erro momentâneo deixaria a instância quebrada para sempre.
 */
let carregamento: Promise<(evento: Evento, contexto: unknown) => Promise<Resposta>> | null = null;

async function carregarApp() {
  const [{ default: serverless }, { createApp }, { migrate }] = await Promise.all([
    import('serverless-http'),
    import('../src/app.js'),
    import('../src/db/index.js'),
  ]);
  await migrate();
  return serverless(createApp()) as unknown as (e: Evento, c: unknown) => Promise<Resposta>;
}

function garantirApp() {
  carregamento ??= carregarApp().catch((erro) => {
    carregamento = null;
    throw erro;
  });
  return carregamento;
}

/**
 * Diagnóstico de configuração, sem expor segredo: informa apenas se cada
 * variável **existe**, nunca o valor. Existir é o que costuma faltar quando a
 * variável foi criada no escopo errado no painel e a função não a enxerga.
 */
function configuracaoVisivel() {
  const presente = (nome: string) => Boolean(process.env[nome]);
  return {
    DATABASE_URL: presente('DATABASE_URL'),
    NETLIFY_DATABASE_URL: presente('NETLIFY_DATABASE_URL'),
    JWT_SECRET: presente('JWT_SECRET'),
    GOOGLE_BOOKS_API_KEY: presente('GOOGLE_BOOKS_API_KEY'),
    AI_API_KEY: presente('AI_API_KEY'),
  };
}

export const handler = async (event: Evento, context: unknown): Promise<Resposta> => {
  normalizarCaminho(event);

  let app;
  try {
    app = await garantirApp();
  } catch (erro) {
    console.error('Falha ao iniciar a aplicação:', erro);
    const mensagem = erro instanceof Error ? erro.message : 'Erro desconhecido';
    const configuracao = erro instanceof Error && /Variável de ambiente/i.test(mensagem);

    return json(503, {
      error: configuracao ? 'Configuração incompleta' : 'Banco de dados indisponível',
      detalhe: mensagem,
      // Quais variáveis a FUNÇÃO enxerga. Diferente do painel: uma variável
      // criada só no escopo de build aparece lá e falta aqui.
      vistoPelaFuncao: configuracaoVisivel(),
      dica: configuracao
        ? 'No painel da Netlify, confirme que a variável existe e que o escopo inclui Functions.'
        : 'Verifique se o banco aceita conexões externas e se a string tem o pooler.',
    });
  }

  return app(event, context);
};
