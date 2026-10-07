import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import {
  STATUS_LABELS, STATUS_ORDER,
  type AiStatus, type Annotation, type LibraryItem, type ProgressEntry, type ProgressSummary, type Quote,
  type ReadingStatus,
} from '../api/types';
import { AiExplainButton } from '../components/AiExplain';
import AskPanel from '../components/AskPanel';
import { useAiStatus } from '../hooks/useAiStatus';
import { Cover, EmptyState, ErrorBox, ProgressBar, Spinner, StatusBadge, formatDate } from '../components/ui';

type Tab = 'progresso' | 'anotacoes' | 'trechos';

export default function BookDetailPage() {
  const { id = '' } = useParams();
  const itemId = Number(id);
  const navigate = useNavigate();

  const [item, setItem] = useState<LibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('progresso');
  const [listsVersion, setListsVersion] = useState(0);
  const aiStatus = useAiStatus();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getLibraryItem(itemId)
      .then(({ item }) => setItem(item))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao carregar o livro.'))
      .finally(() => setLoading(false));
  }, [itemId]);

  useEffect(load, [load]);

  async function handleRemove() {
    if (!window.confirm('Remover este livro da sua biblioteca? As anotações e trechos também serão apagados.')) return;
    try {
      await api.removeLibraryItem(itemId);
      navigate('/biblioteca', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível remover o livro.');
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!item) return null;

  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => navigate('/biblioteca')} style={{ marginBottom: '1rem' }}>
        ← Minha biblioteca
      </button>

      <div className="detail-grid">
        <div>
          {/* Cabeçalho compacto: identifica o exemplar sem roubar o topo da tela. */}
          <div className="book-head card">
            <Cover url={item.edition.coverUrl} title={item.work.title} authors={item.work.authors} seedKey={item.work.workKey} small />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="inline" style={{ gap: '.5rem', marginBottom: '.2rem' }}>
                <StatusBadge status={item.status} />
                {item.edition.isCustom && <span className="chip">edição sua</span>}
              </div>
              <h1 style={{ fontSize: '1.3rem', margin: '0 0 .1rem' }}>{item.work.title}</h1>
              <p className="small muted" style={{ margin: 0 }}>
                {item.work.authors.join(', ') || 'Autor desconhecido'}
                {item.edition.publisher ? ` · ${item.edition.publisher}` : ''}
                {item.edition.publishDate ? `, ${item.edition.publishDate}` : ''}
              </p>
            </div>
            <div className="book-head-progress">
              <ProgressBar percent={item.percent} />
              <p className="small muted" style={{ margin: '.35rem 0 0' }}>
                {item.totalPages
                  ? `pág. ${item.currentPage} de ${item.totalPages} · ${item.percent}%`
                  : `pág. ${item.currentPage}`}
              </p>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setTab('progresso')}>
                Registrar progresso
              </button>
            </div>
          </div>

          {/* O elemento principal da tela: a dúvida do leitor. */}
          <AskPanel item={item} status={aiStatus} onSaved={() => setListsVersion((v) => v + 1)} />

          <div className="tabs">
            <button type="button" className={tab === 'progresso' ? 'active' : ''} onClick={() => setTab('progresso')}>Progresso</button>
            <button type="button" className={tab === 'anotacoes' ? 'active' : ''} onClick={() => setTab('anotacoes')}>Anotações</button>
            <button type="button" className={tab === 'trechos' ? 'active' : ''} onClick={() => setTab('trechos')}>Frases e trechos</button>
          </div>

          {tab === 'progresso' && <ProgressTab item={item} onChanged={setItem} />}
          {tab === 'anotacoes' && <AnnotationsTab itemId={itemId} version={listsVersion} />}
          {tab === 'trechos' && <QuotesTab itemId={itemId} version={listsVersion} />}
        </div>

        <aside className="stack">
          <SettingsCard item={item} onChanged={setItem} />
          <div className="card">
            <h3>Datas</h3>
            <p className="small muted" style={{ margin: 0 }}>Adicionado em {formatDate(item.addedAt)}</p>
            <p className="small muted" style={{ margin: 0 }}>Início da leitura: {formatDate(item.startedAt)}</p>
            <p className="small muted" style={{ margin: 0 }}>Conclusão: {formatDate(item.finishedAt)}</p>
          </div>
          <button type="button" className="btn-danger" onClick={() => void handleRemove()}>
            Remover da biblioteca
          </button>
        </aside>
      </div>
    </>
  );
}

