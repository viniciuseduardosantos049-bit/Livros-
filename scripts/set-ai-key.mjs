/**
 * Grava a chave da IA em backend/.env sem que ela apareça na tela, no histórico
 * do shell ou em qualquer log. Uso: npm run ia:chave
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'backend', '.env');

if (!fs.existsSync(envPath)) {
  console.error('backend/.env não encontrado. Copie backend/.env.example para backend/.env primeiro.');
  process.exit(1);
}

/** Lê uma linha sem ecoar os caracteres digitados. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let silent = false;
    rl._writeToOutput = (chunk) => {
      if (!silent) process.stdout.write(chunk);
    };
    rl.question(question, (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
    silent = true;
  });
}

function upsert(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

const key = await askHidden('Cole a chave da API do Gemini (não aparece na tela): ');

if (!key) {
  console.error('Nenhuma chave informada. Nada foi alterado.');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{20,}$/.test(key)) {
  console.error('Isso não parece uma chave de API válida. Nada foi alterado.');
  process.exit(1);
}

let content = fs.readFileSync(envPath, 'utf8');
content = upsert(content, 'AI_PROVIDER', 'gemini');
content = upsert(content, 'AI_API_KEY', key);
if (!/^AI_MODEL=/m.test(content)) content = upsert(content, 'AI_MODEL', 'gemini-flash-latest');

fs.writeFileSync(envPath, content, { mode: 0o600 });

console.log(`\n✓ Chave gravada em backend/.env (final …${key.slice(-4)}), permissão 600.`);
console.log('  backend/.env está no .gitignore — a chave não vai para o repositório.');
console.log('\nAgora reinicie o servidor:  npm start');
