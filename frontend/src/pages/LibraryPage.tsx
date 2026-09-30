import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { STATUS_LABELS, STATUS_ORDER, type LibraryItem, type ReadingStatus } from '../api/types';
import { useDebounce } from '../hooks/useDebounce';
import { Cover, EmptyState, ErrorBox, ProgressBar, Spinner, StatusBadge } from '../components/ui';

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [status, setStatus] = useState<ReadingStatus | 'ALL'>('ALL');
  const [term, setTerm] = useState('');
  const debouncedTerm = useDebounce(term, 300);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .listLibrary({ status: status === 'ALL' ? undefined : status, q: debouncedTerm || undefined })
      .then(({ items }) => setItems(items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao carregar a biblioteca.'))
      .finally(() => setLoading(false));
  }, [status, debouncedTerm, reload]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Minha biblioteca</h1>
          <p>Os livros que você possui, com o progresso de leitura de cada exemplar.</p>
        </div>
        <Link className="btn-primary" to="/pesquisar" style={{ padding: '.6rem 1rem' }}>
          + Adicionar livro
        </Link>
      </div>

      <div className="card" style={{ marginBottom: '1.2rem' }}>
        <input
          type="search"
          placeholder="Filtrar por título ou autor na sua biblioteca..."
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <div className="filters">
        <button type="button" className={`chip ${status === 'ALL' ? 'active' : ''}`} onClick={() => setStatus('ALL')}>
          Todos
        </button>
        {STATUS_ORDER.map((value) => (
          <button key={value} type="button" className={`chip ${status === value ? 'active' : ''}`} onClick={() => setStatus(value)}>
            {STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} />}
      {loading && <Spinner />}

      {!loading && items && items.length === 0 && (
        <EmptyState
          title={term || status !== 'ALL' ? 'Nada encontrado com esses filtros' : 'Sua biblioteca está vazia'}
          description={
            term || status !== 'ALL'
              ? 'Tente remover os filtros ou pesquisar outro termo.'
              : 'Pesquise um livro que você já tem e escolha a edição correspondente ao seu exemplar.'
          }
          action={<Link className="btn-primary" to="/pesquisar" style={{ padding: '.6rem 1rem', display: 'inline-block', marginTop: '.8rem' }}>Pesquisar livros</Link>}
        />
      )}

      {!loading && items && items.length > 0 && (
        <div className="book-grid">
          {items.map((item) => (
            <article key={item.id} className="book-card">
              <Cover url={item.edition.coverUrl} title={item.work.title} authors={item.work.authors} seedKey={item.work.workKey} />
              <div className="book-info">
                <div className="inline" style={{ justifyContent: 'space-between', marginBottom: '.3rem' }}>
                  <StatusBadge status={item.status} />
                  {item.isFavorite && <span title="Favorito">★</span>}
                </div>
                <h3 className="book-title clamp-2">
                  <Link to={`/biblioteca/${item.id}`}>{item.work.title}</Link>
                </h3>
                <p className="book-author clamp-2">{item.work.authors.join(', ') || 'Autor desconhecido'}</p>
                <p className="small muted" style={{ margin: '0 0 .4rem' }}>
                  {item.edition.publisher ? `${item.edition.publisher} · ` : ''}
                  {item.totalPages ? `${item.totalPages} págs.` : 'páginas não informadas'}
                </p>
                <ProgressBar percent={item.percent} />
                <p className="small muted" style={{ margin: '.35rem 0 0' }}>
                  {item.totalPages
                    ? `pág. ${item.currentPage} de ${item.totalPages} · ${item.percent}%`
                    : `pág. ${item.currentPage}`}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
