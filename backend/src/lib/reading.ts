/**
 * Regras puras de progresso de leitura — sem banco e sem Express, para poder
 * testar cada caso de borda isoladamente (ver src/lib/reading.test.ts).
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Converte datas do SQLite ("YYYY-MM-DD HH:MM:SS", em UTC) e ISO para Date. */
export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function percentToPage(percent: number, totalPages: number): number {
  return Math.min(totalPages, Math.max(0, Math.round((percent / 100) * totalPages)));
}

export function pageToPercent(currentPage: number, totalPages: number | null): number | null {
  if (!totalPages || totalPages <= 0) return null;
  return Math.min(100, Math.round((currentPage / totalPages) * 100));
}

export interface PaceInput {
  currentPage: number;
  totalPages: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  now?: Date;
}

export interface Pace {
  /** Dias corridos entre o início e hoje (ou a conclusão). Mínimo 1. */
  daysReading: number;
  pagesPerDay: number;
  pagesRemaining: number | null;
  /** Dias restantes no ritmo atual; null quando não dá para estimar. */
  daysRemaining: number | null;
  estimatedFinishDate: string | null;
}

export function computePace({ currentPage, totalPages, startedAt, finishedAt, now = new Date() }: PaceInput): Pace {
  const start = parseDate(startedAt);
  const end = parseDate(finishedAt) ?? now;

  const daysReading = start ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY)) : 1;
  const pagesPerDay = currentPage > 0 ? Number((currentPage / daysReading).toFixed(1)) : 0;
  const pagesRemaining = totalPages ? Math.max(0, totalPages - currentPage) : null;

  let daysRemaining: number | null = null;
  let estimatedFinishDate: string | null = null;
  if (!finishedAt && pagesRemaining !== null && pagesRemaining > 0 && pagesPerDay > 0) {
    daysRemaining = Math.ceil(pagesRemaining / pagesPerDay);
    estimatedFinishDate = new Date(now.getTime() + daysRemaining * MS_PER_DAY).toISOString();
  }

  return { daysReading, pagesPerDay, pagesRemaining, daysRemaining, estimatedFinishDate };
}

/**
 * Sequência de dias consecutivos com leitura registrada, contada de trás para
 * frente. Hoje ainda sem registro não quebra a sequência (o dia não acabou).
 */
export function computeStreak(days: string[], today = new Date()): number {
  const set = new Set(days);
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  if (!set.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export type StatusTransition = { status: string; startedAt: string | null; finishedAt: string | null };

/**
 * Item 7: a mudança de status acompanha o progresso em vez de exigir que o
 * usuário lembre de trocar na mão.
 */
export function resolveStatusForProgress(
  currentStatus: string,
  currentPage: number,
  totalPages: number | null,
  existing: { startedAt: string | null; finishedAt: string | null },
  now = new Date(),
): StatusTransition {
  const iso = now.toISOString();

  if (totalPages && currentPage >= totalPages) {
    return { status: 'FINISHED', startedAt: existing.startedAt ?? iso, finishedAt: existing.finishedAt ?? iso };
  }
  if (currentPage === 0) {
    // Voltou à estaca zero: deixa de ser uma leitura em andamento.
    const status = currentStatus === 'FINISHED' ? 'WANT_TO_READ' : currentStatus;
    return { status, startedAt: status === 'WANT_TO_READ' ? null : existing.startedAt, finishedAt: null };
  }
  if (currentStatus === 'WANT_TO_READ' || currentStatus === 'PAUSED' || currentStatus === 'FINISHED') {
    return { status: 'READING', startedAt: existing.startedAt ?? iso, finishedAt: null };
  }
  return { status: currentStatus, startedAt: existing.startedAt ?? iso, finishedAt: null };
}
