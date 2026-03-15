/**
 * Proxy-aware fetch function
 *
 * Node.js native fetch (powered by undici) does not respect HTTP_PROXY/HTTPS_PROXY
 * environment variables, and undici's setGlobalDispatcher() is not honored by libraries
 * that manage their own HTTP connections (e.g., the MCP SDK's StreamableHTTPClientTransport).
 *
 * This module provides a fetch function that explicitly routes through an EnvHttpProxyAgent
 * dispatcher, ensuring proxy support works everywhere — including inside the MCP SDK transport
 * and OAuth utility calls.
 */

import { EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

let proxyAgent: Dispatcher | undefined;

/**
 * Initialize the proxy-aware fetch with optional TLS settings.
 * Must be called once at process startup (in CLI and bridge entry points).
 */
export function initProxyFetch(options?: { insecure?: boolean }): void {
  proxyAgent = new EnvHttpProxyAgent(
    options?.insecure ? { connect: { rejectUnauthorized: false } } : {}
  );
}

/**
 * A fetch function that routes through the HTTP proxy configured via environment variables.
 * Falls back to a default EnvHttpProxyAgent if initProxyFetch() was not called.
 */
export function proxyFetch(
  input: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1]
): ReturnType<typeof undiciFetch> {
  if (!proxyAgent) {
    proxyAgent = new EnvHttpProxyAgent();
  }
  return undiciFetch(input, { ...init, dispatcher: proxyAgent });
}
