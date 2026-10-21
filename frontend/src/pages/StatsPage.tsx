import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { STATUS_LABELS, STATUS_ORDER, type AiRecommendation, type AiStatus, type ReadingGoal, type ReadingNow, type Stats } from '../api/types';
import { ConviteInstalar, LembretesPush } from '../components/PwaBanners';
import { useAuth } from '../context/AuthContext';
import { Cover, EmptyState, ErrorBox, ProgressBar, Spinner, formatDate } from '../components/ui';

/**
 * Identidade e saída da conta.
 *
 * A aba "Você" é a única tela que fala da conta, e o redesenho para celular
 * tirou a barra do topo onde o "Sair" morava — sem isto não há como trocar de
 * usuário em lugar nenhum do app.
 */
function Conta() {
  const { user, logout } = useAuth();
  const [saindo, setSaindo] = useState(false);

  if (!user) return null;

  const inicial = user.name.trim().charAt(0).toUpperCase() || '?';

  async function sair() {
    setSaindo(true);
    try {
      // Sem navegação explícita: a rota protegida devolve para /entrar assim
      // que a sessão cai.
      await logout();
    } finally {
      setSaindo(false);
    }
  }

  return (
    <section className="card conta" aria-label="Sua conta">
      <span className="conta-inicial" aria-hidden>{inicial}</span>
      <div className="conta-dados">
        <strong>{user.name}</strong>
        <p className="small muted">{user.email}</p>
      </div>
      <button type="button" className="btn-ghost btn-sm" onClick={() => void sair()} disabled={saindo}>
        {saindo ? 'Saindo…' : 'Sair'}
      </button>
    </section>
  );
}

/**
 * Meta de livros do ano. Sem meta definida, o card convida a criar uma; com
 * meta, mostra o progresso — a mesma barra usada no progresso de cada livro.
 */
function MetaDeLeitura({ goal, onChanged }: { goal: ReadingGoal | null; onChanged: () => void }) {
  const anoAtual = new Date().getFullYear();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(goal?.target ?? 12));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    const target = Number(valor);
    if (!Number.isInteger(target) || target < 1) {
      setErro('Informe um número de livros maior que zero.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await api.setGoal(target);
      setEditando(false);
      onChanged();
    } catch {
      setErro('Não foi possível salvar a meta agora.');
    } finally {
      setSalvando(false);
    }
  }

  if (editando || !goal) {
    return (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>Meta de {anoAtual}</h2>
        <p className="small muted" style={{ margin: '.2rem 0 .8rem' }}>Quantos livros você quer concluir este ano?</p>
        <div className="inline" style={{ gap: '.5rem' }}>
          <input
            type="number"
            min={1}
            max={999}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            style={{ width: '5rem' }}
            aria-label="Meta de livros no ano"
          />
          <button type="button" className="btn-primary btn-sm" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          {goal && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditando(false)} disabled={salvando}>
              Cancelar
            </button>
          )}
        </div>
        {erro && <p className="small" style={{ color: 'var(--danger, #b3261e)', margin: '.5rem 0 0' }}>{erro}</p>}
      </div>
    );
  }

  const percent = Math.min(100, Math.round((goal.completed / goal.target) * 100));
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <h2>Meta de {goal.year}</h2>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setValor(String(goal.target)); setEditando(true); }}>
          Editar
        </button>
      </div>
      <p style={{ margin: '.2rem 0 .6rem' }}>
        <strong>{goal.completed}</strong> de {goal.target} {goal.target === 1 ? 'livro' : 'livros'}
        {goal.completed >= goal.target ? ' — meta batida! 🎉' : ''}
      </p>
      <ProgressBar percent={percent} />
    </div>
  );
}

/**
 * Sugestão de próximo livro pela IA, a partir do que a pessoa já concluiu.
 * Mesma lógica de "esconder se a IA está desligada" do LembretesPush — aqui
 * não precisa de motivo detalhado porque não há nada pra configurar na tela.
 */
