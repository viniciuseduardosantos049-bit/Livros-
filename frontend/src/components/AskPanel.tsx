import { useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import type { AiStatus, LibraryItem } from '../api/types';
import { ErrorBox } from './ui';

type Mode = 'word' | 'passage' | 'concept';

const MODES: { value: Mode; label: string; placeholder: string }[] = [
  { value: 'word', label: 'Explicar uma palavra', placeholder: 'ex.: apprivoiser' },
  { value: 'passage', label: 'Contexto de um trecho', placeholder: 'Cole aqui o trecho que você quer entender' },
  { value: 'concept', label: 'Entender um conceito', placeholder: 'ex.: o que a raposa representa' },
];

interface Answer {
  id: number;
  question: string;
  mode: Mode;
  text: string;
  provider: string;
  sources: string[];
  saved: 'annotation' | 'quote' | null;
}

interface Props {
  item: LibraryItem;
  status: AiStatus | null;
  /** Chamado quando uma resposta vira anotação ou trecho, para recarregar as listas. */
  onSaved: () => void;
}

/**
 * Painel central da tela do livro: a pergunta é o elemento principal e as
 * respostas se acumulam abaixo. Respostas vivem só nesta sessão — o que vale a
 * pena guardar vira anotação ou trecho, que são os dados de verdade.
 */
export default function AskPanel({ item, status, onSaved }: Props) {
  const [mode, setMode] = useState<Mode>('word');
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);

  const active = MODES.find((m) => m.value === mode)!;
  const enabled = status?.enabled === true;

  /**
   * "enabled: false" sozinho não diz qual das duas variáveis falta — e a
   * mensagem genérica que havia antes ("defina AI_API_KEY") enganava sempre
   * que o problema real era AI_PROVIDER. O motivo vem direto do backend, sem
   * nunca expor a chave, só dizer o que falta configurar.
   */
  const mensagemDesligado = (() => {
    switch (status?.motivo) {
      case 'sem-chave': return 'defina AI_API_KEY no backend para ativar';
      case 'provider-desconhecido': return 'AI_PROVIDER não é um valor reconhecido (use "gemini")';
      case 'sem-provider': return 'defina AI_PROVIDER=gemini no backend para ativar';
      default: return 'assistência por IA desligada nesta instalação';
    }
  })();
  const canAsk = enabled && !loading && question.trim().length >= 2;

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!canAsk) return;
    const asked = question.trim();

    setError(null);
    setLoading(true);
    try {
      const { explanation } = await api.aiExplain({ text: asked, mode, libraryItemId: item.id });
      setAnswers((prev) => [
        {
          id: nextId.current++,
          question: asked,
          mode,
          text: explanation.text,
          provider: explanation.provider,
          sources: explanation.sources,
          saved: null,
        },
        ...prev,
      ]);
      setQuestion('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível consultar a IA.');
    } finally {
      setLoading(false);
    }
  }

  async function saveAsAnnotation(answer: Answer) {
    await api.createAnnotation(item.id, {
      page: item.currentPage > 0 ? item.currentPage : null,
      title: answer.question.slice(0, 120),
      content: answer.text,
    });
    setAnswers((prev) => prev.map((a) => (a.id === answer.id ? { ...a, saved: 'annotation' } : a)));
    onSaved();
  }

  async function saveAsQuote(answer: Answer) {
    await api.createQuote(item.id, {
      page: item.currentPage > 0 ? item.currentPage : null,
      text: answer.question,
      comment: answer.text,
    });
    setAnswers((prev) => prev.map((a) => (a.id === answer.id ? { ...a, saved: 'quote' } : a)));
    onSaved();
  }

  return (
    <section className="ask" aria-label="Perguntar sobre este livro">
      <form className={`ask-box ${enabled ? '' : 'is-off'}`} onSubmit={ask}>
        <div className="ask-row">
          <span className="ask-mark" aria-hidden>✦</span>
          <textarea
            className="ask-input"
            rows={mode === 'passage' ? 3 : 1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={enabled ? active.placeholder : 'IA não configurada'}
            disabled={!enabled}
            aria-label={active.label}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && mode !== 'passage') {
                e.preventDefault();
                void ask(e as unknown as FormEvent);
              }
            }}
          />
          <button type="submit" className="btn-primary" disabled={!canAsk}>
            {loading ? 'Perguntando...' : 'Perguntar'}
          </button>
        </div>

        <div className="ask-modes">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`chip ${mode === option.value ? 'active' : ''}`}
              onClick={() => setMode(option.value)}
              disabled={!enabled}
              aria-pressed={mode === option.value}
            >
              {option.label}
            </button>
          ))}
          <span className="spacer" />
          <span className="small muted">
            {enabled ? 'usa as suas anotações deste livro como contexto' : mensagemDesligado}
          </span>
        </div>
      </form>

      {error && <ErrorBox message={error} />}

      {answers.length === 0 && !error && (
        <p className="small muted ask-hint">
          Pergunte sobre uma palavra, um trecho ou um conceito de <strong>{item.work.title}</strong>.
          As respostas aparecem aqui e você guarda as que valerem a pena.
        </p>
      )}

      <div className="stack">
        {answers.map((answer) => (
          <article key={answer.id} className="card answer">
            <div className="inline answer-head">
              <span className="ask-mark" aria-hidden>✦</span>
              <strong>{answer.question}</strong>
              <span className="spacer" />
              <span className="small muted">{MODES.find((m) => m.value === answer.mode)?.label}</span>
            </div>

            <p style={{ margin: '.6rem 0 0', whiteSpace: 'pre-wrap' }}>{answer.text}</p>

            <div className="inline answer-actions">
              {answer.saved === null ? (
                <>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void saveAsAnnotation(answer)}>
                    Salvar como anotação
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void saveAsQuote(answer)}>
                    Salvar como trecho
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setAnswers((prev) => prev.filter((a) => a.id !== answer.id))}
                  >
                    Descartar
                  </button>
                </>
              ) : (
                <span className="badge badge-FINISHED">
                  {answer.saved === 'annotation' ? '✓ Salvo nas anotações' : '✓ Salvo nos trechos'}
                </span>
              )}
              <span className="spacer" />
              <span className="small muted">
                {answer.sources.length > 0 ? answer.sources.join(' · ') : 'sem contexto seu ainda'} · {answer.provider}
              </span>
            </div>
          </article>
        ))}
      </div>

      {answers.length > 0 && (
        <p className="small muted ask-hint">
          As respostas não ficam salvas ao recarregar a página — guarde como anotação ou trecho o que
          você quiser manter.
        </p>
      )}
    </section>
  );
}
