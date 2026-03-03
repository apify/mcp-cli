/**
 * Simple HTTP proxy server for E2E testing
 * Uses proxy-chain to forward requests.
 *
 * Outputs to stdout once ready:
 *   PROXY_PORT=<port>
 */

import { Server } from 'proxy-chain';

const proxyServer = new Server({ port: 0, verbose: false });

await proxyServer.listen();

// Signal readiness to the bash framework
process.stdout.write(`PROXY_PORT=${proxyServer.port}\n`);

process.on('SIGTERM', () => {
  proxyServer.close();
  process.exit(0);
});
