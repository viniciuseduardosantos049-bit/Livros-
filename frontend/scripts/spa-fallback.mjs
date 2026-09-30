/**
 * Fallback de SPA para hospedagem estática.
 *
 * O roteamento é do lado do cliente: só existe um index.html, e um acesso
 * direto a /entrar ou um F5 em /biblioteca pediriam um arquivo que não existe.
 *
 * Em vez de depender de uma regra de reescrita do provedor, o próprio build
 * materializa os arquivos:
 *   - uma cópia por rota de primeiro nível (a Vercel serve `entrar.html` em
 *     `/entrar`), o que devolve 200 de verdade;
 *   - um 404.html, que cobre as rotas dinâmicas (/biblioteca/8, /obras/OL123W)
 *     e qualquer rota nova — o app carrega e o roteador resolve o caminho.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const index = path.join(dist, 'index.html');

if (!fs.existsSync(index)) {
  console.error('dist/index.html não encontrado — rode o build antes.');
  process.exit(1);
}

// Rotas de primeiro nível declaradas em src/App.tsx.
const ROTAS = ['entrar', 'criar-conta', 'biblioteca', 'pesquisar', 'anotacoes', 'estatisticas', 'obras'];

const html = fs.readFileSync(index);
for (const rota of [...ROTAS, '404']) {
  fs.writeFileSync(path.join(dist, `${rota}.html`), html);
}

console.log(`fallback de SPA: ${ROTAS.length} rotas + 404.html`);
