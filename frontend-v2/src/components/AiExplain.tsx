import { useState, type ReactNode } from 'react';
import { ApiError, api } from '../api/client';
import type { AiExplanation, AiStatus } from '../api/types';
import { ErrorBox } from './ui';

/** Palavra solta pede definição; frase pede leitura do trecho. */
function modeFor(text: string): 'word' | 'passage' {
  return text.trim().split(/\s+/).length <= 3 ? 'word' : 'passage';
}

interface Props {
  /** Texto a explicar; usado para habilitar o botão e montar o rótulo. */
  text: string;
  /**
   * Lido no momento do clique, quando o texto pode ter mudado depois da
   * renderização — caso da seleção dentro de um campo, que o React não
   * acompanha de forma confiável via onSelect.
   */
  getText?: () => string;
  libraryItemId: number;
  status: AiStatus | null;
  label?: string;
  /** Oferecido quando há onde aproveitar a explicação (ex.: campo de comentário). */
  onUse?: (text: string) => void;
  useLabel?: string;
  children?: ReactNode;
}

export function AiExplainButton({ text, getText, libraryItemId, status, label = 'Explicar com IA', onUse, useLabel = 'Usar como comentário', children }: Props) {
  const [explanation, setExplanation] = useState<AiExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const trimmed = text.trim();
  const disabled = !status?.enabled || loading || trimmed.length < 2;

  async function explain() {
    const target = (getText?.() ?? text).trim() || trimmed;
    setError(null);
    setExplanation(null);
    setLoading(true);
    try {
      const { explanation } = await api.aiExplain({ text: target, mode: modeFor(target), libraryItemId });
      setExplanation(explanation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível consultar a IA.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="inline">
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={disabled}
          onClick={() => void explain()}
          title={
            status?.enabled
              ? 'Explica a seleção, ou o texto inteiro se nada estiver selecionado'
              : 'Assistência por IA não configurada no servidor'
          }
        >
          {loading ? 'Consultando...' : `✦ ${label}`}
        </button>
        {children}
        {!status?.enabled && status && (
          <span className="small muted">IA não configurada</span>
        )}
      </div>

      {error && <div style={{ marginTop: '.6rem' }}><ErrorBox message={error} /></div>}

      {explanation && (
        <div className="alert alert-info" style={{ marginTop: '.6rem' }}>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{explanation.text}</p>
          {explanation.sources.length > 0 && (
            <p className="small muted" style={{ margin: '.5rem 0 0' }}>Contexto usado: {explanation.sources.join(' · ')}</p>
          )}
          <div className="inline" style={{ marginTop: '.6rem' }}>
            {onUse && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => onUse(explanation.text)}>
                {useLabel}
              </button>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setExplanation(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
