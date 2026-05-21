/**
 * Unit tests for the on-read migration that consolidates the legacy
 * `{ x402: boolean, x402Scheme?: 'auto'|'upto'|'exact' }` shape into the
 * current `{ x402?: 'auto'|'upto'|'exact' }` shape.
 *
 * The migration runs on every session load, so it must be idempotent on
 * already-migrated records and defensive against bogus values that snuck in
 * via hand-edited sessions.json files.
 */
import { describe, expect, it } from 'vitest';

import { normaliseLegacyX402 } from '../../../src/lib/sessions.js';
import type { SessionData, X402SchemePreference } from '../../../src/lib/types.js';

function baseSession(): SessionData & { x402Scheme?: X402SchemePreference } {
  return {
    name: '@test',
    server: { url: 'https://example.test' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('normaliseLegacyX402()', () => {
  it('migrates legacy `x402: true` (no scheme) to `x402: "auto"`', () => {
    const session = { ...baseSession(), x402: true as unknown as X402SchemePreference };
    normaliseLegacyX402(session);
    expect(session.x402).toBe('auto');
    expect(session.x402Scheme).toBeUndefined();
  });

  it('migrates legacy `x402: true` + `x402Scheme: "exact"` to `x402: "exact"`', () => {
    const session = {
      ...baseSession(),
      x402: true as unknown as X402SchemePreference,
      x402Scheme: 'exact' as const,
    };
    normaliseLegacyX402(session);
    expect(session.x402).toBe('exact');
    expect(session.x402Scheme).toBeUndefined();
  });

  it('clears legacy `x402: false` regardless of `x402Scheme`', () => {
    const session = {
      ...baseSession(),
      x402: false as unknown as X402SchemePreference,
      x402Scheme: 'upto' as const,
    };
    normaliseLegacyX402(session);
    expect(session.x402).toBeUndefined();
    expect(session.x402Scheme).toBeUndefined();
  });

  it('is idempotent on already-migrated `x402: "upto"`', () => {
    const session = { ...baseSession(), x402: 'upto' as const };
    normaliseLegacyX402(session);
    expect(session.x402).toBe('upto');
    expect(session.x402Scheme).toBeUndefined();
  });

  it('drops invalid string values defensively (hand-edited sessions.json)', () => {
    const session = { ...baseSession(), x402: 'bogus' as unknown as X402SchemePreference };
    normaliseLegacyX402(session);
    expect(session.x402).toBeUndefined();
  });

  it('leaves sessions without x402 untouched', () => {
    const session = baseSession();
    normaliseLegacyX402(session);
    expect(session.x402).toBeUndefined();
    expect(session.x402Scheme).toBeUndefined();
  });

  it('strips `x402Scheme` even when `x402` is unset (clean stale sidecar)', () => {
    const session = { ...baseSession(), x402Scheme: 'exact' as const };
    normaliseLegacyX402(session);
    expect(session.x402).toBeUndefined();
    expect(session.x402Scheme).toBeUndefined();
  });
});
