/**
 * In-memory cache for MCP bridge process
 * Caches tools, resources, prompts lists to improve performance
 */

import { createLogger } from '../lib/index.js';

const logger = createLogger('cache');

/**
 * Cache types that can be invalidated by server notifications
 */
export type CacheType = 'tools' | 'resources' | 'prompts' | 'resourceTemplates';

/**
 * Cached item with timestamp
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Cache configuration
 */
interface CacheConfig {
  /**
   * Time-to-live in milliseconds (default: 5 minutes)
   */
  ttl: number;
}

/**
 * Cache manager for MCP data
 * Stores lists of tools, resources, prompts with TTL-based expiration
 */
export class CacheManager {
  private cache: Map<CacheType, CacheEntry<unknown>> = new Map();
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      ttl: config.ttl ?? 5 * 60 * 1000, // Default: 5 minutes
    };
  }

  /**
   * Get cached data if available and not expired
   */
  get<T>(type: CacheType): T | null {
    const entry = this.cache.get(type);
    if (!entry) {
      logger.debug(`Cache miss: ${type}`);
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.config.ttl) {
      logger.debug(`Cache expired: ${type} (age: ${Math.round(age / 1000)}s)`);
      this.cache.delete(type);
      return null;
    }

    logger.debug(`Cache hit: ${type} (age: ${Math.round(age / 1000)}s)`);
    return entry.data as T;
  }

  /**
   * Store data in cache
   */
  set<T>(type: CacheType, data: T): void {
    this.cache.set(type, {
      data,
      timestamp: Date.now(),
    });
    logger.debug(`Cache set: ${type}`);
  }

  /**
   * Invalidate specific cache type
   */
  invalidate(type: CacheType): void {
    const existed = this.cache.delete(type);
    if (existed) {
      logger.debug(`Cache invalidated: ${type}`);
    }
  }

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    const count = this.cache.size;
    this.cache.clear();
    logger.debug(`All caches invalidated (${count} entries)`);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    entries: Array<{ type: CacheType; age: number }>;
  } {
    const entries: Array<{ type: CacheType; age: number }> = [];
    const now = Date.now();

    for (const [type, entry] of this.cache.entries()) {
      entries.push({
        type,
        age: Math.round((now - entry.timestamp) / 1000),
      });
    }

    return {
      size: this.cache.size,
      entries,
    };
  }
}
