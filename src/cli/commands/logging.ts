/**
 * Logging command handlers
 */

import type { OutputMode, LoggingLevel } from '../../lib/types.js';
import { formatOutput, formatSuccess, logTarget } from '../output.js';
import { ClientError } from '../../lib/errors.js';

const VALID_LOG_LEVELS: LoggingLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

/**
 * Set server logging level
 */
export async function setLogLevel(
  target: string,
  level: string,
  options: { outputMode: OutputMode }
): Promise<void> {
  // Validate log level
  if (!VALID_LOG_LEVELS.includes(level as LoggingLevel)) {
    throw new ClientError(
      `Invalid log level: ${level}. Must be one of: ${VALID_LOG_LEVELS.join(', ')}`
    );
  }

  // TODO: Connect to MCP server using target and send logging/setLevel request

  logTarget(target, options.outputMode);
  if (options.outputMode === 'human') {
    console.log(formatSuccess(`Server log level set to: ${level}`));
  } else {
    console.log(
      formatOutput(
        {
          level,
          success: true,
        },
        'json'
      )
    );
  }
}
