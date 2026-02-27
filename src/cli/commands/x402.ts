/**
 * x402 wallet management and payment signing commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { formatSuccess, formatError, formatInfo, formatJson } from '../output.js';
import {
  loadWallets,
  getWallet,
  saveWallet,
  removeWallet,
  resolveWalletName,
} from '../../lib/wallets.js';
import { ClientError } from '../../lib/errors.js';
import type { OutputMode } from '../../lib/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WALLET_NAME = 'default';
const USDC_DECIMALS = 6;
const X402_VERSION = 2;

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
// PAYMENT-REQUIRED header parsing
// ---------------------------------------------------------------------------

interface PaymentRequiredAccept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string };
}

interface PaymentRequiredHeader {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: PaymentRequiredAccept[];
}

function parsePaymentRequired(base64Value: string): {
  header: PaymentRequiredHeader;
  accept: PaymentRequiredAccept;
} {
  let decoded: string;
  try {
    decoded = Buffer.from(base64Value, 'base64').toString('utf-8');
  } catch {
    throw new ClientError('Failed to base64-decode the --payment-required value.');
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
// Crypto helpers
// ---------------------------------------------------------------------------

function randomBytes32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

// ---------------------------------------------------------------------------
// Command: init
// ---------------------------------------------------------------------------

async function initWallet(options: { name?: string; outputMode: OutputMode }): Promise<void> {
  const name = resolveWalletName(options.name);

  const existing = await getWallet(name);
  if (existing) {
    throw new ClientError(
      `Wallet "${name}" already exists (address: ${existing.address}). Use "mcpc x402 remove --name ${name}" first.`
    );
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  await saveWallet({
    name,
    address: account.address,
    privateKey,
    createdAt: new Date().toISOString(),
  });

  if (options.outputMode === 'json') {
    console.log(formatJson({ name, address: account.address }));
  } else {
    console.log(formatSuccess(`Wallet "${name}" created`));
    console.log(formatInfo(`Address: ${chalk.cyan(account.address)}`));
    console.log(formatInfo('Fund this address with USDC on Base to use x402 payments.'));
  }
}

// ---------------------------------------------------------------------------
// Command: import
// ---------------------------------------------------------------------------

async function importWallet(options: {
  name?: string;
  privateKey: string;
  outputMode: OutputMode;
}): Promise<void> {
  const name = resolveWalletName(options.name);

  const existing = await getWallet(name);
  if (existing) {
    throw new ClientError(
      `Wallet "${name}" already exists (address: ${existing.address}). Use "mcpc x402 remove --name ${name}" first.`
    );
  }

  let key = options.privateKey.trim();
  if (!key.startsWith('0x')) key = `0x${key}`;

  let account;
  try {
    account = privateKeyToAccount(key as Hex);
  } catch {
    throw new ClientError(
      'Invalid private key. Must be a 64-character hex string (with or without 0x prefix).'
    );
  }

  await saveWallet({
    name,
    address: account.address,
    privateKey: key,
    createdAt: new Date().toISOString(),
  });

  if (options.outputMode === 'json') {
    console.log(formatJson({ name, address: account.address }));
  } else {
    console.log(formatSuccess(`Wallet "${name}" imported`));
    console.log(formatInfo(`Address: ${chalk.cyan(account.address)}`));
  }
}

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------

async function listWallets(options: { outputMode: OutputMode }): Promise<void> {
  const storage = await loadWallets();
  const wallets = Object.values(storage.wallets);

  if (options.outputMode === 'json') {
    console.log(
      formatJson(wallets.map((w) => ({ name: w.name, address: w.address, createdAt: w.createdAt })))
    );
    return;
  }

  if (wallets.length === 0) {
    console.log(formatInfo('No wallets found. Create one with: mcpc x402 init'));
    return;
  }

  for (const w of wallets) {
    const isDefault = w.name === DEFAULT_WALLET_NAME ? chalk.dim(' (default)') : '';
    console.log(`  ${chalk.bold(w.name)}${isDefault}  ${chalk.cyan(w.address)}`);
  }
}

// ---------------------------------------------------------------------------
// Command: remove
// ---------------------------------------------------------------------------

async function removeWalletCmd(options: { name?: string; outputMode: OutputMode }): Promise<void> {
  const name = resolveWalletName(options.name);

  const removed = await removeWallet(name);
  if (!removed) {
    throw new ClientError(`Wallet "${name}" not found.`);
  }

  if (options.outputMode === 'json') {
    console.log(formatJson({ name, removed: true }));
  } else {
    console.log(formatSuccess(`Wallet "${name}" removed.`));
  }
}

// ---------------------------------------------------------------------------
// Command: sign
// ---------------------------------------------------------------------------

interface SignOptions {
  name?: string;
  paymentRequired: string;
  amount?: string;
  expiry?: string;
  outputMode: OutputMode;
}

async function signPayment(options: SignOptions): Promise<void> {
  const name = resolveWalletName(options.name);

  const wallet = await getWallet(name);
  if (!wallet) {
    throw new ClientError(
      `Wallet "${name}" not found. Create one with: mcpc x402 init --name ${name}`
    );
  }

  // Parse PAYMENT-REQUIRED header
  const { header, accept } = parsePaymentRequired(options.paymentRequired);

  // Resolve network
  const networkConfig = NETWORKS[accept.network];
  if (!networkConfig) {
    throw new ClientError(
      `Unknown network "${accept.network}" in PAYMENT-REQUIRED. Supported: ${Object.keys(NETWORKS).join(', ')}`
    );
  }

  // Resolve amount (CLI override or from header)
  let amountAtomicUnits: bigint;
  let amountUsd: number;
  if (options.amount) {
    amountUsd = parseFloat(options.amount);
    if (isNaN(amountUsd) || amountUsd <= 0)
      throw new ClientError('--amount must be a positive number.');
    amountAtomicUnits = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  } else {
    amountAtomicUnits = BigInt(accept.amount);
    amountUsd = Number(amountAtomicUnits) / 10 ** USDC_DECIMALS;
  }

  // Resolve expiry
  const expirySeconds = options.expiry
    ? parseInt(options.expiry, 10)
    : accept.maxTimeoutSeconds || 3600;

  // EIP-3009 domain from header extra or defaults
  const eip3009Name = accept.extra?.name ?? 'USDC';
  const eip3009Version = accept.extra?.version ?? '2';

  // Resource from header
  const resource = header.resource ?? {
    url: 'https://mcp.apify.com/mcp',
    description: 'MCP Server',
    mimeType: 'application/json',
  };

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
    resource,
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

  const payloadBase64 = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  if (options.outputMode === 'json') {
    console.log(
      formatJson({
        paymentSignature: payloadBase64,
        from: account.address,
        to: accept.payTo,
        amount: amountUsd,
        amountAtomicUnits: amountAtomicUnits.toString(),
        network: networkConfig.label,
        expiresAt: new Date(Number(validBefore) * 1000).toISOString(),
      })
    );
    return;
  }

  // Human output
  const resourceUrl = (resource.url ?? 'https://mcp.apify.com/mcp').replace(/\?.*$/, '');

  console.log(formatSuccess('Payment signed'));
  console.log(formatInfo(`Wallet    : ${chalk.bold(name)} (${account.address})`));
  console.log(formatInfo(`Network   : ${networkConfig.label}`));
  console.log(formatInfo(`To        : ${accept.payTo}`));
  console.log(
    formatInfo(
      `Amount    : $${amountUsd.toFixed(2)} (${amountAtomicUnits.toString()} atomic units)`
    )
  );
  console.log(formatInfo(`Expires   : ${new Date(Number(validBefore) * 1000).toISOString()}`));
  console.log('');
  console.log(chalk.bold('  PAYMENT-SIGNATURE header:'));
  console.log(`  ${payloadBase64}`);
  console.log('');
  console.log(chalk.bold('  MCP config snippet:'));
  console.log(
    JSON.stringify(
      {
        mcp: {
          'apify-x402': {
            type: 'remote',
            url: `${resourceUrl}?payment=x402`,
            headers: { 'PAYMENT-SIGNATURE': payloadBase64 },
          },
        },
      },
      null,
      2
    )
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')
  );
  console.log('');
}

// ---------------------------------------------------------------------------
// Top-level x402 command router
// ---------------------------------------------------------------------------

export async function handleX402Command(args: string[]): Promise<void> {
  const program = new Command();
  program.name('mcpc x402').description('x402 wallet management and payment signing');

  // Inherit global options so they parse correctly
  program.option('-j, --json', 'Output in JSON format').option('--verbose', 'Enable debug logging');

  const resolveOutputMode = (cmd: Command): OutputMode => {
    const opts = cmd.optsWithGlobals();
    return opts.json ? 'json' : 'human';
  };

  program
    .command('init')
    .description('Create a new x402 wallet')
    .option('--name <name>', `Wallet name (default: "${DEFAULT_WALLET_NAME}")`)
    .action(async (opts, cmd) => {
      await initWallet({ name: opts.name, outputMode: resolveOutputMode(cmd) });
    });

  program
    .command('import <private-key>')
    .description('Import an existing wallet from a private key')
    .option('--name <name>', `Wallet name (default: "${DEFAULT_WALLET_NAME}")`)
    .action(async (privateKey, opts, cmd) => {
      await importWallet({ name: opts.name, privateKey, outputMode: resolveOutputMode(cmd) });
    });

  program
    .command('list')
    .description('List saved wallets')
    .action(async (_opts, cmd) => {
      await listWallets({ outputMode: resolveOutputMode(cmd) });
    });

  program
    .command('remove')
    .description('Remove a saved wallet')
    .option('--name <name>', `Wallet name (default: "${DEFAULT_WALLET_NAME}")`)
    .action(async (opts, cmd) => {
      await removeWalletCmd({ name: opts.name, outputMode: resolveOutputMode(cmd) });
    });

  program
    .command('sign')
    .description('Sign a payment using a saved wallet')
    .requiredOption(
      '-r, --payment-required <base64>',
      'PAYMENT-REQUIRED header from a 402 response'
    )
    .option('--name <name>', `Wallet name (default: "${DEFAULT_WALLET_NAME}")`)
    .option('--amount <usd>', 'Override amount in USD')
    .option('--expiry <seconds>', 'Override expiry in seconds')
    .action(async (opts, cmd) => {
      await signPayment({
        name: opts.name,
        paymentRequired: opts.paymentRequired,
        amount: opts.amount,
        expiry: opts.expiry,
        outputMode: resolveOutputMode(cmd),
      });
    });

  // Show help if no subcommand
  if (args.length === 0) {
    program.outputHelp();
    return;
  }

  try {
    await program.parseAsync(['node', 'mcpc-x402', ...args]);
  } catch (error) {
    if (error instanceof ClientError) {
      console.error(formatError(error.message));
      process.exit(1);
    }
    throw error;
  }
}
