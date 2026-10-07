import { env } from '../../config/env.js';
import { DisabledAiProvider, type AiProvider } from './ai.provider.js';
import { GeminiProvider } from './gemini.provider.js';

/**
 * Escolhe o provider a partir do .env. Sem chave configurada, cai no provider
 * desligado — o app continua funcionando e a rota responde 503 com instrução.
 */
export type MotivoDesligado = 'sem-provider' | 'provider-desconhecido' | 'sem-chave' | null;

const CONFIG_PADRAO = () => ({
  provider: env.aiProvider,
  apiKey: env.aiApiKey,
  model: env.aiModel,
  fallbackModel: env.aiFallbackModel,
});

/**
 * Por que a IA está desligada, sem nunca expor o valor da chave — só se ela
 * existe. Existe porque "enabled: false" sozinho não diz qual das duas
 * variáveis falta, e isso é justamente o que trava quem está configurando o
 * deploy: AI_PROVIDER e AI_API_KEY são independentes, e a mensagem genérica
 * de antes ("defina AI_API_KEY") enganava quando o problema era o provider.
 */
export function diagnosticarProvider(
  config: { provider: string; apiKey: string } = CONFIG_PADRAO(),
): MotivoDesligado {
  const name = config.provider.trim().toLowerCase();
  if (!name) return 'sem-provider';
  if (name !== 'gemini') return 'provider-desconhecido';
  if (!config.apiKey) return 'sem-chave';
  return null;
}

export function createAiProvider(config: { provider: string; apiKey: string; model: string; fallbackModel?: string } = CONFIG_PADRAO()): AiProvider {
  const name = config.provider.trim().toLowerCase();

  if (name === 'gemini') {
    if (!config.apiKey) {
      console.warn('[ia] AI_PROVIDER=gemini definido sem AI_API_KEY — a assistência segue desligada.');
      return new DisabledAiProvider();
    }
    return new GeminiProvider(config.apiKey, config.model, config.fallbackModel);
  }

  if (name) console.warn(`[ia] AI_PROVIDER desconhecido: "${config.provider}".`);
  return new DisabledAiProvider();
}
