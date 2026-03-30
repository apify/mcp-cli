/**
 * Wallet management for x402 payments
 * Stores a single wallet in ~/.mcpc/wallets.json
 */

import { readFile, writeFile, rename, unlink } from 'fs/promises';
import { join } from 'path';
import type { WalletData, WalletsStorage } from './types.js';
import { getWalletsFilePath, fileExists, ensureDir, getMcpcHome } from './utils.js';
import { withFileLock } from './file-lock.js';
import { ClientError } from './errors.js';
import {
  isKeychainAvailable,
  readKeychainX402Wallet,
  storeKeychainX402Wallet,
  removeKeychainX402Wallet,
} from './auth/keychain.js';

const WALLETS_DEFAULT_CONTENT = JSON.stringify({ version: 1 }, null, 2);

// ---------------------------------------------------------------------------
// Internal read/write (called under file lock)
// ---------------------------------------------------------------------------

async function loadStorageInternal(): Promise<WalletsStorage> {
  const filePath = getWalletsFilePath();

  if (!(await fileExists(filePath))) {
    return { version: 1 };
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const storage = JSON.parse(content) as WalletsStorage;
    if (!storage.version) {
      return { version: 1 };
    }
    return storage;
  } catch {
    return { version: 1 };
  }
}

async function saveStorageInternal(storage: WalletsStorage): Promise<void> {
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
    throw new ClientError(`Failed to save wallet: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API (all operations hold file lock)
// ---------------------------------------------------------------------------

export async function getWallet(): Promise<WalletData | undefined> {
  // Try OS keychain first for secure storage
  if (await isKeychainAvailable()) {
    const keychainWallet = await readKeychainX402Wallet<WalletData>();
    if (keychainWallet) {
      return keychainWallet;
    }
  }

  // Fallback to wallets.json (also used for backward compatibility)
  return withFileLock(
    getWalletsFilePath(),
    async () => {
      const storage = await loadStorageInternal();
      return storage.wallet;
    },
    WALLETS_DEFAULT_CONTENT
  );
}

export async function saveWallet(wallet: WalletData): Promise<void> {
  const useKeychain = await isKeychainAvailable();

  if (useKeychain) {
    await storeKeychainX402Wallet(wallet);
  }

  // Update or clean up the fallback JSON file
  const filePath = getWalletsFilePath();
  if (!useKeychain || (await fileExists(filePath))) {
    await withFileLock(
      filePath,
      async () => {
        const storage = await loadStorageInternal();

        if (!useKeychain) {
          // Store in JSON if keychain is unavailable
          storage.wallet = wallet;
        } else if (storage.wallet) {
          // If using keychain, remove the wallet from JSON to avoid split-brain
          delete storage.wallet;
        }

        await saveStorageInternal(storage);
      },
      WALLETS_DEFAULT_CONTENT
    );
  }
}

export async function removeWallet(): Promise<boolean> {
  let keychainRemoved = false;
  if (await isKeychainAvailable()) {
    keychainRemoved = await removeKeychainX402Wallet();
  }

  const filePath = getWalletsFilePath();
  let jsonRemoved = false;

  if (await fileExists(filePath)) {
    jsonRemoved = await withFileLock(
      filePath,
      async () => {
        const storage = await loadStorageInternal();
        if (!storage.wallet) return false;

        delete storage.wallet;
        await saveStorageInternal(storage);
        return true;
      },
      WALLETS_DEFAULT_CONTENT
    );
  }

  return keychainRemoved || jsonRemoved;
}
