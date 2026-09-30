/**
 * Empacota o backend em um arquivo só, para a função serverless.
 *
 * Os rastreadores de dependência das plataformas erram o alvo neste monorepo
 * (a Vercel chegava a montar a função sem `node_modules`). Com tudo embutido em
 * um bundle, não há o que rastrear.
 *
 * O schema vai junto, ao lado do bundle: migrate() procura primeiro no próprio
 * diretório do módulo.
 *
 * Uso: node scripts/empacotar-funcao.mjs [vercel|netlify]
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ALVOS = {
  vercel: { entrada: 'api/index.ts', saida: 'api/bundle.mjs' },
  netlify: { entrada: 'api/netlify.ts', saida: '../netlify/functions/api.mjs' },
};

const nome = process.argv[2] ?? 'vercel';
const alvo = ALVOS[nome];
if (!alvo) {
  console.error(`Alvo desconhecido: ${nome}. Use ${Object.keys(ALVOS).join(' ou ')}.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(alvo.saida), { recursive: true });

await build({
  entryPoints: [alvo.entrada],
  outfile: alvo.saida,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'bundle',
  // Driver nativo opcional do pg: não usamos, e sem isso o esbuild reclama.
  external: ['pg-native'],
  // Dependências em CommonJS chamam require() dinamicamente (o serverless-http
  // faz isso com 'http'). Em saída ESM o esbuild não resolve sozinho, então
  // devolvemos um require de verdade ao escopo do bundle.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: 'error',
});

const schema = path.join(path.dirname(alvo.saida), 'schema.pg.sql');
fs.copyFileSync('src/db/schema.pg.sql', schema);

const { size } = fs.statSync(alvo.saida);
console.log(`${alvo.saida}: ${(size / 1024 / 1024).toFixed(1)} MB (+ schema.pg.sql)`);
