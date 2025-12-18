/**
 * MCP package resolution
 * Discovers and resolves local MCP server packages (node_modules, npm global, Bun global)
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import type { TransportConfig } from './types.js';
import { ClientError } from './errors.js';
import { createLogger } from './logger.js';

const logger = createLogger('package-resolver');

/**
 * Package.json structure relevant for MCP server discovery
 */
interface PackageJson {
  name?: string;
  version?: string;
  bin?: string | Record<string, string>;
  main?: string;
  mcpServer?: string; // Optional MCP-specific entry point
}

/**
 * Resolved package information
 */
export interface ResolvedPackage {
  name: string;
  version?: string;
  path: string; // Absolute path to package directory
  executable: string; // Path to executable file
  packageJson: PackageJson;
}

/**
 * Resolve a package name to its location and executable
 *
 * Searches in order:
 * 1. ./node_modules (local dependencies)
 * 2. Global npm packages (npm root -g)
 * 3. Global Bun packages (if Bun is available)
 *
 * @param packageName - Package name (e.g., "@modelcontextprotocol/server-filesystem")
 * @returns Resolved package information
 * @throws ClientError if package not found
 */
export function resolvePackage(packageName: string): ResolvedPackage {
  logger.debug(`Resolving package: ${packageName}`);

  // Try local node_modules first
  const localPath = resolveLocalPackage(packageName);
  if (localPath) {
    logger.debug(`Found package in local node_modules: ${localPath}`);
    return loadPackageInfo(localPath, packageName);
  }

  // Try global npm packages
  const globalNpmPath = resolveGlobalNpmPackage(packageName);
  if (globalNpmPath) {
    logger.debug(`Found package in global npm: ${globalNpmPath}`);
    return loadPackageInfo(globalNpmPath, packageName);
  }

  // Try global Bun packages
  const globalBunPath = resolveGlobalBunPackage(packageName);
  if (globalBunPath) {
    logger.debug(`Found package in global Bun: ${globalBunPath}`);
    return loadPackageInfo(globalBunPath, packageName);
  }

  // Package not found
  throw new ClientError(
    `Package not found: ${packageName}\n` +
    `Searched in:\n` +
    `  - Local node_modules\n` +
    `  - Global npm packages\n` +
    `  - Global Bun packages\n\n` +
    `Install the package with:\n` +
    `  npm install ${packageName}  # Local\n` +
    `  npm install -g ${packageName}  # Global`
  );
}

/**
 * Resolve package in local node_modules
 */
function resolveLocalPackage(packageName: string): string | null {
  try {
    // Start from current working directory
    const cwd = process.cwd();
    const packagePath = join(cwd, 'node_modules', packageName);

    if (existsSync(packagePath)) {
      const packageJsonPath = join(packagePath, 'package.json');
      if (existsSync(packageJsonPath)) {
        return packagePath;
      }
    }

    return null;
  } catch (error) {
    logger.debug(`Error resolving local package:`, error);
    return null;
  }
}

/**
 * Resolve package in global npm packages
 */
function resolveGlobalNpmPackage(packageName: string): string | null {
  try {
    // Get global npm root
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const packagePath = join(globalRoot, packageName);

    if (existsSync(packagePath)) {
      const packageJsonPath = join(packagePath, 'package.json');
      if (existsSync(packageJsonPath)) {
        return packagePath;
      }
    }

    return null;
  } catch (error) {
    logger.debug(`Error resolving global npm package:`, error);
    return null;
  }
}

/**
 * Resolve package in global Bun packages
 */
function resolveGlobalBunPackage(packageName: string): string | null {
  try {
    // Check if Bun is available
    execSync('which bun', { encoding: 'utf-8', stdio: 'pipe' });

    // Get Bun global directory
    const bunGlobalRoot = execSync('bun pm -g bin', { encoding: 'utf-8' }).trim();
    const bunGlobalModules = join(dirname(bunGlobalRoot), 'node_modules');
    const packagePath = join(bunGlobalModules, packageName);

    if (existsSync(packagePath)) {
      const packageJsonPath = join(packagePath, 'package.json');
      if (existsSync(packageJsonPath)) {
        return packagePath;
      }
    }

    return null;
  } catch (error) {
    // Bun not available or package not found
    logger.debug(`Error resolving global Bun package:`, error);
    return null;
  }
}

/**
 * Load package information and determine executable
 */