function ProgressTab({ item, onChanged }: { item: LibraryItem; onChanged: (item: LibraryItem) => void }) {
  const [mode, setMode] = useState<'page' | 'percent'>('page');
  const [value, setValue] = useState(String(item.currentPage));
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<ProgressEntry[] | null>(null);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadHistory = useCallback(() => {
    api
      .progressHistory(item.id)
      .then(({ history, summary }) => {
        setHistory(history);
        setSummary(summary);
      })
      .catch(() => setHistory([]));
  }, [item.id]);

  useEffect(loadHistory, [loadHistory]);
  useEffect(() => {
    setValue(mode === 'page' ? String(item.currentPage) : String(item.percent ?? 0));
  }, [item.currentPage, item.percent, mode]);

  async function save(action: () => Promise<{ item: LibraryItem }>) {
    setError(null);
    setSaving(true);
    try {
      const { item: updated } = await action();
      onChanged(updated);
      setNote('');
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar o progresso.');
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(value);
    void save(() =>
      api.updateProgress(item.id, {
        ...(mode === 'page' ? { currentPage: numeric } : { percent: numeric }),
        note: note || undefined,
      }),
    );
  }

  function advance(pages: number) {
    void save(() => api.updateProgress(item.id, { currentPage: Math.max(0, item.currentPage + pages) }));
  }

  async function reset() {
    if (!window.confirm('Zerar o progresso e apagar o histórico de leitura deste livro? As anotações e trechos serão mantidos.')) return;
    void save(() => api.resetProgress(item.id));
  }

  const canUsePercent = Boolean(item.totalPages);

  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <h3>Onde você parou?</h3>
        {error && <ErrorBox message={error} />}

        {!item.totalPages && (
          <div className="alert alert-info small">
            Informe o total de páginas do seu exemplar (no painel ao lado) para acompanhar o
            percentual e a previsão de término.
          </div>
        )}

        <div className="filters" style={{ marginBottom: '.8rem' }}>
          <button type="button" className={`chip ${mode === 'page' ? 'active' : ''}`} onClick={() => setMode('page')}>
            Por página
          </button>
          <button
            type="button"
            className={`chip ${mode === 'percent' ? 'active' : ''}`}
            onClick={() => setMode('percent')}
            disabled={!canUsePercent}
            title={canUsePercent ? undefined : 'Requer o total de páginas'}
          >
            Por percentual
          </button>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="pg">
              {mode === 'page' ? `Página atual${item.totalPages ? ` (de ${item.totalPages})` : ''}` : 'Percentual lido (%)'}
            </label>
            <input
              id="pg"
              type="number"
              min={0}
              max={mode === 'page' ? item.totalPages ?? undefined : 100}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="pgnote">Comentário da sessão (opcional)</label>
            <input id="pgnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: terminei a segunda parte" />
          </div>
        </div>

        <div className="inline">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Registrar progresso'}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => advance(10)}>
            +10 páginas
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => advance(25)}>
            +25 páginas
          </button>
          {item.totalPages && item.status !== 'FINISHED' && (
            <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => void save(() => api.finishReading(item.id))}>
              ✓ Terminei o livro
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn-danger btn-sm" disabled={saving} onClick={() => void reset()}>
            Zerar progresso
          </button>
        </div>
      </form>

      {summary && item.currentPage > 0 && (
        <div className="stats-grid" style={{ marginBottom: 0 }}>
          <div className="stat">
            <div className="value">{summary.pagesPerDay}</div>
            <div className="label">páginas por dia</div>
          </div>
          <div className="stat">
            <div className="value">{summary.pagesRemaining ?? '—'}</div>
            <div className="label">páginas restantes</div>
          </div>
          <div className="stat">
            <div className="value">{summary.daysRemaining ?? '—'}</div>
            <div className="label">dias no ritmo atual</div>
          </div>
          <div className="stat">
            <div className="value" style={{ fontSize: '1.1rem' }}>
              {summary.estimatedFinishDate ? formatDate(summary.estimatedFinishDate) : '—'}
            </div>
            <div className="label">previsão de término</div>
          </div>
          <div className="stat">
            <div className="value">{summary.sessions}</div>
            <div className="label">registros de leitura</div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Histórico de leitura</h3>
        {!history && <Spinner />}
        {history && history.length === 0 && <p className="small muted">Nenhum registro ainda.</p>}
        {history && history.length > 0 && (
          <div className="list">
            {history.map((entry) => (
              <div key={entry.id} className="list-item small">
                <div className="inline">
                  <strong style={{ color: entry.pagesRead < 0 ? 'var(--text-muted)' : 'var(--accent-strong)' }}>
                    {entry.pagesRead >= 0 ? `+${entry.pagesRead}` : entry.pagesRead} páginas
                  </strong>
                  <span className="muted">pág. {entry.pageFrom} → {entry.pageTo}</span>
                  <span className="spacer" />
                  <span className="muted">{formatDate(entry.createdAt)}</span>
                </div>
                {entry.note && <p className="muted" style={{ margin: '.3rem 0 0' }}>{entry.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsCard({ item, onChanged }: { item: LibraryItem; onChanged: (item: LibraryItem) => void }) {
  const [totalPages, setTotalPages] = useState(item.totalPages ? String(item.totalPages) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sugestao, setSugestao] = useState<number | null>(null);

  // Exemplar que entrou sem o total de páginas: o catálogo pode saber.
  useEffect(() => {
    if (item.totalPages) {
      setSugestao(null);
      return;
    }
    api.sugerirPaginas(item.id)
      .then(({ numberOfPages }) => setSugestao(numberOfPages))
      .catch(() => setSugestao(null));
  }, [item.id, item.totalPages]);

  async function patch(data: Parameters<typeof api.updateLibraryItem>[1]) {
    setError(null);
    setSaving(true);
    try {
      const { item: updated } = await api.updateLibraryItem(item.id, data);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3>Este exemplar</h3>
      {error && <ErrorBox message={error} />}
      <div className="field">
        <label htmlFor="st">Status</label>
        <select id="st" value={item.status} disabled={saving} onChange={(e) => void patch({ status: e.target.value as ReadingStatus })}>
          {STATUS_ORDER.map((value) => (
            <option key={value} value={value}>{STATUS_LABELS[value]}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="tp">Total de páginas</label>
        <div className="inline">
          <input id="tp" type="number" min={1} value={totalPages} onChange={(e) => setTotalPages(e.target.value)} placeholder={item.edition.catalogPages ? String(item.edition.catalogPages) : 'ex.: 568'} />
          <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => void patch({ totalPages: totalPages ? Number(totalPages) : null })}>
            Salvar
          </button>
        </div>
        <p className="small muted" style={{ margin: '.3rem 0 0' }}>
          Catálogo: {item.edition.catalogPages ? `${item.edition.catalogPages} páginas` : 'não informado'}
        </p>
        {sugestao !== null && (
          <p className="small" style={{ margin: '.4rem 0 0' }}>
            <span className="muted">Google Books: {sugestao} páginas.</span>{' '}
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={saving}
              onClick={() => {
                setTotalPages(String(sugestao));
                void patch({ totalPages: sugestao });
              }}
            >
              Usar
            </button>
          </p>
        )}
      </div>
      <div className="field">
        <label>Avaliação</label>
        <div className="inline">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className="btn-ghost btn-sm"
              disabled={saving}
              onClick={() => void patch({ rating: item.rating === value ? null : value })}
              aria-label={`${value} estrelas`}
              style={{ color: (item.rating ?? 0) >= value ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => void patch({ isFavorite: !item.isFavorite })}>
        {item.isFavorite ? '★ Remover dos favoritos' : '☆ Marcar como favorito'}
      </button>
    </div>
  );
}

function AnnotationsTab({ itemId, version }: { itemId: number; version: number }) {
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [form, setForm] = useState({ page: '', title: '', content: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.listAnnotations(itemId).then(({ annotations }) => setAnnotations(annotations)).catch(() => setAnnotations([]));
  }, [itemId]);
  // `version` muda quando uma resposta da IA vira anotação.
  useEffect(load, [load, version]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.createAnnotation(itemId, {
        page: form.page ? Number(form.page) : null,
        title: form.title || null,
        content: form.content,
      });
      setForm({ page: '', title: '', content: '' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a anotação.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <h3>Nova anotação</h3>
        {error && <ErrorBox message={error} />}
        <div className="row">
          <div className="field" style={{ maxWidth: 120 }}>
            <label htmlFor="an-page">Página</label>
            <input id="an-page" type="number" min={0} value={form.page} onChange={(e) => setForm({ ...form, page: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 3 }}>
            <label htmlFor="an-title">Título (opcional)</label>
            <input id="an-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="an-content">Anotação</label>
          <textarea id="an-content" required value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar anotação'}</button>
      </form>

      {!annotations && <Spinner />}
      {annotations && annotations.length === 0 && (
        <EmptyState title="Nenhuma anotação" description="Registre ideias, dúvidas e conexões enquanto lê." />
      )}
      {annotations && annotations.length > 0 && (
        <div className="list">
          {annotations.map((annotation) => (
            <AnnotationCard key={annotation.id} itemId={itemId} annotation={annotation} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnotationCard({
  itemId, annotation, onChanged,
}: { itemId: number; annotation: Annotation; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    page: annotation.page !== null ? String(annotation.page) : '',
    title: annotation.title ?? '',
    content: annotation.content,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.updateAnnotation(itemId, annotation.id, {
        page: draft.page ? Number(draft.page) : null,
        title: draft.title || null,
        content: draft.content,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a alteração.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Excluir esta anotação?')) return;
    await api.deleteAnnotation(itemId, annotation.id);
    onChanged();
  }

  if (editing) {
    return (
      <article className="list-item">
        {error && <ErrorBox message={error} />}
        <div className="row">
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Página</label>
            <input type="number" min={0} value={draft.page} onChange={(e) => setDraft({ ...draft, page: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 3 }}>
            <label>Título</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Anotação</label>
          <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        </div>
        <div className="inline" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="list-item">
      <div className="inline">
        {annotation.page !== null && <span className="chip">pág. {annotation.page}</span>}
        <strong>{annotation.title ?? 'Sem título'}</strong>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Editar</button>
        <button type="button" className="btn-danger btn-sm" onClick={() => void remove()}>Excluir</button>
      </div>
      <p style={{ margin: '.5rem 0 0', whiteSpace: 'pre-wrap' }}>{annotation.content}</p>
      <p className="small muted" style={{ margin: '.4rem 0 0' }}>
        {formatDate(annotation.createdAt)}
        {annotation.updatedAt !== annotation.createdAt ? ` · editada em ${formatDate(annotation.updatedAt)}` : ''}
      </p>
    </article>
  );
}

function QuotesTab({ itemId, version }: { itemId: number; version: number }) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [form, setForm] = useState({ page: '', text: '', comment: '' });
  const [selection, setSelection] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const aiStatus = useAiStatus();

  const load = useCallback(() => {
    api.listQuotes(itemId).then(({ quotes }) => setQuotes(quotes)).catch(() => setQuotes([]));
  }, [itemId]);
  useEffect(load, [load, version]);

  /** Só para o rótulo do botão — a fonte da verdade é lida no clique. */
  function captureSelection(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    setSelection(field.value.slice(field.selectionStart, field.selectionEnd));
  }

  /** Se o usuário selecionou parte do trecho, a dúvida é sobre aquela parte. */
  function textToExplain(): string {
    const field = textRef.current;
    if (!field) return form.text;
    return field.value.slice(field.selectionStart, field.selectionEnd).trim() || field.value;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.createQuote(itemId, {
        page: form.page ? Number(form.page) : null,
        text: form.text,
        comment: form.comment || null,
      });
      setForm({ page: '', text: '', comment: '' });
      setSelection('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o trecho.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <h3>Guardar uma frase ou trecho</h3>
        {error && <ErrorBox message={error} />}
        <div className="row">
          <div className="field" style={{ maxWidth: 120 }}>
            <label htmlFor="q-page">Página</label>
            <input id="q-page" type="number" min={0} value={form.page} onChange={(e) => setForm({ ...form, page: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="q-text">Trecho</label>
          <textarea
            id="q-text"
            required
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            ref={textRef}
            onSelect={captureSelection}
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
          />
          <p className="small muted" style={{ margin: '.35rem 0 0' }}>
            Selecione uma palavra ou frase dentro do trecho para perguntar só sobre ela.
          </p>
        </div>

        <div className="field">
          <AiExplainButton
            text={form.text}
            getText={textToExplain}
            libraryItemId={itemId}
            status={aiStatus}
            label={selection.trim() ? `Explicar "${short(selection)}"` : 'Explicar este trecho'}
            onUse={(explanation) =>
              setForm((prev) => ({ ...prev, comment: prev.comment ? `${prev.comment}\n\n${explanation}` : explanation }))
            }
          />
        </div>

        <div className="field">
          <label htmlFor="q-comment">Seu comentário (opcional)</label>
          <textarea id="q-comment" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} style={{ minHeight: 70 }} />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar trecho'}</button>
      </form>

      {!quotes && <Spinner />}
      {quotes && quotes.length === 0 && (
        <EmptyState title="Nenhum trecho salvo" description="Guarde as passagens que você quer reler depois." />
      )}
      {quotes && quotes.length > 0 && (
        <div className="list">
          {quotes.map((quote) => (
            <QuoteCard key={quote.id} itemId={itemId} quote={quote} onChanged={load} aiStatus={aiStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Rótulo curto do botão: a seleção pode ser um parágrafo inteiro. */
function short(text: string, max = 28): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function QuoteCard({
  itemId, quote, onChanged, aiStatus,
}: { itemId: number; quote: Quote; onChanged: () => void; aiStatus: AiStatus | null }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const favorite = Boolean(quote.isFavorite);

  async function toggleFavorite() {
    setBusy(true);
    try {
      await api.updateQuote(itemId, quote.id, { isFavorite: !favorite });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const full = quote.page !== null ? `"${quote.text}" (p. ${quote.page})` : `"${quote.text}"`;
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function remove() {
    if (!window.confirm('Excluir este trecho?')) return;
    await api.deleteQuote(itemId, quote.id);
    onChanged();
  }

  return (
    <article className="list-item">
      <div className="inline">
        {quote.page !== null && <span className="chip">pág. {quote.page}</span>}
        <span className="spacer" />
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void toggleFavorite()}
          style={{ color: favorite ? 'var(--accent)' : 'var(--text-muted)' }}
          aria-pressed={favorite}
        >
          {favorite ? '★ Favorito' : '☆ Favoritar'}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void copy()}>
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
        <button type="button" className="btn-danger btn-sm" onClick={() => void remove()}>Excluir</button>
      </div>
      <blockquote className="quote" style={{ margin: '.6rem 0 0' }}>{quote.text}</blockquote>
      {quote.comment && <p className="small muted" style={{ margin: '.5rem 0 0' }}>{quote.comment}</p>}
      <div style={{ marginTop: '.6rem' }}>
        <AiExplainButton
          text={quote.text}
          libraryItemId={itemId}
          status={aiStatus}
          onUse={(explanation) => void api.updateQuote(itemId, quote.id, {
            comment: quote.comment ? `${quote.comment}\n\n${explanation}` : explanation,
          }).then(onChanged)}
          useLabel="Salvar como comentário"
        />
      </div>
    </article>
  );
}
