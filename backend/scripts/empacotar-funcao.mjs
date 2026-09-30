/**
 * Empacota o backend inteiro em um arquivo só, para a função serverless.
 *
 * O rastreador de dependências da plataforma enraíza a função na pasta do
 * código compilado e deixa `node_modules` de fora — o que quebrava a função
 * com "Cannot find package 'cookie-parser'". Com tudo embutido em um bundle,
 * não há o que rastrear.
 *
 * O schema vai junto, ao lado do bundle: migrate() procura primeiro no próprio
 * diretório do módulo.
 */
import { build } from 'esbuild';
import fs from 'node:fs';

await build({
  entryPoints: ['api/index.ts'],
  outfile: 'api/bundle.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'bundle',
  // Driver nativo opcional do pg: não usamos, e sem isso o esbuild reclama.
  external: ['pg-native'],
  logLevel: 'error',
});

fs.copyFileSync('src/db/schema.pg.sql', 'api/schema.pg.sql');

const { size } = fs.statSync('api/bundle.mjs');
console.log(`api/bundle.mjs: ${(size / 1024 / 1024).toFixed(1)} MB (+ schema.pg.sql)`);
