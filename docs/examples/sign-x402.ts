#!/usr/bin/env -S npx tsx
/**
 * Minimal x402 payment signer — drop-in alternative to `mcpc x402 sign`.
 *
 * Signs the EIP-3009 `exact` scheme on Base / Base Sepolia and prints the
 * base64 PAYMENT-SIGNATURE header value. Does NOT handle the `upto` scheme
 * (Permit2 approval flow) — use `mcpc x402 sign` or the official x402 SDK
 * for that.
 *
 * Usage:
 *   npm install viem tsx
 *   PRIVATE_KEY=0x... npx tsx sign-x402.ts <base64-PAYMENT-REQUIRED>
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, type Hex } from 'viem';
import { base, baseSepolia, type Chain } from 'viem/chains';

interface Accept {
  scheme: string;
  network: string;
  amount: string;
  asset: Hex;
  payTo: Hex;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

interface PaymentRequired {
  resource?: { url?: string; mimeType?: string; description?: string };
  accepts: Accept[];
}

const NETWORKS: Record<string, { chain: Chain; rpc: string }> = {
  [`eip155:${base.id}`]: { chain: base, rpc: 'https://mainnet.base.org' },
  [`eip155:${baseSepolia.id}`]: { chain: baseSepolia, rpc: 'https://sepolia.base.org' },
};

const TRANSFER_WITH_AUTHORIZATION = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const [, , paymentRequiredB64] = process.argv;
const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
if (!privateKey || !paymentRequiredB64) {
  console.error('Usage: PRIVATE_KEY=0x... npx tsx sign-x402.ts <base64-PAYMENT-REQUIRED>');
  process.exit(1);
}

// 1. Decode PAYMENT-REQUIRED and pick the first `exact`-scheme accept entry.
const header: PaymentRequired = JSON.parse(
  Buffer.from(paymentRequiredB64, 'base64').toString('utf8')
);
const accept = header.accepts?.find((a) => a.scheme === 'exact');
if (!accept) throw new Error('No `exact` scheme entry in PAYMENT-REQUIRED.accepts');

const network = NETWORKS[accept.network];
if (!network) throw new Error(`Unsupported network: ${accept.network}`);

// 2. Build the authorization. `value` is already in atomic units (USDC has 6 decimals).
//    `validAfter: 0` means "valid immediately"; `validBefore` is now + timeout.
const account = privateKeyToAccount(privateKey);
const value = BigInt(accept.amount);
const validBefore = BigInt(Math.floor(Date.now() / 1000) + (accept.maxTimeoutSeconds ?? 3600));
const nonce = ('0x' +
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')) as Hex;

// 3. Sign EIP-712 typed data. The domain's verifyingContract is the USDC token
//    contract itself — EIP-3009 is implemented by the token, not by a separate proxy.
const client = createWalletClient({ account, chain: network.chain, transport: http(network.rpc) });
const signature = await client.signTypedData({
  domain: {
    name: accept.extra?.name ?? 'USDC',
    version: accept.extra?.version ?? '2',
    chainId: network.chain.id,
    verifyingContract: accept.asset,
  },
  types: TRANSFER_WITH_AUTHORIZATION,
  primaryType: 'TransferWithAuthorization',
  message: { from: account.address, to: accept.payTo, value, validAfter: 0n, validBefore, nonce },
});

// 4. Wrap into the x402 payment payload and base64-encode for the PAYMENT-SIGNATURE header.
const payload = {
  x402Version: 2,
  resource: header.resource ?? { url: 'https://example.com', mimeType: 'application/json' },
  payload: {
    signature,
    authorization: {
      from: account.address,
      to: accept.payTo,
      value: value.toString(),
      validAfter: '0',
      validBefore: validBefore.toString(),
      nonce,
    },
  },
  accepted: {
    scheme: 'exact',
    network: accept.network,
    asset: accept.asset,
    amount: value.toString(),
    payTo: accept.payTo,
    maxTimeoutSeconds: accept.maxTimeoutSeconds ?? 3600,
    extra: { name: accept.extra?.name ?? 'USDC', version: accept.extra?.version ?? '2' },
  },
};

console.log(Buffer.from(JSON.stringify(payload)).toString('base64'));
