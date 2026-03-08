/**
 * x402 payment signing logic
 * Reusable module for signing EIP-3009 TransferWithAuthorization payments.
 * Used by both the CLI `x402 sign` command and the fetch middleware.
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { ClientError } from '../errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const X402_VERSION = 2;
const USDC_DECIMALS = 6;

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// ---------------------------------------------------------------------------
// Network configs
// ---------------------------------------------------------------------------

interface NetworkConfig {
  chain: typeof base | typeof baseSepolia;
  networkId: string;
  rpcUrl: string;
  label: string;
}

const NETWORKS: Record<string, NetworkConfig> = {
  [`eip155:${base.id}`]: {
    chain: base,
    networkId: `eip155:${base.id}`,
    rpcUrl: 'https://mainnet.base.org',
    label: 'Base Mainnet',
  },
  [`eip155:${baseSepolia.id}`]: {
    chain: baseSepolia,
    networkId: `eip155:${baseSepolia.id}`,
    rpcUrl: 'https://sepolia.base.org',
    label: 'Base Sepolia (testnet)',
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentRequiredAccept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string };
}

export interface PaymentRequiredHeader {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: PaymentRequiredAccept[];
}

/** Minimal wallet info needed for signing */
export interface SignerWallet {
  privateKey: string; // Hex with 0x prefix
  address: string;
}

export interface SignPaymentInput {
  wallet: SignerWallet;
  accept: PaymentRequiredAccept;
  resource?: PaymentRequiredHeader['resource'];
  /** Override amount in atomic units (default: from accept.amount) */
  amountOverride?: bigint;
  /** Override expiry in seconds (default: from accept.maxTimeoutSeconds or 3600) */
  expiryOverride?: number;
}

export interface SignPaymentResult {
  /** Base64-encoded payment signature header value */
  paymentSignatureBase64: string;
  /** Signer address */
  from: string;
  /** Recipient address */
  to: string;
  /** Amount in USD */
  amountUsd: number;
  /** Amount in atomic units */
  amountAtomicUnits: bigint;
  /** Network label */
  networkLabel: string;
  /** Expiry timestamp */
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function randomBytes32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

// ---------------------------------------------------------------------------
// PAYMENT-REQUIRED header parsing
// ---------------------------------------------------------------------------

/**
 * Parse a base64-encoded PAYMENT-REQUIRED header value
 * Returns the parsed header and the first "exact" scheme accept entry
 */
export function parsePaymentRequired(base64Value: string): {
  header: PaymentRequiredHeader;
  accept: PaymentRequiredAccept;
} {
  let decoded: string;
  try {
    decoded = Buffer.from(base64Value, 'base64').toString('utf-8');
  } catch {
    throw new ClientError('Failed to base64-decode the PAYMENT-REQUIRED value.');
  }

  let header: PaymentRequiredHeader;
  try {
    header = JSON.parse(decoded) as PaymentRequiredHeader;
  } catch {
    throw new ClientError('PAYMENT-REQUIRED header is not valid JSON after base64 decoding.');
  }

  if (!header.accepts || !Array.isArray(header.accepts) || header.accepts.length === 0) {
    throw new ClientError('PAYMENT-REQUIRED header has no "accepts" entries.');
  }

  const accept = header.accepts.find((a) => a.scheme === 'exact');
  if (!accept) {
    throw new ClientError(
      `No "exact" scheme found in PAYMENT-REQUIRED accepts. Available: ${header.accepts.map((a) => a.scheme).join(', ')}`
    );
  }

  if (!accept.payTo || !accept.amount || !accept.network || !accept.asset) {
    throw new ClientError(
      'PAYMENT-REQUIRED accept entry is missing required fields (payTo, amount, network, asset).'
    );
  }

  return { header, accept };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign an x402 payment and return a base64-encoded PAYMENT-SIGNATURE header value
 */
export async function signPayment(input: SignPaymentInput): Promise<SignPaymentResult> {
  const { wallet, accept, resource } = input;

  // Resolve network
  const networkConfig = NETWORKS[accept.network];
  if (!networkConfig) {
    throw new ClientError(
      `Unknown network "${accept.network}" in payment requirements. Supported: ${Object.keys(NETWORKS).join(', ')}`
    );
  }

  // Resolve amount
  const amountAtomicUnits = input.amountOverride ?? BigInt(accept.amount);
  const amountUsd = Number(amountAtomicUnits) / 10 ** USDC_DECIMALS;

  // Resolve expiry
  const expirySeconds = (input.expiryOverride ?? accept.maxTimeoutSeconds) || 3600;

  // EIP-3009 domain
  const eip3009Name = accept.extra?.name ?? 'USDC';
  const eip3009Version = accept.extra?.version ?? '2';

  // Sign
  const account = privateKeyToAccount(wallet.privateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  const nonce = randomBytes32();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);

  const signature = await walletClient.signTypedData({
    domain: {
      name: eip3009Name,
      version: eip3009Version,
      chainId: networkConfig.chain.id,
      verifyingContract: accept.asset as Hex,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: account.address,
      to: accept.payTo as Hex,
      value: amountAtomicUnits,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });

  // Build x402 payload
  const paymentPayload = {
    x402Version: X402_VERSION,
    ...(resource !== undefined && { resource }),
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: accept.payTo,
        value: amountAtomicUnits.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce,
      },
    },
    accepted: {
      scheme: 'exact',
      network: networkConfig.networkId,
      asset: accept.asset,
      amount: amountAtomicUnits.toString(),
      payTo: accept.payTo,
      maxTimeoutSeconds: expirySeconds,
      extra: { name: eip3009Name, version: eip3009Version },
    },
  };

  const paymentSignatureBase64 = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  return {
    paymentSignatureBase64,
    from: account.address,
    to: accept.payTo,
    amountUsd,
    amountAtomicUnits,
    networkLabel: networkConfig.label,
    expiresAt: new Date(Number(validBefore) * 1000),
  };
}
