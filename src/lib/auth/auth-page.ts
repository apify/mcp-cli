/**
 * HTML rendering for the local OAuth callback pages.
 * Shown briefly in the user's browser after the OAuth provider redirects back
 * to mcpc's local callback server.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../logger.js';

const logger = createLogger('auth-page');

const GITHUB_URL = 'https://github.com/apify/mcpc';

/**
 * Escape HTML special characters to prevent XSS.
 * The pages render error messages from query parameters (error_description)
 * and server URLs directly into HTML, so they must be escaped.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Load the mcpc logo SVG from disk once. The file is shipped at the package
 * root and is reachable from both src/ (dev) and dist/ (published) at the
 * same relative path.
 */
let cachedLogo: string | null | undefined;
function loadLogoSvg(): string | null {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const logoPath = resolve(here, '..', '..', '..', 'client-logo.svg');
    cachedLogo = readFileSync(logoPath, 'utf8');
  } catch (err) {
    logger.debug(`Could not load logo: ${(err as Error).message}`);
    cachedLogo = null;
  }
  return cachedLogo;
}

export interface AuthPageOptions {
  success: boolean;
  title: string;
  message: string;
  detail?: string;
}

/**
 * Render the HTML page shown after the OAuth callback. Self-contained
 * (inline CSS and SVG) so it works without any network access.
 */
export function renderAuthPage(options: AuthPageOptions): string {
  const { success, title, message, detail } = options;
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeDetail = detail ? escapeHtml(detail) : '';
  const emoji = success ? '✅' : '❌';

  const logoSvg = loadLogoSvg();
  const logoBlock = logoSvg ? `<div class="logo">${logoSvg}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} · mcpc</title>
<style>
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    background: #ffffff;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
  }
  main {
    max-width: 520px;
    width: 100%;
    text-align: center;
  }
  .logo { width: 72px; height: 72px; margin: 0 auto 20px; }
  .logo svg { width: 100%; height: 100%; display: block; }
  .emoji { font-size: 32px; line-height: 1; margin-bottom: 12px; }
  h1 {
    margin: 0 0 12px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.2px;
  }
  p { margin: 0 0 8px; font-size: 15px; }
  .detail {
    margin: 16px auto 0;
    padding: 10px 12px;
    max-width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    color: #444;
    background: #f5f5f5;
    border-radius: 6px;
    word-break: break-word;
    text-align: left;
  }
  .hint { color: #666; margin-top: 14px; font-size: 14px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .footer {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid #eee;
    font-size: 13px;
    color: #666;
  }
  .footer a { color: #1a1a1a; text-decoration: none; border-bottom: 1px solid #ccc; }
  .footer a:hover { border-bottom-color: #1a1a1a; }
  .footer code { color: #1a1a1a; font-weight: 600; }
</style>
</head>
<body>
  <main>
    ${logoBlock}
    <div class="emoji" aria-hidden="true">${emoji}</div>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    ${safeDetail ? `<p class="detail">${safeDetail}</p>` : ''}
    <p class="hint">You can close this window and return to your terminal.</p>
    <div class="footer">
      <code>mcpc</code> — universal command-line client for the Model Context Protocol<br>
      <a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">${GITHUB_URL}</a>
    </div>
  </main>
</body>
</html>`;
}
