/**
 * x402 fetch middleware for MCP transport
 *
 * Wraps the fetch function used by StreamableHTTPClientTransport to:
 * 1. Reuse a cached payment signature across tool calls within a session
 * 2. Sign a fresh payment on the first call (or after cache invalidation)
 * 3. Handle HTTP 402 responses by parsing PAYMENT-REQUIRED, signing, and retrying once
 *
 * Payment is injected in two places simultaneously (server decides which to use):
 * - HTTP header: PAYMENT-SIGNATURE (base64-encoded payment payload)
 * - JSON-RPC body: params._meta["x402/payment"] (payment payload object)
 *
 * The cache is shared with the bridge layer, which invalidates it when the server
 * returns a payment-required tool result and signs a fresh payment before retrying.
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
 * Shared mutable cache for payment signatures between the fetch middleware and the bridge.
 * The middleware reads and writes cached signatures; the bridge invalidates on JSON-RPC 402.
 */
export interface X402PaymentCache {
  /** Base64-encoded payment signature, or null if not yet signed / invalidated */
  signature: string | null;
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

  /** Shared mutable cache for reusing payment signatures across tool calls */
  paymentCache: X402PaymentCache;
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
  const { wallet, getToolByName, paymentCache } = options;

  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    // Try to get a payment signature (cached or freshly signed) for tools/call requests
    const paymentSignature = await getOrSignPayment(init, wallet, getToolByName, paymentCache);
    if (paymentSignature) {
      const enhancedInit = injectPayment(init, paymentSignature);
      const response = await baseFetch(url, enhancedInit);

      // If payment succeeded (not HTTP 402), return immediately
      if (response.status !== 402) {
        return response;
      }

      // HTTP 402 — invalidate cache and fall through to fallback
      logger.debug('Payment rejected (HTTP 402), invalidating cache');
      paymentCache.signature = null;
      return handle402Fallback(url, init, response, baseFetch, wallet, paymentCache);
    }

    // No payment needed — make request normally
    const response = await baseFetch(url, init);

    // Check for HTTP 402 fallback
    if (response.status === 402) {
      return handle402Fallback(url, init, response, baseFetch, wallet, paymentCache);
    }

    return response;
  };
}

/**
 * Get a cached payment signature or sign a fresh one for a tools/call request.
 * Returns the base64-encoded PAYMENT-SIGNATURE, or undefined if the request
 * is not a tools/call for a payment-required tool.
 */
async function getOrSignPayment(
  init: RequestInit | undefined,
  wallet: SignerWallet,
  getToolByName: ((name: string) => Tool | undefined) | undefined,
  paymentCache: X402PaymentCache
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
    logger.debug(`Tool "${toolName}" not found in cache, skipping payment`);
    return undefined;
  }

  // Check _meta.x402
  const meta = (tool as { _meta?: { x402?: ToolPaymentMeta } })._meta;
  const x402 = meta?.x402;
  if (!x402 || !x402.paymentRequired) {
    return undefined;
  }

  // Return cached signature if available
  if (paymentCache.signature) {
    logger.debug(`Using cached payment signature for tool "${toolName}"`);
    return paymentCache.signature;
  }

  // Check if we have enough info to sign
  if (!x402.scheme || !x402.network || !x402.amount || !x402.asset || !x402.payTo) {
    logger.debug(
      `Tool "${toolName}" has x402 metadata but missing fields, skipping payment signing`
    );
    return undefined;
  }

  // Build accept from tool metadata and sign fresh
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
      `Fresh payment signed: $${result.amountUsd.toFixed(4)} to ${result.to} on ${result.networkLabel}`
    );
    paymentCache.signature = result.paymentSignatureBase64;
    return result.paymentSignatureBase64;
  } catch (error) {
    logger.warn(`Payment signing failed for tool "${toolName}":`, error);
    return undefined;
  }
}

/**
 * Handle a 402 response by parsing PAYMENT-REQUIRED, signing, and retrying once.
 * Also updates the payment cache with the freshly signed payment.
 */
async function handle402Fallback(
  url: string | URL,
  originalInit: RequestInit | undefined,
  response402: Response,
  baseFetch: FetchLike,
  wallet: SignerWallet,
  paymentCache: X402PaymentCache
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

    // Cache the freshly signed payment for subsequent calls
    paymentCache.signature = result.paymentSignatureBase64;

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
 * Extract `PaymentRequiredAccept` from a PaymentRequired object.
 * Returns the first "exact" scheme accept entry, or undefined if not found.
 *
 * The data is expected to have the shape: `{ x402Version, accepts: [...] }`
 */
export function extractAcceptFromPaymentRequired(data: unknown):
  | {
      accept: PaymentRequiredAccept;
      resource?: { url?: string; description?: string; mimeType?: string };
    }
  | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.accepts) || obj.accepts.length === 0) return undefined;

  const accept = (obj.accepts as PaymentRequiredAccept[]).find((a) => a.scheme === 'exact');
  if (!accept || !accept.payTo || !accept.amount || !accept.network || !accept.asset) {
    return undefined;
  }

  const resource = obj.resource as
    | { url?: string; description?: string; mimeType?: string }
    | undefined;
  if (resource) {
    return { accept, resource };
  }
  return { accept };
}

/** Content item from MCP tool result */
interface ToolResultContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** Shape of an MCP tool call result */
interface ToolCallResult {
  content?: ToolResultContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Check if a tool call result is an x402 payment-required response.
 * Returns the PaymentRequired data if found, undefined otherwise.
 *
 * Per the x402 MCP transport spec, payment required is signaled as a tool result with:
 * - isError: true
 * - structuredContent containing { x402Version, accepts: [...] } (preferred)
 * - OR content[0].text as JSON-encoded PaymentRequired (fallback)
 */
export function extractPaymentRequiredFromResult(
  result: unknown
): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') return undefined;

  const toolResult = result as ToolCallResult;
  if (!toolResult.isError) return undefined;

  // Path 1: structuredContent (preferred)
  if (toolResult.structuredContent && isPaymentRequired(toolResult.structuredContent)) {
    return toolResult.structuredContent;
  }

  // Path 2: content[0].text as JSON (fallback)
  const content = toolResult.content;
  if (!Array.isArray(content) || content.length === 0) return undefined;

  const first = content[0] as ToolResultContent | undefined;
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return undefined;

  try {
    const parsed: unknown = JSON.parse(first.text);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      isPaymentRequired(parsed as Record<string, unknown>)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON
  }

  return undefined;
}

/** Check if an object looks like a PaymentRequired (has x402Version + accepts array) */
function isPaymentRequired(obj: Record<string, unknown>): boolean {
  return 'x402Version' in obj && 'accepts' in obj && Array.isArray(obj.accepts);
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
