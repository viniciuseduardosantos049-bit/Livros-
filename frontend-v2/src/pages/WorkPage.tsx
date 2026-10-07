import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { STATUS_LABELS, STATUS_ORDER, type EditionSummary, type Paginated, type ReadingStatus, type WorkDetail } from '../api/types';
import { Cover, EmptyState, ErrorBox, Pagination, Spinner } from '../components/ui';

export default function WorkPage() {
  const { workId = '' } = useParams();
  const navigate = useNavigate();

  const [work, setWork] = useState<WorkDetail | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [editions, setEditions] = useState<Paginated<EditionSummary> | null>(null);
  const [editionsError, setEditionsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loadingWork, setLoadingWork] = useState(true);
  const [loadingEditions, setLoadingEditions] = useState(true);
  const [selected, setSelected] = useState<EditionSummary | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoadingWork(true);
    setWorkError(null);
    api
      .getWork(workId)
      .then(setWork)
      .catch((err) => setWorkError(err instanceof ApiError ? err.message : 'Falha ao carregar a obra.'))
      .finally(() => setLoadingWork(false));
  }, [workId, reload]);

  useEffect(() => {
    setLoadingEditions(true);
    setEditionsError(null);
    api
      .getEditions(workId, page)
      .then(setEditions)
      .catch((err) => setEditionsError(err instanceof ApiError ? err.message : 'Falha ao carregar as edições.'))
      .finally(() => setLoadingEditions(false));
  }, [workId, page, reload]);

  const onAdded = useCallback((itemId: number) => navigate(`/biblioteca/${itemId}`), [navigate]);

  if (loadingWork) return <Spinner label="Carregando obra..." />;
  if (workError) return <ErrorBox message={workError} onRetry={() => setReload((n) => n + 1)} />;
  if (!work) return null;

  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: '1rem' }}>
        ← Voltar
      </button>

      <div className="card" style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', marginBottom: '1.8rem' }}>
        <Cover url={work.coverUrl} title={work.title} authors={work.authors} seedKey={work.workKey} large />
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 style={{ marginBottom: '.2rem' }}>{work.title}</h1>
          <p className="muted">{work.authors.join(', ') || 'Autor desconhecido'}</p>
          <p className="small muted">
            {work.firstPublishYear ? `Primeira publicação em ${work.firstPublishYear} · ` : ''}
            {work.editionCount} {work.editionCount === 1 ? 'edição catalogada' : 'edições catalogadas'}
          </p>
          {work.description && <Description text={work.description} />}
          {work.subjects.length > 0 && (
            <div className="filters" style={{ marginTop: '.5rem', marginBottom: 0 }}>
              {work.subjects.slice(0, 6).map((subject) => (
                <span key={subject} className="chip">{subject}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <h2>Escolha a sua edição</h2>
      <p className="muted small" style={{ maxWidth: '70ch' }}>
        Edições diferentes têm numerações de página diferentes. Selecione a que corresponde ao seu
        exemplar — o progresso de leitura é calculado a partir dela.
      </p>

      {editionsError && <ErrorBox message={editionsError} onRetry={() => setReload((n) => n + 1)} />}
      {loadingEditions && <Spinner label="Carregando edições..." />}

      {!loadingEditions && editions && editions.items.length === 0 && (
        <EmptyState
          title="Nenhuma edição catalogada"
          description="Você ainda pode adicionar este livro informando manualmente os dados do seu exemplar."
          action={
            <button type="button" className="btn-primary" onClick={() => setSelected(MANUAL)}>
              Cadastrar minha edição
            </button>
          }
        />
      )}

      {!loadingEditions && editions && editions.items.length > 0 && (
        <>
          <div className="list" style={{ marginTop: '1rem' }}>
            {editions.items.map((edition) => (
              <div key={edition.editionKey} className="list-item inline">
                <Cover
                  url={edition.coverUrl}
                  title={edition.title}
                  authors={work.authors}
                  seedKey={edition.editionKey}
                  small
                />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <strong>{edition.title}</strong>
                  <div className="small muted">
                    {[edition.publishers[0], edition.publishDate, edition.languages[0]?.toUpperCase()].filter(Boolean).join(' · ') || 'Sem dados de publicação'}
                  </div>
                  <div className="small" style={{ color: edition.numberOfPages ? 'var(--accent-strong)' : 'var(--text-muted)' }}>
                    {edition.numberOfPages ? `${edition.numberOfPages} páginas` : 'Total de páginas não informado'}
                    {edition.pagesSource === 'google' && (
                      <span className="muted" title="A Open Library não tinha esse dado; veio do Google Books pelo ISBN desta edição">
                        {' '}(via Google Books)
                      </span>
                    )}
                    {edition.isbn ? ` · ISBN ${edition.isbn}` : ''}
                  </div>
                </div>
                <button type="button" className="btn-primary btn-sm" onClick={() => setSelected(edition)}>
                  Adicionar à biblioteca
                </button>
              </div>
            ))}
          </div>
          <Pagination page={editions.page} totalPages={editions.totalPages} onChange={setPage} disabled={loadingEditions} />
          <p className="small muted" style={{ textAlign: 'center' }}>
            Não encontrou o seu exemplar?{' '}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(MANUAL)}>
              Cadastrar edição manualmente
            </button>
          </p>
        </>
      )}

      {selected && <AddEditionModal work={work} edition={selected} onClose={() => setSelected(null)} onAdded={onAdded} />}
    </>
  );
}

const DESCRIPTION_PREVIEW_CHARS = 600;

/** Sinopse em parágrafos, com corte em limite de parágrafo (nunca no meio da frase). */
function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);

  const preview: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    if (preview.length > 0 && length + paragraph.length > DESCRIPTION_PREVIEW_CHARS) break;
    preview.push(paragraph);
    length += paragraph.length;
  }

  const truncated = preview.length < paragraphs.length;
  const visible = expanded ? paragraphs : preview;

  return (
    <div style={{ maxWidth: '68ch' }}>
      {visible.map((paragraph, index) => (
        <p key={index} style={{ margin: index === 0 ? '0 0 .8em' : '.8em 0' }}>
          {paragraph}
        </p>
      ))}
      {truncated && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Ler menos' : 'Ler mais'}
        </button>
      )}
    </div>
  );
}