function RecomendacaoLeitura() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [sugestao, setSugestao] = useState<AiRecommendation | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  async function sugerir() {
    setCarregando(true);
    setErro(null);
    try {
      const { recommendation } = await api.aiRecommend();
      setSugestao(recommendation);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível buscar uma sugestão agora.');
    } finally {
      setCarregando(false);
    }
  }

  if (!status?.enabled) return null;

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h2>Próxima leitura</h2>
      {sugestao ? (
        <>
          <p style={{ margin: '.4rem 0 0' }}>
            <strong>{sugestao.title}</strong>{sugestao.authors ? ` — ${sugestao.authors}` : ''}
          </p>
          <p className="small muted" style={{ margin: '.3rem 0 .8rem' }}>{sugestao.reason}</p>
        </>
      ) : (
        <p className="small muted" style={{ margin: '.2rem 0 .8rem' }}>
          Peça uma sugestão de livro baseada no que você já leu.
        </p>
      )}
      {erro && <ErrorBox message={erro} />}
      <button type="button" className="btn-primary btn-sm" onClick={() => void sugerir()} disabled={carregando}>
        {carregando ? 'Pensando…' : sugestao ? 'Sugerir outro' : 'Sugerir um livro'}
      </button>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    api
      .stats()
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao carregar as estatísticas.'))
      .finally(() => setLoading(false));
  }, [reload]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!stats) return null;

  if (stats.totals.books === 0) {
    return (
      <>
        <Conta />
        <LembretesPush />
        <MetaDeLeitura goal={stats.goal} onChanged={() => setReload((n) => n + 1)} />
        <EmptyState
          title="Ainda não há o que medir"
          description="Adicione livros à sua biblioteca e registre seu progresso para ver as estatísticas."
          action={<Link className="btn-primary" to="/pesquisar" style={{ padding: '.6rem 1rem', display: 'inline-block', marginTop: '.8rem' }}>Pesquisar livros</Link>}
        />
      </>
    );
  }

  const [foco, ...outrosEmLeitura] = stats.reading;
  const concluidos = stats.byStatus.FINISHED ?? 0;
  const maxPages = Math.max(1, ...stats.daily.map((d) => d.pages));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Estatísticas</h1>
          <p>Onde você parou, em que ritmo vai e o que registrou pelo caminho.</p>
        </div>
      </div>

      <Conta />

      {/* A aba "Você" é onde o app guarda o que é da conta, não dos livros —
          por isso o convite para instalar mora aqui. Ele some sozinho quando o
          app já está instalado ou quando o navegador não suporta. */}
      <ConviteInstalar />
      <LembretesPush />
      <MetaDeLeitura goal={stats.goal} onChanged={() => setReload((n) => n + 1)} />
      <RecomendacaoLeitura />

      {foco ? <LivroEmFoco livro={foco} /> : <NadaEmLeitura />}

      {outrosEmLeitura.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2>Também em leitura</h2>
          <div className="stack" style={{ gap: '.9rem' }}>
            {outrosEmLeitura.map((livro) => (
              <OutroEmLeitura key={livro.libraryItemId} livro={livro} />
            ))}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat"><div className="value">{stats.pagesLast30.toLocaleString('pt-BR')}</div><div className="label">páginas em 30 dias</div></div>
        <div className="stat"><div className="value">{stats.averagePagesPerDay.toLocaleString('pt-BR')}</div><div className="label">páginas/dia</div></div>
        <div className="stat"><div className="value">{stats.streak}</div><div className="label">{stats.streak === 1 ? 'dia seguido lendo' : 'dias seguidos lendo'}</div></div>
        <div className="stat"><div className="value">{concluidos}</div><div className="label">{concluidos === 1 ? 'concluído' : 'concluídos'}</div></div>
        <div className="stat"><div className="value">{stats.totals.books}</div><div className="label">{stats.totals.books === 1 ? 'livro na biblioteca' : 'livros na biblioteca'}</div></div>
        <div className="stat"><div className="value">{stats.totals.annotations}</div><div className="label">{stats.totals.annotations === 1 ? 'anotação' : 'anotações'}</div></div>
        <div className="stat"><div className="value">{stats.totals.quotes}</div><div className="label">{stats.totals.quotes === 1 ? 'trecho salvo' : 'trechos salvos'}</div></div>
        <div className="stat"><div className="value">{stats.totals.averageRating || '—'}</div><div className="label">nota média</div></div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>Páginas por dia (últimos 30 dias)</h2>
        {stats.daily.length === 0 ? (
          <p className="small muted">Nenhum progresso registrado no período.</p>
        ) : (
          <>
            <div className="chart">
              {stats.daily.map((day) => (
                <div
                  key={day.day}
                  className="bar"
                  style={{ height: `${Math.max(3, (day.pages / maxPages) * 100)}%` }}
                  title={`${formatDate(day.day)}: ${day.pages} páginas`}
                />
              ))}
            </div>
            <p className="small muted" style={{ margin: '.6rem 0 0' }}>
              {stats.pagesLast30.toLocaleString('pt-BR')} páginas no período · pico de {maxPages} em um dia ·{' '}
              {stats.daily.length} {stats.daily.length === 1 ? 'dia' : 'dias'} com leitura registrada
            </p>
          </>
        )}
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2>Histórico recente</h2>
          {stats.recent.length === 0 ? (
            <p className="small muted">Nenhum registro ainda.</p>
          ) : (
            <div className="list">
              {stats.recent.map((entry) => (
                <div key={entry.id} className="list-item small">
                  <div className="inline">
                    <Link to={`/biblioteca/${entry.libraryItemId}`}>{entry.bookTitle}</Link>
                    <span className="spacer" />
                    <span className="muted">{formatDate(entry.createdAt)}</span>
                  </div>
                  <span className="muted">
                    pág. {entry.pageFrom} → {entry.pageTo} ({entry.pagesRead >= 0 ? '+' : ''}{entry.pagesRead})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Por status</h2>
          <div className="stack" style={{ gap: '.6rem' }}>
            {STATUS_ORDER.map((status) => {
              const count = stats.byStatus[status] ?? 0;
              const percent = stats.totals.books ? (count / stats.totals.books) * 100 : 0;
              return (
                <div key={status}>
                  <div className="inline small">
                    <span>{STATUS_LABELS[status]}</span>
                    <span className="spacer" />
                    <span className="muted">{count}</span>
                  </div>
                  <div className="progress"><div style={{ width: `${percent}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/** Cabeçalho da tela: o livro mais recente em andamento, com a projeção de término. */
function LivroEmFoco({ livro }: { livro: ReadingNow }) {
  return (
    <div className="card foco">
      <Cover url={livro.coverUrl} title={livro.title} authors={livro.authors} seedKey={livro.workKey} large />
      <div className="foco-info">
        <span className="eyebrow">lendo agora</span>
        <h2 className="foco-titulo">
          <Link to={`/biblioteca/${livro.libraryItemId}`}>{livro.title}</Link>
        </h2>
        <p className="muted small foco-autor">
          {livro.authors.join(', ') || 'Autor desconhecido'}
          {livro.totalPages ? ` · pág. ${livro.currentPage} de ${livro.totalPages}` : ` · pág. ${livro.currentPage}`}
        </p>

        <div className="progress"><div style={{ width: `${livro.percent ?? 0}%` }} /></div>

        <div className="inline small foco-rodape">
          <span className="muted">{livro.percent === null ? 'total de páginas não informado' : `${livro.percent}% lido`}</span>
          <span className="spacer" />
          <ProjecaoDeTermino livro={livro} />
        </div>
      </div>
    </div>
  );
}

/**
 * Só afirmamos prazo quando o servidor conseguiu calcular ritmo (precisa de
 * data de início e total de páginas). Sem isso, mostramos o que falta — nunca
 * uma previsão inventada.
 */
function ProjecaoDeTermino({ livro }: { livro: ReadingNow }) {
  if (livro.daysRemaining !== null) {
    return (
      <span className="muted">
        no seu ritmo, {livro.daysRemaining === 1 ? 'falta' : 'faltam'}{' '}
        <strong className="destaque">{livro.daysRemaining} {livro.daysRemaining === 1 ? 'dia' : 'dias'}</strong>
        {livro.estimatedFinishDate && ` · até ${formatDate(livro.estimatedFinishDate)}`}
      </span>
    );
  }
  if (livro.pagesRemaining !== null) {
    return <span className="muted">faltam {livro.pagesRemaining.toLocaleString('pt-BR')} páginas</span>;
  }
  return <span className="muted">registre o progresso para estimar o término</span>;
}

function OutroEmLeitura({ livro }: { livro: ReadingNow }) {
  return (
    <div>
      <div className="inline small">
        <Link to={`/biblioteca/${livro.libraryItemId}`}>{livro.title}</Link>
        <span className="spacer" />
        <span className="muted">
          {livro.totalPages ? `${livro.currentPage} / ${livro.totalPages}` : `pág. ${livro.currentPage}`}
          {livro.daysRemaining !== null && ` · ${livro.daysRemaining} ${livro.daysRemaining === 1 ? 'dia' : 'dias'}`}
        </span>
      </div>
      <div className="progress"><div style={{ width: `${livro.percent ?? 0}%` }} /></div>
    </div>
  );
}

function NadaEmLeitura() {
  return (
    <div className="card foco foco-vazio">
      <div>
        <span className="eyebrow">nenhuma leitura em andamento</span>
        <h2 className="foco-titulo">Sua estante está parada</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Marque um livro como “lendo” ou registre progresso para acompanhar o ritmo por aqui.
        </p>
      </div>
      <Link className="btn-primary" to="/biblioteca" style={{ padding: '.6rem 1rem', whiteSpace: 'nowrap' }}>
        Ver biblioteca
      </Link>
    </div>
  );
}
