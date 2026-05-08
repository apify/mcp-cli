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
 * Render the HTML page shown after the OAuth callback. The page is intentionally
 * self-contained (inline CSS and SVG) so it works without any network access.
 */
export function renderAuthPage(options: AuthPageOptions): string {
  const { success, title, message, detail } = options;
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeDetail = detail ? escapeHtml(detail) : '';

  const accent = success ? '#22c55e' : '#ef4444';
  const accentSoft = success ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
  const icon = success
    ? `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"/></svg>`
    : `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;

  const logoSvg = loadLogoSvg();
  const logoBlock = logoSvg
    ? `<div class="logo">${logoSvg}</div>`
    : `<div class="logo logo-fallback">mcpc</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} · mcpc</title>
<style>
  :root {
    color-scheme: dark;
    --bg-0: #0b1020;
    --bg-1: #131a33;
    --fg: #e6e8ee;
    --fg-dim: #9aa3b8;
    --card: rgba(22, 27, 46, 0.85);
    --border: rgba(255, 255, 255, 0.08);
    --accent: ${accent};
    --accent-soft: ${accentSoft};
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--fg);
    background:
      radial-gradient(1200px 800px at 80% -10%, rgba(124, 92, 255, 0.25), transparent 60%),
      radial-gradient(900px 700px at -10% 110%, rgba(34, 197, 94, 0.18), transparent 60%),
      linear-gradient(180deg, var(--bg-0), var(--bg-1));
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%;
    max-width: 480px;
    background: var(--card);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 36px 32px 28px;
    text-align: center;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
  }
  .logo {
    display: inline-flex;
    width: 72px;
    height: 72px;
    margin-bottom: 18px;
  }
  .logo svg { width: 100%; height: 100%; }
  .logo-fallback {
    align-items: center;
    justify-content: center;
    border-radius: 18px;
    background: linear-gradient(135deg, #7c5cff, #22c55e);
    color: #0b1020;
    font-weight: 800;
    font-size: 22px;
    letter-spacing: 1px;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2px;
    margin-bottom: 14px;
  }
  .status-pill svg { display: block; }
  h1 {
    margin: 0 0 10px;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.2px;
  }
  p.message {
    margin: 0 0 8px;
    color: var(--fg);
    font-size: 15px;
    line-height: 1.55;
  }
  p.detail {
    margin: 12px 0 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    color: var(--fg-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    word-break: break-word;
    text-align: left;
  }
  .hint {
    margin-top: 22px;
    color: var(--fg-dim);
    font-size: 13px;
  }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 24px 0 18px;
  }
  .brand {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    color: var(--fg-dim);
    font-size: 13px;
    line-height: 1.5;
  }
  .brand strong { color: var(--fg); font-weight: 600; }
  .brand a {
    color: var(--fg);
    text-decoration: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    transition: border-color 0.15s ease;
  }
  .brand a:hover { border-color: var(--fg); }
  .gh {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border);
    color: var(--fg);
    text-decoration: none;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .gh:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }
  .gh svg { display: block; }
</style>
</head>
<body>
  <main class="card" role="main">
    ${logoBlock}
    <div class="status-pill" aria-hidden="true">${icon}<span>${success ? 'Success' : 'Failed'}</span></div>
    <h1>${safeTitle}</h1>
    <p class="message">${safeMessage}</p>
    ${safeDetail ? `<p class="detail">${safeDetail}</p>` : ''}
    <p class="hint">You can close this window and return to your terminal.</p>
    <div class="divider"></div>
    <div class="brand">
      <span><strong>mcpc</strong> — universal command-line client for the Model Context Protocol</span>
      <a class="gh" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        <span>GitHub</span>
      </a>
    </div>
  </main>
</body>
</html>`;
}
