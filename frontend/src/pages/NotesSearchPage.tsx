import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AiExplanation, AiStatus, NotesSearchResult } from '../api/types';
import { useDebounce } from '../hooks/useDebounce';
import { EmptyState, ErrorBox, Spinner, formatDate } from '../components/ui';

/** Destaca o termo pesquisado dentro do texto encontrado. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={index} style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>{part}</mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export default function NotesSearchPage() {
  const [term, setTerm] = useState('');
  const debounced = useDebounce(term);
  const [result, setResult] = useState<NotesSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [explanation, setExplanation] = useState<AiExplanation | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => setAi({ enabled: false, provider: 'indisponível' }));
  }, []);

  async function explain() {
    setAiError(null);
    setExplanation(null);
    setAiLoading(true);
    try {
      const { explanation } = await api.aiExplain({ text: debounced.trim(), mode: 'concept' });
      setExplanation(explanation);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Não foi possível consultar a IA.');
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    const query = debounced.trim();
    if (query.length < 2) {
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .searchNotes(query)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha na pesquisa.'))
      .finally(() => setLoading(false));
  }, [debounced]);

  const total = (result?.annotations.length ?? 0) + (result?.quotes.length ?? 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Anotações e trechos</h1>
          <p>
            Pesquise palavras, conceitos ou frases entre tudo o que você já registrou. É aqui que a
            assistência por IA entrará em uma próxima etapa.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="q">Pesquisar nas suas anotações e trechos</label>
        <input id="q" type="search" placeholder="ex.: culpa, Nietzsche, redenção..." value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="inline">
          <strong>Assistência por IA</strong>
          <span className={`badge ${ai?.enabled ? 'badge-READING' : 'badge-PAUSED'}`}>
            {ai === null ? 'verificando...' : ai.enabled ? `ativa (${ai.provider})` : 'não configurada'}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!ai?.enabled || aiLoading || debounced.trim().length < 2}
            onClick={() => void explain()}
          >
            {aiLoading ? 'Consultando...' : 'Explicar este conceito'}
          </button>
        </div>
        <p className="small muted" style={{ margin: '.5rem 0 0' }}>
          Explica palavras, trechos e conceitos usando as suas próprias anotações como contexto.
          {!ai?.enabled && ' Defina AI_PROVIDER no backend para ativar — a rota e o contrato já existem.'}
        </p>
        {aiError && <ErrorBox message={aiError} />}
        {explanation && (
          <div className="alert alert-info" style={{ marginTop: '.8rem' }}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{explanation.text}</p>
            {explanation.sources.length > 0 && (
              <p className="small muted" style={{ margin: '.5rem 0 0' }}>Contexto: {explanation.sources.join(' · ')}</p>
            )}
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner label="Pesquisando..." />}

      {!loading && !result && term.trim().length < 2 && (
        <EmptyState title="Digite ao menos 2 caracteres" description="A busca cobre o conteúdo das anotações e dos trechos salvos." />
      )}

      {!loading && result && total === 0 && (
        <EmptyState title="Nada encontrado" description={`Nenhuma anotação ou trecho contém "${result.term}".`} />
      )}

      {!loading && result && total > 0 && (
        <div className="stack">
          {result.quotes.length > 0 && (
            <section>
              <h2>Trechos ({result.quotes.length})</h2>
              <div className="list">
                {result.quotes.map((quote) => (
                  <article key={`q-${quote.id}`} className="list-item">
                    <blockquote className="quote" style={{ margin: 0 }}>
                      <Highlight text={quote.text} term={result.term} />
                    </blockquote>
                    {quote.comment && (
                      <p className="small muted" style={{ margin: '.5rem 0 0' }}>
                        <Highlight text={quote.comment} term={result.term} />
                      </p>
                    )}
                    <p className="small muted" style={{ margin: '.5rem 0 0' }}>
                      <Link to={`/biblioteca/${quote.libraryItemId}`}>{quote.bookTitle}</Link>
                      {quote.page !== null ? ` · pág. ${quote.page}` : ''} · {formatDate(quote.createdAt)}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {result.annotations.length > 0 && (
            <section>
              <h2>Anotações ({result.annotations.length})</h2>
              <div className="list">
                {result.annotations.map((annotation) => (
                  <article key={`a-${annotation.id}`} className="list-item">
                    <strong>{annotation.title ?? 'Sem título'}</strong>
                    <p style={{ margin: '.4rem 0 0', whiteSpace: 'pre-wrap' }}>
                      <Highlight text={annotation.content} term={result.term} />
                    </p>
                    <p className="small muted" style={{ margin: '.5rem 0 0' }}>
                      <Link to={`/biblioteca/${annotation.libraryItemId}`}>{annotation.bookTitle}</Link>
                      {annotation.page !== null ? ` · pág. ${annotation.page}` : ''} · {formatDate(annotation.createdAt)}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
