import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computePace, computeStreak, pageToPercent, percentToPage, resolveStatusForProgress } from './reading.js';

describe('conversão página × percentual', () => {
  it('converte percentual em página arredondando', () => {
    assert.equal(percentToPage(50, 568), 284);
    assert.equal(percentToPage(0, 568), 0);
    assert.equal(percentToPage(100, 568), 568);
  });

  it('nunca ultrapassa o total nem fica negativo', () => {
    assert.equal(percentToPage(150, 200), 200);
    assert.equal(percentToPage(-10, 200), 0);
  });

  it('não calcula percentual sem total de páginas', () => {
    assert.equal(pageToPercent(120, null), null);
    assert.equal(pageToPercent(120, 0), null);
    assert.equal(pageToPercent(214, 568), 38);
  });
});

describe('ritmo de leitura', () => {
  const now = new Date('2026-09-29T12:00:00Z');

  it('calcula páginas por dia e previsão de término', () => {
    const pace = computePace({
      currentPage: 200,
      totalPages: 400,
      startedAt: '2026-09-19T12:00:00Z',
      finishedAt: null,
      now,
    });
    assert.equal(pace.daysReading, 10);
    assert.equal(pace.pagesPerDay, 20);
    assert.equal(pace.pagesRemaining, 200);
    assert.equal(pace.daysRemaining, 10);
    assert.equal(pace.estimatedFinishDate?.slice(0, 10), '2026-10-09');
  });

  it('não estima término sem total de páginas', () => {
    const pace = computePace({ currentPage: 50, totalPages: null, startedAt: '2026-09-27T12:00:00Z', finishedAt: null, now });
    assert.equal(pace.pagesRemaining, null);
    assert.equal(pace.estimatedFinishDate, null);
  });

  it('não estima término para livro já concluído', () => {
    const pace = computePace({
      currentPage: 400, totalPages: 400,
      startedAt: '2026-09-19T12:00:00Z', finishedAt: '2026-09-28T12:00:00Z', now,
    });
    assert.equal(pace.estimatedFinishDate, null);
    assert.equal(pace.daysReading, 9);
  });

  it('não divide por zero quando nada foi lido', () => {
    const pace = computePace({ currentPage: 0, totalPages: 300, startedAt: null, finishedAt: null, now });
    assert.equal(pace.pagesPerDay, 0);
    assert.equal(pace.daysRemaining, null);
  });
});

describe('sequência de dias de leitura', () => {
  const today = new Date('2026-09-29T12:00:00Z');

  it('conta dias consecutivos até hoje', () => {
    assert.equal(computeStreak(['2026-09-27', '2026-09-28', '2026-09-29'], today), 3);
  });

  it('mantém a sequência quando hoje ainda não teve leitura', () => {
    assert.equal(computeStreak(['2026-09-27', '2026-09-28'], today), 2);
  });

  it('quebra a sequência em dias não consecutivos', () => {
    assert.equal(computeStreak(['2026-09-20', '2026-09-28'], today), 1);
    assert.equal(computeStreak([], today), 0);
  });
});

describe('transição de status pelo progresso (item 7)', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const none = { startedAt: null, finishedAt: null };

  it('começa a leitura ao registrar a primeira página', () => {
    const next = resolveStatusForProgress('WANT_TO_READ', 10, 300, none, now);
    assert.equal(next.status, 'READING');
    assert.equal(next.startedAt, now.toISOString());
  });

  it('retoma um livro pausado', () => {
    const next = resolveStatusForProgress('PAUSED', 120, 300, { startedAt: '2026-09-01T00:00:00Z', finishedAt: null }, now);
    assert.equal(next.status, 'READING');
    assert.equal(next.startedAt, '2026-09-01T00:00:00Z', 'preserva a data de início original');
  });

  it('conclui ao atingir a última página', () => {
    const next = resolveStatusForProgress('READING', 300, 300, { startedAt: '2026-09-01T00:00:00Z', finishedAt: null }, now);
    assert.equal(next.status, 'FINISHED');
    assert.equal(next.finishedAt, now.toISOString());
  });

  it('reabre um livro concluído quando o usuário corrige a página para trás', () => {
    const next = resolveStatusForProgress('FINISHED', 250, 300, { startedAt: '2026-09-01T00:00:00Z', finishedAt: '2026-09-28T00:00:00Z' }, now);
    assert.equal(next.status, 'READING');
    assert.equal(next.finishedAt, null);
  });

  it('volta para "quero ler" ao zerar o progresso', () => {
    const next = resolveStatusForProgress('FINISHED', 0, 300, { startedAt: '2026-09-01T00:00:00Z', finishedAt: '2026-09-28T00:00:00Z' }, now);
    assert.equal(next.status, 'WANT_TO_READ');
    assert.equal(next.startedAt, null);
    assert.equal(next.finishedAt, null);
  });

  it('não conclui quando o total de páginas é desconhecido', () => {
    const next = resolveStatusForProgress('READING', 9999, null, none, now);
    assert.equal(next.status, 'READING');
  });

  it('respeita o abandono explícito do usuário', () => {
    const next = resolveStatusForProgress('ABANDONED', 40, 300, { startedAt: '2026-09-01T00:00:00Z', finishedAt: null }, now);
    assert.equal(next.status, 'ABANDONED');
  });
});
