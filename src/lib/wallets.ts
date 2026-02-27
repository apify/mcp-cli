/**
 * Wallet management for x402 payments
 * Stores wallet metadata and private keys in ~/.mcpc/wallets.json
 */

import { readFile, writeFile, rename, unlink } from 'fs/promises';
import { join } from 'path';
import type { WalletData, WalletsStorage } from './types.js';
import { getWalletsFilePath, fileExists, ensureDir, getMcpcHome } from './utils.js';
import { withFileLock } from './file-lock.js';
import { ClientError } from './errors.js';

const DEFAULT_WALLET_NAME = 'default';
const WALLETS_DEFAULT_CONTENT = JSON.stringify({ wallets: {} }, null, 2);

/**
 * Resolve wallet name, defaulting to "default"
 */
export function resolveWalletName(name?: string): string {
  return name || DEFAULT_WALLET_NAME;
}

// ---------------------------------------------------------------------------
// Internal read/write (called under file lock)
// ---------------------------------------------------------------------------

async function loadWalletsInternal(): Promise<WalletsStorage> {
  const filePath = getWalletsFilePath();

  if (!(await fileExists(filePath))) {
    return { wallets: {} };
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const storage = JSON.parse(content) as WalletsStorage;
    if (!storage.wallets || typeof storage.wallets !== 'object') {
      return { wallets: {} };
    }
    return storage;
  } catch {
    return { wallets: {} };
  }
}

async function saveWalletsInternal(storage: WalletsStorage): Promise<void> {
  const filePath = getWalletsFilePath();
  await ensureDir(getMcpcHome());

  const tempFile = join(getMcpcHome(), `.wallets-${Date.now()}-${process.pid}.tmp`);
  try {
    await writeFile(tempFile, JSON.stringify(storage, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await rename(tempFile, filePath);
  } catch (error) {
    try {
      await unlink(tempFile);
    } catch {
      /* ignore */
    }
    throw new ClientError(`Failed to save wallets: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API (all operations hold file lock)
// ---------------------------------------------------------------------------

export async function loadWallets(): Promise<WalletsStorage> {
  return withFileLock(getWalletsFilePath(), loadWalletsInternal, WALLETS_DEFAULT_CONTENT);
}

export async function getWallet(name: string): Promise<WalletData | undefined> {
  const storage = await loadWallets();
  return storage.wallets[name];
}

export async function saveWallet(wallet: WalletData): Promise<void> {
  const filePath = getWalletsFilePath();
  await withFileLock(
    filePath,
    async () => {
      const storage = await loadWalletsInternal();
      storage.wallets[wallet.name] = wallet;
      await saveWalletsInternal(storage);
    },
    WALLETS_DEFAULT_CONTENT
  );
}

export async function removeWallet(name: string): Promise<boolean> {
  const filePath = getWalletsFilePath();
  return withFileLock(
    filePath,
    async () => {
      const storage = await loadWalletsInternal();
      if (!storage.wallets[name]) return false;
      delete storage.wallets[name];
      await saveWalletsInternal(storage);
      return true;
    },
    WALLETS_DEFAULT_CONTENT
  );
}
