import { HttpError } from '../../lib/http.js';

export type ExplainMode = 'word' | 'passage' | 'concept';

export interface ExplainInput {
  mode: ExplainMode;
  /** Palavra, frase ou conceito que o usuário quer entender. */
  text: string;
  /** Contexto opcional: trecho ao redor, título do livro, suas anotações. */
  context?: string;
  bookTitle?: string;
}

export interface Explanation {
  text: string;
  mode: ExplainMode;
  provider: string;
  /** De onde veio o contexto usado, para o usuário saber o que foi considerado. */
  sources: string[];
}

export interface AiProvider {
  readonly name: string;
  readonly enabled: boolean;
  explain(input: ExplainInput): Promise<Explanation>;
}

/**
 * Provider padrão enquanto a IA não está configurada. Mantém o contrato de pé
 * para que a rota, o service e o frontend já existam e sejam testáveis — trocar
 * por um provider real é implementar esta mesma interface.
 */
export class DisabledAiProvider implements AiProvider {
  readonly name = 'disabled';
  readonly enabled = false;

  async explain(): Promise<Explanation> {
    throw new HttpError(
      503,
      'A assistência por IA ainda não está configurada nesta instalação.',
      { hint: 'Defina AI_PROVIDER e a chave correspondente no .env do backend.' },
    );
  }
}
