import { env } from '../../config/env.js';
import { DisabledAiProvider, type AiProvider } from './ai.provider.js';
import { GeminiProvider } from './gemini.provider.js';

/**
 * Escolhe o provider a partir do .env. Sem chave configurada, cai no provider
 * desligado — o app continua funcionando e a rota responde 503 com instrução.
 */
export function createAiProvider(
  config: { provider: string; apiKey: string; model: string; fallbackModel?: string } = {
    provider: env.aiProvider,
    apiKey: env.aiApiKey,
    model: env.aiModel,
    fallbackModel: env.aiFallbackModel,
  },
): AiProvider {
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
