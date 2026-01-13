/**
 * Unit tests for session expiration detection
 */

import { isSessionExpiredError } from '../../../src/lib/utils';

describe('isSessionExpiredError', () => {
  describe('should detect session expiration', () => {
    it('detects "session not found" message', () => {
      expect(isSessionExpiredError('session not found')).toBe(true);
      expect(isSessionExpiredError('Session not found')).toBe(true);
      expect(isSessionExpiredError('SESSION NOT FOUND')).toBe(true);
    });

    it('detects "Session ID xyz not found" message (the bug fix case)', () => {
      // This is the exact error format from the bug report
      expect(
        isSessionExpiredError(
          'Bad Request: Session ID 334c4cc0-ea1a-49f5-89a6-13bbe29b17d6 not found'
        )
      ).toBe(true);
      expect(
        isSessionExpiredError('Session ID abc123 not found')
      ).toBe(true);
      expect(
        isSessionExpiredError('session id test-session not found')
      ).toBe(true);
    });

    it('detects "session xyz not found" message (without "id" keyword)', () => {
      expect(isSessionExpiredError('session abc123 not found')).toBe(true);
      expect(isSessionExpiredError('Session test-session not found')).toBe(true);
    });

    it('detects "session expired" message', () => {
      expect(isSessionExpiredError('session expired')).toBe(true);
      expect(isSessionExpiredError('Your session expired')).toBe(true);
      expect(isSessionExpiredError('Session Expired')).toBe(true);
    });

    it('detects "invalid session" message', () => {
      expect(isSessionExpiredError('invalid session')).toBe(true);
      expect(isSessionExpiredError('Invalid session ID')).toBe(true);
      expect(isSessionExpiredError('Error: invalid session')).toBe(true);
    });

    it('detects "session is no longer valid" message', () => {
      expect(isSessionExpiredError('session is no longer valid')).toBe(true);
      expect(isSessionExpiredError('Your session is no longer valid')).toBe(true);
    });

    it('detects HTTP 404 errors (non-tool related)', () => {
      expect(isSessionExpiredError('404 Not Found')).toBe(true);
      expect(isSessionExpiredError('HTTP 404')).toBe(true);
      expect(isSessionExpiredError('Error: 404')).toBe(true);
    });
  });

  describe('should NOT detect as session expiration', () => {
    it('ignores "tool not found" errors (404 with tool)', () => {
      // Tool-related 404s should NOT be treated as session expiration
      expect(isSessionExpiredError('404 tool not found')).toBe(false);
      expect(isSessionExpiredError('Tool xyz not found (404)')).toBe(false);
      expect(isSessionExpiredError('Error 404: tool does not exist')).toBe(false);
    });

    it('ignores generic errors', () => {
      expect(isSessionExpiredError('Connection refused')).toBe(false);
      expect(isSessionExpiredError('Network error')).toBe(false);
      expect(isSessionExpiredError('Timeout')).toBe(false);
      expect(isSessionExpiredError('Internal server error')).toBe(false);
    });

    it('ignores unrelated "not found" errors', () => {
      expect(isSessionExpiredError('resource not found')).toBe(false);
      expect(isSessionExpiredError('file not found')).toBe(false);
      expect(isSessionExpiredError('user not found')).toBe(false);
    });

    it('ignores empty or whitespace messages', () => {
      expect(isSessionExpiredError('')).toBe(false);
      expect(isSessionExpiredError('   ')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles messages with leading/trailing whitespace', () => {
      // Leading/trailing whitespace doesn't affect matching
      expect(isSessionExpiredError('  session not found  ')).toBe(true);
      expect(isSessionExpiredError('  session expired  ')).toBe(true);
    });

    it('handles messages embedded in longer error strings', () => {
      expect(
        isSessionExpiredError(
          'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Session ID 334c4cc0-ea1a-49f5-89a6-13bbe29b17d6 not found"},"id":null}'
        )
      ).toBe(true);
    });

    it('is case-insensitive for all patterns', () => {
      expect(isSessionExpiredError('SESSION EXPIRED')).toBe(true);
      expect(isSessionExpiredError('INVALID SESSION')).toBe(true);
      expect(isSessionExpiredError('SESSION IS NO LONGER VALID')).toBe(true);
      expect(isSessionExpiredError('SESSION ID ABC NOT FOUND')).toBe(true);
    });
  });
});
