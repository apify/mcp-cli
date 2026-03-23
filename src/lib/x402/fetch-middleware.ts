/**
 * x402 fetch middleware for MCP transport
 *
 * Wraps the fetch function used by StreamableHTTPClientTransport to:
 * 1. Proactively sign payments when tool metadata includes _meta.x402
 * 2. Handle HTTP 402 responses by parsing PAYMENT-REQUIRED, signing, and retrying once
 *
 * Payment is injected in two places simultaneously (server decides which to use):
 * - HTTP header: PAYMENT-SIGNATURE (base64-encoded payment payload)
 * - JSON-RPC body: params._meta["x402/payment"] (payment payload object)
 *
 * This middleware is injected into the transport via the SDK's `fetch` option.
 */

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  signPayment,
  parsePaymentRequired,
  type SignerWallet,
  type PaymentRequiredAccept,
  type PaymentRequiredHeader,
} from './signer.js';
import { createLogger } from '../logger.js';

const logger = createLogger('x402-middleware');

/** MCP _meta key for x402 payment (per x402 MCP spec) */
const MCP_PAYMENT_META_KEY = 'x402/payment';

/** Payment information from tool's _meta.x402 */
interface ToolPaymentMeta {
  paymentRequired: boolean;
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

/** Parsed JSON-RPC request body (enough to identify tools/call) */
interface JsonRpcRequest {
  method?: string;
  params?: {
    name?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Options for creating the x402 fetch middleware
 */
export interface X402FetchMiddlewareOptions {
  /** The wallet to sign payments with */
  wallet: SignerWallet;

  /**
   * Callback to look up a tool by name to check _meta.x402.
   * Returns the tool if found, undefined otherwise.
   * This is called per tools/call request for proactive signing.
   */
  getToolByName?: (name: string) => Tool | undefined;
}

/**
 * Create a fetch middleware that handles x402 payments.
 *
 * Returns a FetchLike function that wraps the original fetch:
 * - For tools/call POST requests: proactively sign if tool has _meta.x402
 * - For any request returning 402: parse, sign, retry once
 * - All other requests: pass through unchanged
 */
export function createX402FetchMiddleware(
  baseFetch: FetchLike,
  options: X402FetchMiddlewareOptions
): FetchLike {
  const { wallet, getToolByName } = options;

  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    // Try proactive signing for tools/call requests
    const proactiveHeader = await tryProactiveSigning(init, wallet, getToolByName);
    if (proactiveHeader) {
      logger.debug('Proactively signing x402 payment for tools/call');
      const enhancedInit = injectPayment(init, proactiveHeader);
      const response = await baseFetch(url, enhancedInit);

      // If proactive signing succeeded (not 402), return immediately
      if (response.status !== 402) {
        return response;
      }

      // Proactive signing failed with 402 — fall through to 402 fallback
      logger.debug('Proactive payment rejected (402), falling back to 402 handler');
      return handle402Fallback(url, init, response, baseFetch, wallet);
    }

    // No proactive signing — make request normally
    const response = await baseFetch(url, init);

    // Check for 402 fallback
    if (response.status === 402) {
      return handle402Fallback(url, init, response, baseFetch, wallet);
    }

    return response;
  };
}

/**
 * Try to proactively sign a payment based on tool metadata.
 * Returns the base64-encoded PAYMENT-SIGNATURE header, or undefined if not applicable.
 */
async function tryProactiveSigning(
  init: RequestInit | undefined,
  wallet: SignerWallet,
  getToolByName?: (name: string) => Tool | undefined
): Promise<string | undefined> {
  if (!getToolByName || !init?.body) {
    return undefined;
  }

  // Only handle POST requests (tools/call is always POST)
  if (init.method && init.method.toUpperCase() !== 'POST') {
    return undefined;
  }

  // Parse the request body to find tools/call requests
  const toolName = extractToolCallName(init.body);
  if (!toolName) {
    return undefined;
  }

  // Look up tool metadata
  const tool = getToolByName(toolName);
  if (!tool) {
    logger.debug(`Tool "${toolName}" not found in cache, skipping proactive signing`);
    return undefined;
  }

  // Check _meta.x402
  const meta = (tool as { _meta?: { x402?: ToolPaymentMeta } })._meta;
  const x402 = meta?.x402;
  if (!x402 || !x402.paymentRequired) {
    return undefined;
  }

  // Check if we have enough info to sign proactively
  if (!x402.scheme || !x402.network || !x402.amount || !x402.asset || !x402.payTo) {
    logger.debug(
      `Tool "${toolName}" has x402 metadata but missing fields, skipping proactive signing`
    );
    return undefined;
  }

  // Build accept from tool metadata
  const accept: PaymentRequiredAccept = {
    scheme: x402.scheme,
    network: x402.network,
    amount: x402.amount,
    asset: x402.asset,
    payTo: x402.payTo,
    maxTimeoutSeconds: x402.maxTimeoutSeconds || 3600,
    ...(x402.extra && { extra: x402.extra }),
  };

  try {
    const result = await signPayment({ wallet, accept });
    logger.debug(
      `Proactive payment signed: $${result.amountUsd.toFixed(4)} to ${result.to} on ${result.networkLabel}`
    );
    return result.paymentSignatureBase64;
  } catch (error) {
    logger.warn(`Proactive signing failed for tool "${toolName}":`, error);
    return undefined;
  }
}

/**
 * Handle a 402 response by parsing PAYMENT-REQUIRED, signing, and retrying once.
 */
async function handle402Fallback(
  url: string | URL,
  originalInit: RequestInit | undefined,
  response402: Response,
  baseFetch: FetchLike,
  wallet: SignerWallet
): Promise<Response> {
  // Extract PAYMENT-REQUIRED header (case-insensitive)
  const paymentRequiredBase64 =
    response402.headers.get('PAYMENT-REQUIRED') || response402.headers.get('payment-required');

  if (!paymentRequiredBase64) {
    logger.debug('402 response has no PAYMENT-REQUIRED header, passing through');
    return response402;
  }

  logger.debug('Received 402 with PAYMENT-REQUIRED header, signing payment...');

  let header: PaymentRequiredHeader;
  let accept: PaymentRequiredAccept;
  try {
    ({ header, accept } = parsePaymentRequired(paymentRequiredBase64));
  } catch (error) {
    logger.warn('Failed to parse PAYMENT-REQUIRED header:', error);
    return response402;
  }

  // Sign the payment
  try {
    const result = await signPayment({
      wallet,
      accept,
      resource: header.resource,
    });

    logger.debug(
      `402 fallback payment signed: $${result.amountUsd.toFixed(4)} to ${result.to} on ${result.networkLabel}`
    );

    // Retry with payment signature (once only)
    const retryInit = injectPayment(originalInit, result.paymentSignatureBase64);
    return await baseFetch(url, retryInit);
  } catch (error) {
    logger.warn('402 fallback signing failed:', error);
    return response402;
  }
}

/**
 * Extract the tool name from a JSON-RPC tools/call request body.
 * Returns undefined if the body isn't a tools/call request.
 */
function extractToolCallName(body: RequestInit['body'] | undefined): string | undefined {
  if (!body || typeof body !== 'string') {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(body);

    // Handle single request
    if (!Array.isArray(parsed)) {
      const req = parsed as JsonRpcRequest;
      if (req.method === 'tools/call' && req.params?.name) {
        return req.params.name;
      }
      return undefined;
    }

    // Handle batch — find first tools/call
    for (const item of parsed) {
      const req = item as JsonRpcRequest;
      if (req.method === 'tools/call' && req.params?.name) {
        return req.params.name;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Inject payment into both the HTTP header and the JSON-RPC body _meta.
 * The same payment payload is used for both channels so the server can pick either.
 */
function injectPayment(init: RequestInit | undefined, paymentSignatureBase64: string): RequestInit {
  // 1. HTTP header (existing mechanism)
  const headers = new Headers(init?.headers);
  headers.set('PAYMENT-SIGNATURE', paymentSignatureBase64);

  const result: RequestInit = { ...init, headers };

  // 2. JSON-RPC body _meta (x402 MCP spec mechanism)
  if (init?.body && typeof init.body === 'string') {
    try {
      const paymentPayload = JSON.parse(
        Buffer.from(paymentSignatureBase64, 'base64').toString('utf-8')
      ) as Record<string, unknown>;
      result.body = injectPaymentMeta(init.body, paymentPayload);
    } catch (error) {
      logger.debug('Failed to inject payment into body _meta:', error);
      // Fall back to header-only — body injection is best-effort
    }
  }

  return result;
}

/**
 * Inject payment payload into the _meta field of a single tools/call JSON-RPC request.
 * Batch requests are left untouched (header-only) — a single payment cannot safely
 * apply to multiple tools/call entries that may have different pricing.
 */
function injectPaymentMeta(body: string, paymentPayload: Record<string, unknown>): string {
  try {
    const parsed: unknown = JSON.parse(body);

    // IMPORTANT: Skip batch requests. Injecting the same payment into every tools/call
    // entry in a batch is wrong — each tool may have different pricing, and one signed
    // payment cannot safely apply to multiple calls. Batches still get the HTTP header
    // (PAYMENT-SIGNATURE), which the server can use as a fallback.
    if (Array.isArray(parsed)) {
      return body;
    }

    const req = parsed as JsonRpcRequest;
    if (req.method === 'tools/call' && req.params) {
      return JSON.stringify({
        ...req,
        params: {
          ...req.params,
          _meta: {
            ...((req.params._meta as Record<string, unknown>) || {}),
            [MCP_PAYMENT_META_KEY]: paymentPayload,
          },
        },
      });
    }

    return body;
  } catch {
    return body;
  }
}
