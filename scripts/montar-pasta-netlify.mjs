/**
 * Monta a pasta pronta para arrastar e soltar no Netlify.
 *
 * O deploy por arrastar não roda build nenhum: ele publica o que vier na pasta.
 * Então aqui a gente faz o build dos dois lados e monta a estrutura final —
 * site estático na raiz, função já empacotada em functions/ e um netlify.toml
 * com os redirecionamentos.
 *
 * Uso: npm run netlify:pasta
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destino = path.join(root, 'deploy-netlify');

const npm = (args, cwd) =>
  execFileSync('npm', args, { cwd: path.join(root, cwd), stdio: 'inherit' });

console.log('1/3  build do frontend');
npm(['run', 'build'], 'frontend');

console.log('2/3  empacotando a função');
npm(['run', 'build:netlify'], 'backend');

console.log('3/3  montando deploy-netlify/');
fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(path.join(root, 'frontend', 'dist'), destino, { recursive: true });
fs.cpSync(path.join(root, 'netlify', 'functions'), path.join(destino, 'functions'), {
  recursive: true,
});

// netlify.toml próprio: sem build, publicando a própria pasta.
fs.writeFileSync(
  path.join(destino, 'netlify.toml'),
  `# Gerado por scripts/montar-pasta-netlify.mjs — não editar à mão.
[build]
  publish = "."
  functions = "functions"

[functions]
  # A função já vem empacotada pelo esbuild.
  node_bundler = "none"
  included_files = ["functions/schema.pg.sql"]

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
`,
);

const tamanho = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .reduce((soma, e) => soma + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);

console.log(`\n✓ deploy-netlify/ pronta — ${(tamanho(destino) / 1024 / 1024).toFixed(1)} MB`);
console.log('  Arraste ESTA pasta para a área de deploy do Netlify.');
console.log('  Depois configure DATABASE_URL e JWT_SECRET nas variáveis do site.');
