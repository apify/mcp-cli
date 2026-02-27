/**
 * x402 wallet management and payment signing commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
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
import { signPayment, parsePaymentRequired } from '../../lib/x402/signer.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WALLET_NAME = 'default';
const USDC_DECIMALS = 6;

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

async function signPaymentCommand(options: SignOptions): Promise<void> {
  const name = resolveWalletName(options.name);

  const wallet = await getWallet(name);
  if (!wallet) {
    throw new ClientError(
      `Wallet "${name}" not found. Create one with: mcpc x402 init --name ${name}`
    );
  }

  // Parse PAYMENT-REQUIRED header
  const { header, accept } = parsePaymentRequired(options.paymentRequired);

  // Resolve overrides
  let amountOverride: bigint | undefined;
  if (options.amount) {
    const amountUsd = parseFloat(options.amount);
    if (isNaN(amountUsd) || amountUsd <= 0)
      throw new ClientError('--amount must be a positive number.');
    amountOverride = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  }

  const expiryOverride = options.expiry ? parseInt(options.expiry, 10) : undefined;

  // Sign using shared signer
  const result = await signPayment({
    wallet: { privateKey: wallet.privateKey, address: wallet.address },
    accept,
    resource: header.resource,
    ...(amountOverride !== undefined && { amountOverride }),
    ...(expiryOverride !== undefined && { expiryOverride }),
  });

  if (options.outputMode === 'json') {
    console.log(
      formatJson({
        paymentSignature: result.paymentSignatureBase64,
        from: result.from,
        to: result.to,
        amount: result.amountUsd,
        amountAtomicUnits: result.amountAtomicUnits.toString(),
        network: result.networkLabel,
        expiresAt: result.expiresAt.toISOString(),
      })
    );
    return;
  }

  // Human output
  const resourceUrl = (header.resource?.url ?? 'https://mcp.apify.com/mcp').replace(/\?.*$/, '');

  console.log(formatSuccess('Payment signed'));
  console.log(formatInfo(`Wallet    : ${chalk.bold(name)} (${result.from})`));
  console.log(formatInfo(`Network   : ${result.networkLabel}`));
  console.log(formatInfo(`To        : ${result.to}`));
  console.log(
    formatInfo(
      `Amount    : $${result.amountUsd.toFixed(2)} (${result.amountAtomicUnits.toString()} atomic units)`
    )
  );
  console.log(formatInfo(`Expires   : ${result.expiresAt.toISOString()}`));
  console.log('');
  console.log(chalk.bold('  PAYMENT-SIGNATURE header:'));
  console.log(`  ${result.paymentSignatureBase64}`);
  console.log('');
  console.log(chalk.bold('  MCP config snippet:'));
  console.log(
    JSON.stringify(
      {
        mcp: {
          'apify-x402': {
            type: 'remote',
            url: `${resourceUrl}?payment=x402`,
            headers: { 'PAYMENT-SIGNATURE': result.paymentSignatureBase64 },
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
      await signPaymentCommand({
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
