import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Paginated, WorkSummary } from '../api/types';
import { useDebounce } from '../hooks/useDebounce';
import EscanearIsbn from '../components/EscanearIsbn';
import { Cover, EmptyState, ErrorBox, Pagination, Spinner } from '../components/ui';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(Number(params.get('page') ?? 1));
  const debouncedTerm = useDebounce(term);

  const [data, setData] = useState<Paginated<WorkSummary> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const lastTerm = useRef(debouncedTerm);

  // Digitar uma nova busca sempre reinicia a paginação.
  useEffect(() => {
    if (lastTerm.current !== debouncedTerm) {
      lastTerm.current = debouncedTerm;
      setPage(1);
    }
  }, [debouncedTerm]);

  useEffect(() => {
    const query = debouncedTerm.trim();
    setParams(query ? { q: query, page: String(page) } : {}, { replace: true });

    if (query.length < 2) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    api
      .searchBooks(query, page)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : 'Falha ao pesquisar.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debouncedTerm, page, retryToken, setParams]);

  const showEmpty = !loading && !error && data && data.items.length === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pesquisar livros</h1>
          <p>
            Busque por título, autor ou palavra-chave no catálogo da Open Library e escolha a edição
            que corresponde ao exemplar que você tem em mãos.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="busca">Pesquisar livros...</label>
        <input
          id="busca"
          type="search"
          placeholder="Crime e Castigo, Dostoiévski, filosofia..."
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoFocus
        />
        <p className="small muted" style={{ margin: '.5rem 0 .7rem' }}>
          {term.trim().length > 0 && term.trim().length < 2
            ? 'Digite ao menos 2 caracteres.'
            : 'A busca é enviada automaticamente enquanto você digita.'}
        </p>
        <EscanearIsbn onUsarTermo={setTerm} />
      </div>

      {error && <ErrorBox message={error} onRetry={() => setRetryToken((n) => n + 1)} />}
      {loading && <Spinner label="Consultando a Open Library..." />}

      {!loading && !data && !error && (
        <EmptyState title="Nenhuma pesquisa ainda" description="Comece digitando o nome de um livro ou autor acima." />
      )}

      {showEmpty && (
        <EmptyState
          title="Nenhum resultado encontrado"
          description={`Não encontramos obras para "${debouncedTerm}". Tente outro termo ou verifique a grafia.`}
        />
      )}

      {!loading && data && data.items.length > 0 && (
        <>
          <p className="small muted">{data.total.toLocaleString('pt-BR')} obras encontradas</p>
          <div className="book-grid">
            {data.items.map((work) => (
              <article key={work.workKey} className="book-card">
                <Cover url={work.coverUrl} title={work.title} authors={work.authors} seedKey={work.workKey} />
                <div className="book-info">
                  <h3 className="book-title clamp-2">{work.title}</h3>
                  {work.tituloOriginal && (
                    // O catálogo registra a obra pelo título original; mostramos
                    // o da edição em destaque e o catalogado abaixo, para quem
                    // reconhece o livro pelo nome original.
                    <p className="small muted" style={{ margin: '-.1rem 0 .2rem' }}>{work.tituloOriginal}</p>
                  )}
                  <p className="book-author clamp-2">{work.authors.join(', ') || 'Autor desconhecido'}</p>
                  <p className="small muted" style={{ margin: '0 0 .6rem' }}>
                    {work.firstPublishYear ? `${work.firstPublishYear} · ` : ''}
                    {work.editionCount} {work.editionCount === 1 ? 'edição' : 'edições'}
                    {work.readingLogCount > 0 && (
                      <>
                        {' · '}
                        {work.readingLogCount.toLocaleString('pt-BR')}{' '}
                        {work.readingLogCount === 1 ? 'leitor' : 'leitores'}
                      </>
                    )}
                  </p>
                  {work.fonte === 'google' ? (
                    // Sem chave de obra da Open Library não há ficha para abrir:
                    // /obras/google:XXX não é rota válida. O ISBN leva ao mesmo
                    // fluxo do leitor de código de barras, que resolve a edição.
                    <AcaoGoogle work={work} onUsarTermo={setTerm} />
                  ) : (
                    <Link className="btn-ghost btn-sm" to={`/obras/${work.workKey.replace('/works/', '')}`} style={{ display: 'inline-block' }}>
                      Ver detalhes
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
          <Pagination page={data.page} totalPages={Math.min(data.totalPages, 100)} onChange={setPage} disabled={loading} />
        </>
      )}
    </>
  );
}

/**
 * Ação de um resultado vindo do Google Books.
 *
 * Esses itens não têm chave de obra da Open Library, então não existe ficha para
 * abrir — montar /obras/google:XXX produzia um 400. Quando há ISBN, usamos o
 * mesmo caminho do leitor de código de barras: se a edição estiver catalogada na
 * Open Library, a ficha abre normalmente. Sem ISBN, sobra jogar o título na
 * busca, onde a Open Library pode ter a obra com outro nome.
 */
function AcaoGoogle({ work, onUsarTermo }: { work: WorkSummary; onUsarTermo: (t: string) => void }) {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<'ocioso' | 'buscando' | 'semFicha'>('ocioso');
  const isbn = work.volume?.isbn ?? null;

  async function abrirPeloIsbn() {
    if (!isbn) return;
    setEstado('buscando');
    try {
      const achado = await api.findByIsbn(isbn);
      if (achado.workKey) {
        const edicao = achado.editionKey ? `?edicao=${achado.editionKey.replace('/books/', '')}` : '';
        navigate(`/obras/${achado.workKey.replace('/works/', '')}${edicao}`);
        return;
      }
      setEstado('semFicha');
    } catch {
      setEstado('semFicha');
    }
  }

  if (estado === 'semFicha' || !isbn) {
    return (
      <div className="stack" style={{ gap: '.3rem' }}>
        <button type="button" className="btn-ghost btn-sm" onClick={() => onUsarTermo(work.title)}>
          Procurar no catálogo
        </button>
        <span className="small muted">Não catalogado na Open Library</span>
      </div>
    );
  }

  return (
    <button type="button" className="btn-ghost btn-sm" onClick={() => void abrirPeloIsbn()} disabled={estado === 'buscando'}>
      {estado === 'buscando' ? 'Procurando...' : 'Ver detalhes'}
    </button>
  );
}
