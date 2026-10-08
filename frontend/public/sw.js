/*
 * Service worker da Biblioteca de Leitura.
 *
 * Estratégias, por tipo de pedido:
 *   navegação  → rede primeiro (com tempo limite), cai para a casca no cache
 *   /assets/*  → cache primeiro (nomes com hash, então nunca ficam velhos)
 *   /api/* GET → rede primeiro, cai para a última resposta conhecida
 *   capas      → cache primeiro, com teto de itens
 *
 * Escrita (POST/PATCH/DELETE) nunca é interceptada: sem rede, o app mostra o
 * erro em vez de fingir que salvou.
 */

const VERSAO = 'v1';
const CACHE_CASCA = `casca-${VERSAO}`;
const CACHE_ASSETS = `assets-${VERSAO}`;
const CACHE_API = `api-${VERSAO}`;
const CACHE_CAPAS = `capas-${VERSAO}`;
const NOSSOS_CACHES = [CACHE_CASCA, CACHE_ASSETS, CACHE_API, CACHE_CAPAS];

const CASCA = ['/', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

const TEMPO_LIMITE_REDE = 3500;
const MAX_CAPAS = 120;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_CASCA).then((cache) => cache.addAll(CASCA)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((nome) => !NOSSOS_CACHES.includes(nome)).map((nome) => caches.delete(nome)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'ATUALIZAR_AGORA') self.skipWaiting();
  // No logout apagamos as respostas da API: outra pessoa pode entrar neste aparelho.
  if (event.data === 'LIMPAR_DADOS') event.waitUntil(caches.delete(CACHE_API));
});

function comTempoLimite(promessa, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tempo limite')), ms);
    promessa.then(
      (valor) => { clearTimeout(timer); resolve(valor); },
      (erro) => { clearTimeout(timer); reject(erro); },
    );
  });
}

async function limitar(nomeCache, max) {
  const cache = await caches.open(nomeCache);
  const chaves = await cache.keys();
  if (chaves.length <= max) return;
  await Promise.all(chaves.slice(0, chaves.length - max).map((chave) => cache.delete(chave)));
}

/** Navegação: rede primeiro para sempre pegar a versão nova quando há conexão. */
async function responderNavegacao(event) {
  try {
    const resposta = await comTempoLimite(fetch(event.request), TEMPO_LIMITE_REDE);
    const cache = await caches.open(CACHE_CASCA);
    cache.put('/', resposta.clone());
    return resposta;
  } catch {
    const cache = await caches.open(CACHE_CASCA);
    return (await cache.match('/')) ?? (await cache.match('/offline.html')) ?? Response.error();
  }
}

async function responderAsset(request) {
  const cache = await caches.open(CACHE_ASSETS);
  const guardado = await cache.match(request);
  if (guardado) return guardado;

  const resposta = await fetch(request);
  if (resposta.ok) cache.put(request, resposta.clone());
  return resposta;
}

async function responderApi(request) {
  const cache = await caches.open(CACHE_API);
  try {
    const resposta = await fetch(request);
    if (resposta.ok) cache.put(request, resposta.clone());
    return resposta;
  } catch {
    const guardado = await cache.match(request);
    if (guardado) {
      // Marca a resposta como vinda do cache para a interface poder avisar.
      const cabecalhos = new Headers(guardado.headers);
      cabecalhos.set('X-Do-Cache', '1');
      return new Response(await guardado.blob(), { status: guardado.status, headers: cabecalhos });
    }
    return new Response(
      JSON.stringify({ error: 'Você está sem conexão e este dado ainda não foi carregado.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

async function responderCapa(request) {
  const cache = await caches.open(CACHE_CAPAS);
  const guardado = await cache.match(request);
  if (guardado) return guardado;

  try {
    const resposta = await fetch(request);
    if (resposta.ok || resposta.type === 'opaque') {
      cache.put(request, resposta.clone());
      limitar(CACHE_CAPAS, MAX_CAPAS);
    }
    return resposta;
  } catch {
    return new Response('', { status: 504 });
  }
}

/** Lembrete de leitura mandado pelo backend (ver push.service.ts). */
self.addEventListener('push', (event) => {
  let dados = { title: 'Biblioteca de Leitura', body: 'Você tem uma novidade por aqui.', url: '/biblioteca' };
  try {
    if (event.data) dados = { ...dados, ...event.data.json() };
  } catch {
    // Payload sem JSON válido: segue com o texto padrão em vez de falhar a notificação.
  }

  event.waitUntil(
    self.registration.showNotification(dados.title, {
      body: dados.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192-maskable.png',
      data: { url: dados.url },
    }),
  );
});

/** Foca a aba já aberta em vez de abrir uma nova, se o app já estiver aberto. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = event.notification.data?.url ?? '/biblioteca';

  event.waitUntil(
    (async () => {
      const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const aberto = clientes.find((c) => new URL(c.url).origin === self.location.origin);
      if (aberto) {
        await aberto.focus();
        aberto.navigate(destino);
      } else {
        await self.clients.openWindow(destino);
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const mesmaOrigem = url.origin === self.location.origin;

  if (request.mode === 'navigate') {
    event.respondWith(responderNavegacao(event));
    return;
  }
  if (!mesmaOrigem) {
    if (request.destination === 'image') event.respondWith(responderCapa(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(responderAsset(request));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(responderApi(request));
    return;
  }
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(responderAsset(request));
  }
});
