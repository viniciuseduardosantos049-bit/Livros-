import webpush from 'web-push';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';

export interface AssinaturaPush {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface InscricaoRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  last_lembrete_em: string | null;
}

let configurado = false;

function garantirConfiguracao(): boolean {
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  if (!configurado) {
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
    configurado = true;
  }
  return true;
}

/** Último momento em que a conta mexeu na leitura: progresso registrado ou livro adicionado. */
async function ultimaAtividade(userId: number): Promise<Date | null> {
  const biblioteca = (await db.prepare('SELECT id FROM user_library WHERE user_id = ? LIMIT 1').get(userId)) as
    | { id: number }
    | undefined;
  if (!biblioteca) return null; // nunca adicionou um livro — nada a retomar

  const row = (await db
    .prepare(
      // 'epoch' (1970-01-01), não '-infinity': o driver converte TIMESTAMPTZ
      // para ISO com `new Date(...).toISOString()`, que lança em -infinity.
      `SELECT GREATEST(
         COALESCE((SELECT MAX(rp.created_at) FROM reading_progress rp
                   JOIN user_library ul ON ul.id = rp.library_item_id
                   WHERE ul.user_id = ?), 'epoch'::timestamptz),
         COALESCE((SELECT MAX(added_at) FROM user_library WHERE user_id = ?), 'epoch'::timestamptz)
       ) AS em`,
    )
    .get(userId, userId)) as { em: string } | undefined;

  if (!row || row.em === null) return null;
  const data = new Date(row.em);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Título do livro em andamento, para o lembrete citar o que a pessoa estava lendo. */
async function livroEmLeitura(userId: number): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT be.title FROM user_library ul
       JOIN book_editions be ON be.id = ul.edition_id
       WHERE ul.user_id = ? AND ul.status = 'READING'
       ORDER BY ul.updated_at DESC LIMIT 1`,
    )
    .get(userId)) as { title: string } | undefined;
  return row?.title ?? null;
}

export const pushService = {
  get enabled(): boolean {
    return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
  },

  get publicKey(): string {
    return env.vapidPublicKey;
  },

  async inscrever(userId: number, sub: AssinaturaPush): Promise<void> {
    await db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      )
      .run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  },

  async cancelar(userId: number, endpoint: string): Promise<void> {
    await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
  },

  async estaInscrito(userId: number, endpoint: string): Promise<boolean> {
    const row = await db
      .prepare('SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .get(userId, endpoint);
    return Boolean(row);
  },

  /**
   * Varre as inscrições, manda lembrete pra quem está inativo há `diasLimite`
   * dias ou mais, e some com inscrições que o navegador já invalidou.
   *
   * Chamado por um gatilho externo (não há cron nativo no plano gratuito da
   * Netlify) — ver `push.routes.ts`.
   */
  async enviarLembretesDeInatividade(diasLimite: number): Promise<{ enviados: number; removidos: number; verificados: number }> {
    if (!garantirConfiguracao()) return { enviados: 0, removidos: 0, verificados: 0 };

    const inscricoes = (await db.prepare('SELECT * FROM push_subscriptions').all()) as InscricaoRow[];
    let enviados = 0;
    let removidos = 0;
    const agora = Date.now();
    const limiteMs = diasLimite * 24 * 60 * 60 * 1000;

    for (const inscricao of inscricoes) {
      const ultima = await ultimaAtividade(inscricao.user_id);
      if (!ultima) continue; // biblioteca vazia — nada para retomar

      const inativoHaMs = agora - ultima.getTime();
      if (inativoHaMs < limiteMs) continue;

      // Já lembrado para esta mesma pausa: só lembra de novo se a pessoa leu
      // algo depois do último lembrete e voltou a ficar inativa.
      const jaLembrado = inscricao.last_lembrete_em && new Date(inscricao.last_lembrete_em) > ultima;
      if (jaLembrado) continue;

      const titulo = await livroEmLeitura(inscricao.user_id);
      const corpo = titulo
        ? `Você não lê "${titulo}" há ${diasLimite} dias. Que tal continuar de onde parou?`
        : `Você não registra leitura há ${diasLimite} dias. Que tal abrir um livro hoje?`;

      try {
        await webpush.sendNotification(
          { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
          JSON.stringify({ title: 'Biblioteca de Leitura', body: corpo, url: '/biblioteca' }),
        );
        await db.prepare('UPDATE push_subscriptions SET last_lembrete_em = now() WHERE id = ?').run(inscricao.id);
        enviados += 1;
      } catch (erro) {
        const status = (erro as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Endpoint que o navegador já descartou (desinstalou, limpou dados...).
          await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(inscricao.id);
          removidos += 1;
        } else {
          console.error('Falha ao enviar push:', erro);
        }
      }
    }

    return { enviados, removidos, verificados: inscricoes.length };
  },
};
