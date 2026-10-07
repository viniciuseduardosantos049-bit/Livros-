/**
 * Cria (ou atualiza a senha de) um usuário direto no banco.
 *
 * Com o cadastro aberto desativado, este é o caminho para dar acesso a alguém.
 * Funciona contra qualquer banco: quem manda é o DATABASE_URL do ambiente.
 *
 *   npm run criar-usuario -- --nome "Yasmin" --email yasmin@biblioteca.local
 *   DATABASE_URL=... DATABASE_SSL=true npm run criar-usuario -- --nome ... --email ...
 *
 * Sem --senha, uma senha forte é sorteada e impressa uma única vez.
 * Com --redefinir-senha, um e-mail já existente tem a senha trocada.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, migrate, pool } from './index.js';

const BCRYPT_ROUNDS = 12;

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Alfabeto sem caracteres ambíguos (O/0, l/1): a senha vai ser digitada por uma pessoa. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%&*';

function sortearSenha(tamanho = 16): string {
  const bytes = crypto.randomBytes(tamanho);
  let saida = '';
  for (const b of bytes) saida += ALFABETO[b % ALFABETO.length];
  return saida;
}

async function main(): Promise<void> {
  const nome = (arg('nome') ?? process.env.NOVO_NOME ?? '').trim();
  const email = (arg('email') ?? process.env.NOVO_EMAIL ?? '').trim().toLowerCase();
  const senhaInformada = arg('senha') ?? process.env.NOVA_SENHA;
  const redefinir = process.argv.includes('--redefinir-senha');

  if (nome.length < 2 || !email.includes('@')) {
    console.error('Uso: npm run criar-usuario -- --nome "Nome" --email pessoa@exemplo.com [--senha ...] [--redefinir-senha]');
    process.exitCode = 1;
    return;
  }
  if (senhaInformada && senhaInformada.length < 8) {
    console.error('A senha deve ter ao menos 8 caracteres.');
    process.exitCode = 1;
    return;
  }

  await migrate();

  const senha = senhaInformada ?? sortearSenha();
  const hash = await bcrypt.hash(senha, BCRYPT_ROUNDS);

  const existente = (await db.prepare('SELECT id FROM users WHERE email = ?').get(email)) as { id: number } | undefined;

  if (existente && !redefinir) {
    console.error(`Já existe uma conta com ${email}. Use --redefinir-senha para trocar a senha dela.`);
    process.exitCode = 1;
    return;
  }

  if (existente) {
    await db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?').run(nome, hash, existente.id);
    console.log(`Senha redefinida para ${email} (id ${existente.id}).`);
  } else {
    const info = await db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(nome, email, hash);
    console.log(`Conta criada para ${email} (id ${info.lastInsertRowid}).`);
  }

  if (!senhaInformada) {
    console.log('');
    console.log('  senha gerada: ' + senha);
    console.log('  (aparece só agora — guarde e entregue por um canal seguro)');
  }
}

main()
  .then(() => pool.end())
  .catch(async (erro) => {
    console.error('Falha ao criar o usuário:', erro);
    await pool.end();
    process.exit(1);
  });
