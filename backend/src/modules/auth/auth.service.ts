import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { HttpError } from '../../lib/http.js';

const BCRYPT_ROUNDS = 12;

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

export const authService = {
  async register(name: string, email: string, password: string): Promise<PublicUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (exists) throw HttpError.conflict('Já existe uma conta com este e-mail');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = await db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name.trim(), normalizedEmail, passwordHash);

    const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid as number) as UserRow;
    return toPublicUser(row);
  },

  async login(email: string, password: string): Promise<PublicUser> {
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
      | UserRow
      | undefined;

    // Compara mesmo sem usuário para não vazar quais e-mails existem (timing).
    const hash = row?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
    const ok = await bcrypt.compare(password, hash);
    if (!row || !ok) throw HttpError.unauthorized('E-mail ou senha inválidos');

    return toPublicUser(row);
  },

  issueToken(user: PublicUser): string {
    return jwt.sign({ email: user.email, name: user.name }, env.jwtSecret, {
      subject: String(user.id),
      expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    });
  },

  async findById(id: number): Promise<PublicUser | null> {
    const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toPublicUser(row) : null;
  },
};