/** Marcador para "edição não catalogada / informada pelo usuário". */
const MANUAL: EditionSummary = {
  editionKey: '',
  title: '',
  publishers: [],
  publishDate: null,
  numberOfPages: null,
  isbn: null,
  languages: [],
  coverId: null,
  coverUrl: null,
};

function AddEditionModal({
  work, edition, onClose, onAdded,
}: { work: WorkDetail; edition: EditionSummary; onClose: () => void; onAdded: (id: number) => void }) {
  const isManual = edition.editionKey === '';
  const [status, setStatus] = useState<ReadingStatus>('WANT_TO_READ');
  const [totalPages, setTotalPages] = useState(edition.numberOfPages ? String(edition.numberOfPages) : '');
  const [currentPage, setCurrentPage] = useState('0');
  const [title, setTitle] = useState(isManual ? work.title : edition.title);
  const [publisher, setPublisher] = useState(edition.publishers[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    const total = totalPages ? Number(totalPages) : null;
    const current = Number(currentPage || 0);
    if (total !== null && current > total) {
      setError('A página atual não pode ser maior que o total de páginas.');
      return;
    }
    setSaving(true);
    try {
      const { item } = await api.addToLibrary({
        workKey: work.workKey,
        editionKey: isManual ? null : edition.editionKey,
        status,
        totalPages: total,
        currentPage: current,
        customEdition: isManual
          ? { title: title || work.title, publisher: publisher || undefined, numberOfPages: total ?? undefined }
          : undefined,
      });
      onAdded(item.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível adicionar o livro.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{isManual ? 'Cadastrar minha edição' : 'Adicionar à biblioteca'}</h2>
        <p className="small muted">{work.title} — {work.authors.join(', ') || 'Autor desconhecido'}</p>
        {error && <ErrorBox message={error} />}

        {isManual && (
          <div className="row">
            <div className="field">
              <label htmlFor="ed-title">Título da edição</label>
              <input id="ed-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ed-pub">Editora</label>
              <input id="ed-pub" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            </div>
          </div>
        )}

        <div className="row">
          <div className="field">
            <label htmlFor="ed-status">Status</label>
            <select id="ed-status" value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus)}>
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>{STATUS_LABELS[value]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ed-total">Total de páginas do seu exemplar</label>
            <input id="ed-total" type="number" min={1} value={totalPages} onChange={(e) => setTotalPages(e.target.value)} placeholder="ex.: 568" />
          </div>
          <div className="field">
            <label htmlFor="ed-current">Página atual</label>
            <input id="ed-current" type="number" min={0} value={currentPage} onChange={(e) => setCurrentPage(e.target.value)} />
          </div>
        </div>

        <div className="inline" style={{ justifyContent: 'flex-end', marginTop: '.5rem' }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Adicionando...' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
}