function loadPackageInfo(packagePath: string, packageName: string): ResolvedPackage {
  const packageJsonPath = join(packagePath, 'package.json');

  try {
    const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent) as PackageJson;

    // Determine executable path
    const executable = resolvePackageExecutable(packagePath, packageJson);

    const result: ResolvedPackage = {
      name: packageJson.name || packageName,
      path: packagePath,
      executable,
      packageJson,
    };

    if (packageJson.version !== undefined) {
      result.version = packageJson.version;
    }

    return result;
  } catch (error) {
    throw new ClientError(
      `Failed to load package.json for ${packageName}: ${(error as Error).message}`
    );
  }
}

/**
 * Resolve the executable entry point for a package
 *
 * Priority:
 * 1. mcpServer field (MCP-specific)
 * 2. bin field (if single string or matches package name)
 * 3. main field (fallback)
 */
function resolvePackageExecutable(packagePath: string, packageJson: PackageJson): string {
  // 1. Check mcpServer field (MCP-specific)
  if (packageJson.mcpServer) {
    const mcpServerPath = resolve(packagePath, packageJson.mcpServer);
    if (existsSync(mcpServerPath)) {
      logger.debug(`Using mcpServer entry point: ${packageJson.mcpServer}`);
      return mcpServerPath;
    }
    logger.warn(`mcpServer field points to non-existent file: ${packageJson.mcpServer}`);
  }

  // 2. Check bin field
  if (packageJson.bin) {
    if (typeof packageJson.bin === 'string') {
      // Single binary
      const binPath = resolve(packagePath, packageJson.bin);
      if (existsSync(binPath)) {
        logger.debug(`Using bin entry point: ${packageJson.bin}`);
        return binPath;
      }
    } else {
      // Multiple binaries - try to find one matching package name
      let shortName: string | undefined;
      if (packageJson.name) {
        const packageNameParts = packageJson.name.split('/');
        shortName = packageNameParts[packageNameParts.length - 1];
      }

      // Try exact package name
      if (packageJson.name) {
        const binEntry = packageJson.bin[packageJson.name];
        if (binEntry) {
          const binPath = resolve(packagePath, binEntry);
          if (existsSync(binPath)) {
            logger.debug(`Using bin entry point (by package name): ${binEntry}`);
            return binPath;
          }
        }
      }

      // Try short name (e.g., "server-filesystem" from "@modelcontextprotocol/server-filesystem")
      if (shortName) {
        const binEntry = packageJson.bin[shortName];
        if (binEntry) {
          const binPath = resolve(packagePath, binEntry);
          if (existsSync(binPath)) {
            logger.debug(`Using bin entry point (by short name): ${binEntry}`);
            return binPath;
          }
        }
      }

      // Use first binary as fallback
      const firstBin = Object.values(packageJson.bin)[0];
      if (firstBin) {
        const binPath = resolve(packagePath, firstBin);
        if (existsSync(binPath)) {
          logger.debug(`Using first bin entry point: ${firstBin}`);
          return binPath;
        }
      }
    }
  }

  // 3. Check main field (fallback)
  if (packageJson.main) {
    const mainPath = resolve(packagePath, packageJson.main);
    if (existsSync(mainPath)) {
      logger.debug(`Using main entry point: ${packageJson.main}`);
      return mainPath;
    }
  }

  // 4. Try common defaults
  const defaults = ['index.js', 'index.mjs', 'dist/index.js', 'build/index.js'];
  for (const defaultPath of defaults) {
    const fullPath = resolve(packagePath, defaultPath);
    if (existsSync(fullPath)) {
      logger.debug(`Using default entry point: ${defaultPath}`);
      return fullPath;
    }
  }

  throw new ClientError(
    `Could not determine executable for package: ${packageJson.name}\n` +
    `Package must have one of:\n` +
    `  - "mcpServer" field in package.json\n` +
    `  - "bin" field in package.json\n` +
    `  - "main" field in package.json\n` +
    `  - Common default file (index.js, index.mjs, etc.)`
  );
}

/**
 * Create transport configuration for a resolved package
 *
 * @param pkg - Resolved package information
 * @param args - Optional additional arguments
 * @param env - Optional environment variables
 * @returns Transport configuration for stdio
 */
export function createPackageTransport(
  pkg: ResolvedPackage,
  args?: string[],
  env?: Record<string, string>
): TransportConfig {
  logger.debug(`Creating transport for package: ${pkg.name}`);

  // Determine the command to run
  // For Node.js packages, use 'node' as the command
  const command = 'node';
  const commandArgs = [pkg.executable, ...(args || [])];

  const transportConfig: TransportConfig = {
    type: 'stdio',
    command,
    args: commandArgs,
  };

  if (env) {
    transportConfig.env = env;
  }

  logger.debug(`Transport config:`, transportConfig);

  return transportConfig;
}
