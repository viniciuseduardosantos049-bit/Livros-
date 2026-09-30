import { useState, type ReactNode } from 'react';
import { STATUS_LABELS, type ReadingStatus } from '../api/types';

export function Spinner({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="loading-row">
      <div className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-error">
      <div className="inline">
        <span>{message}</span>
        {onRetry && (
          <button type="button" className="btn-ghost btn-sm" onClick={onRetry}>
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: ReadingStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function ProgressBar({ percent }: { percent: number | null }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${percent ?? 0}%` }} />
    </div>
  );
}

export function Cover({
  url, title, authors, seedKey, large = false, small = false,
}: { url: string | null; title: string; authors?: string[]; seedKey?: string; large?: boolean; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const className = `cover${large ? ' cover-lg' : ''}${small ? ' cover-sm' : ''}`;

  // Boa parte do catálogo em português não tem imagem em lugar nenhum: nem na Open
  // Library, nem no Google Books. Em vez do marcador genérico, desenhamos uma capa
  // com o próprio título — a grade fica completa e cada livro continua distinguível.
  if (!url || broken) {
    return <CapaTipografica className={className} title={title} authors={authors} seedKey={seedKey} large={large} />;
  }

  return (
    <img
      className={className}
      src={url}
      alt={`Capa de ${title}`}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * Matiz estável por livro. A semente é a chave da obra/edição, não o título:
 * uma busca por "Dom Casmurro" traz várias obras homônimas, e semear pelo título
 * pintaria todas da mesma cor.
 */
function hueDaSemente(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

function CapaTipografica({
  className, title, authors, seedKey, large,
}: { className: string; title: string; authors?: string[]; seedKey?: string; large: boolean }) {
  const hue = hueDaSemente(seedKey || title);
  const autor = authors?.[0] ?? '';
  // Título curto cabe inteiro; longo é cortado pelo CSS (-webkit-line-clamp).
  return (
    <div
      className={`${className} cover-gerada`}
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 34% 26%), hsl(${(hue + 40) % 360} 30% 15%))`,
      }}
      role="img"
      aria-label={`Capa não disponível para ${title}`}
    >
      <span className="cover-gerada-titulo">{title}</span>
      {large && autor && <span className="cover-gerada-autor">{autor}</span>}
    </div>
  );
}

export function Pagination({
  page, totalPages, onChange, disabled,
}: { page: number; totalPages: number; onChange: (page: number) => void; disabled?: boolean }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginação">
      <button type="button" className="btn-ghost btn-sm" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>
        ← Anterior
      </button>
      <span className="small muted">
        Página {page} de {totalPages}
      </span>
      <button type="button" className="btn-ghost btn-sm" disabled={disabled || page >= totalPages} onClick={() => onChange(page + 1)}>
        Próxima →
      </button>
    </nav>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
