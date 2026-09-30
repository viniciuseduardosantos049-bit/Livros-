import { HttpError } from '../../lib/http.js';
import type { AiProvider, ExplainInput, Explanation } from './ai.provider.js';

const SYSTEM_INSTRUCTION = [
  'Você ajuda um leitor a entender o que ele está lendo.',
  'Responda sempre em português do Brasil, de forma direta e sem enrolação.',
  'O leitor tem o livro em mãos: não resuma a obra inteira nem entregue spoilers além do trecho perguntado.',
  'Se o contexto fornecido não bastar para responder com segurança, diga o que falta em vez de inventar.',
  'Não use markdown: escreva em texto corrido, no máximo dois parágrafos curtos.',
].join(' ');

const MODE_PROMPTS = {
  word: 'Explique o significado desta palavra ou expressão, incluindo o sentido que ela costuma ter em literatura e, se houver, a origem:',
  passage: 'Explique o que este trecho quer dizer: linguagem, referências e o que o autor está construindo ali:',
  concept: 'Explique este conceito de forma que ajude a leitura, e relacione com o que o leitor já anotou quando fizer sentido:',
} as const;

/** Monta o prompt enviado ao modelo. Puro, para ser testável sem rede. */
export function buildPrompt(input: ExplainInput): string {
  const parts = [MODE_PROMPTS[input.mode], `"""${input.text.trim()}"""`];

  if (input.bookTitle) parts.push(`Livro: ${input.bookTitle}.`);
  if (input.context) {
    parts.push(
      'Contexto registrado pelo próprio leitor (trechos e anotações dele; use só se ajudar):',
      `"""${input.context.trim().slice(0, 3000)}"""`,
    );
  }
  return parts.join('\n\n');
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * Provider do Google Gemini. É a única parte do projeto que conhece o formato
 * da API do Gemini — trocar de modelo ou de fornecedor não sai daqui.
 */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly enabled = true;

  private readonly models: string[];

  constructor(
    private readonly apiKey: string,
    // Aliases que acompanham o flash atual: modelos com número fixo são aposentados
    // (o 2.5-flash saiu do ar no meio deste projeto) e o app pararia sozinho.
    model = 'gemini-flash-latest',
    fallbackModel = 'gemini-flash-lite-latest',
    private readonly timeoutMs = 15000,
  ) {
    this.models = [...new Set([model, fallbackModel].filter(Boolean))];
  }

  /**
   * 503/429 e timeout do Gemini são picos de demanda momentâneos, não erro de
   * uso: tenta o modelo alternativo antes de desistir. Uma tentativa por modelo
   * mantém a espera do leitor dentro de um limite razoável.
   */
  async explain(input: ExplainInput): Promise<Explanation> {
    let lastError: unknown;

    for (const [index, model] of this.models.entries()) {
      try {
        return await this.request(model, input);
      } catch (error) {
        const transient =
          error instanceof HttpError && [429, 503, 504].includes(error.status);
        if (!transient) throw error;
        lastError = error;
        if (index < this.models.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      }
    }

    throw lastError instanceof HttpError
      ? lastError
      : new HttpError(503, 'O Gemini está indisponível no momento. Tente de novo em instantes.');
  }

  private async request(model: string, input: ExplainInput): Promise<Explanation> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
          // Sem thinkingConfig de propósito: nem todo modelo da família aceita o
          // campo (o flash-lite rejeita com 400), e a robustez do fallback vale
          // mais que o ganho de latência.
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
        }),
      });

      const data = (await response.json().catch(() => null)) as GeminiResponse | null;

      if (response.status === 401 || response.status === 403) {
        throw new HttpError(502, 'A chave da API do Gemini foi recusada. Verifique AI_API_KEY.');
      }
      if (response.status === 429) {
        throw new HttpError(429, 'Limite de uso do Gemini atingido. Tente novamente em instantes.');
      }
      if (response.status === 503) {
        throw new HttpError(503, 'O Gemini está sobrecarregado no momento. Tente de novo em instantes.');
      }
      if (response.status === 400) {
        // Erro de uso nosso, não do leitor: registra o detalhe e devolve algo acionável.
        console.error('[ia] requisição inválida para o Gemini:', data?.error?.message);
        throw new HttpError(502, 'A requisição enviada ao Gemini foi recusada. Veja o log do servidor.');
      }
      if (!response.ok) {
        throw new HttpError(502, data?.error?.message ?? `Gemini respondeu ${response.status}`);
      }
      if (data?.promptFeedback?.blockReason) {
        throw new HttpError(422, 'O conteúdo enviado foi bloqueado pelos filtros do Gemini.');
      }

      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (!text) throw new HttpError(502, 'O Gemini não devolveu uma resposta utilizável.');

      return { text, mode: input.mode, provider: `${this.name}/${model}`, sources: [] };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpError(504, 'O Gemini demorou demais para responder.');
      }
      throw new HttpError(502, 'Falha de comunicação com o Gemini.');
    } finally {
      clearTimeout(timer);
    }
  }
}
