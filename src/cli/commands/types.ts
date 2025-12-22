/**
 * Shared types for CLI command handlers
 */

import type { OutputMode } from '../../lib/index.js';

/**
 * Standard options passed to command handlers
 */
export interface CommandOptions {
  outputMode: OutputMode;
  config?: string;
  headers?: string[];
  timeout?: number;
  verbose?: boolean;
}
