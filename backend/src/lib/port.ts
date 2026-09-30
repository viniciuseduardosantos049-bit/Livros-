import net from 'node:net';

function isFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/** Procura a primeira porta livre a partir de `start` (0 = deixa o SO escolher). */
export async function findFreePort(start: number, host: string, attempts = 50): Promise<number> {
  if (start === 0) return 0;
  for (let port = start; port < start + attempts; port += 1) {
    if (await isFree(port, host)) return port;
  }
  return 0;
}
