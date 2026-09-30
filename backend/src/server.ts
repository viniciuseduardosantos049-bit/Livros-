import { createApp } from './app.js';
import { env } from './config/env.js';
import { migrate } from './db/index.js';
import { findFreePort } from './lib/port.js';

const DEFAULT_START_PORT = 4300;

async function main() {
  await migrate();

  const desired = env.port || DEFAULT_START_PORT;
  const port = await findFreePort(desired, env.host);

  const server = createApp().listen(port, env.host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log('');
    console.log('  📚  Biblioteca de Leitura');
    console.log(`  →  http://${env.host}:${actualPort}`);
    console.log(`  →  API: http://${env.host}:${actualPort}/api/health`);
    console.log('');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

main().catch((error) => {
  console.error('Falha ao iniciar o servidor:', error);
  process.exit(1);
});
