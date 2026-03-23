/**
 * Proxy-aware fetch and global HTTP proxy setup
 *
 * Node.js native fetch (powered by undici) does not respect HTTP_PROXY/HTTPS_PROXY
 * environment variables, and undici's setGlobalDispatcher() is not honored by
 * libraries that manage their own HTTP connections (e.g., the MCP SDK's
 * StreamableHTTPClientTransport).
 *
 * This module provides:
 * 1. `initProxy()` — sets up the global undici dispatcher for proxy support
 *    and initializes the proxy-aware fetch. Must be called once at process startup.
 * 2. `proxyFetch()` — a fetch function that explicitly routes through the
 *    EnvHttpProxyAgent dispatcher, for use in code that bypasses the global dispatcher.
 */

import {
  EnvHttpProxyAgent,
  setGlobalDispatcher,
  fetch as undiciFetch,
  type Dispatcher,
} from 'undici';

let proxyAgent: Dispatcher | undefined;

/**
 * Initialize HTTP proxy support from environment variables
 * (HTTPS_PROXY, HTTP_PROXY, NO_PROXY, and lowercase variants).
 *
 * Sets the global undici dispatcher AND initializes the proxy-aware fetch agent.
 * Must be called once at process startup (in CLI and bridge entry points).
 *
 * @param options.insecure - Disable TLS certificate verification (for self-signed certs)
 */
export function initProxy(options?: { insecure?: boolean }): void {
  proxyAgent = new EnvHttpProxyAgent(
    options?.insecure ? { connect: { rejectUnauthorized: false } } : {}
  );
  setGlobalDispatcher(proxyAgent);
}

/**
 * A fetch function that explicitly routes through the HTTP proxy configured via
 * environment variables. Use this where the global dispatcher is not respected
 * (e.g., MCP SDK transport, OAuth calls).
 *
 * Falls back to a default EnvHttpProxyAgent if initProxy() was not called.
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
