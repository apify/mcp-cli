/**
 * HTTP proxy server with request counting for E2E testing
 * Uses proxy-chain to forward requests.
 *
 * Outputs to stdout once ready:
 *   PROXY_PORT=<port>
 *   PROXY_CONTROL_PORT=<port>
 *
 * Control API (plain HTTP on PROXY_CONTROL_PORT):
 *   GET /request-count  → { "count": <number> }
 *   POST /reset         → resets count to 0
 */

import { Server } from 'proxy-chain';
import { createServer } from 'http';

let requestCount = 0;

const proxyServer = new Server({
  port: 0,
  verbose: false,
  prepareRequestFunction: () => {
    requestCount++;
    return {};
  },
});

await proxyServer.listen();

// Tiny control server to query request count
const controlServer = createServer((req, res) => {
  if (req.url === '/request-count' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: requestCount }));
  } else if (req.url === '/reset' && req.method === 'POST') {
    requestCount = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: 0 }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

await new Promise<void>((resolve) => controlServer.listen(0, '127.0.0.1', resolve));
const controlPort = (controlServer.address() as import('net').AddressInfo).port;

// Signal readiness to the bash framework
process.stdout.write(`PROXY_PORT=${proxyServer.port}\n`);
process.stdout.write(`PROXY_CONTROL_PORT=${controlPort}\n`);

process.on('SIGTERM', () => {
  controlServer.close();
  proxyServer.close();
  process.exit(0);
});
