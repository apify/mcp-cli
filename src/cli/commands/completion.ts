/**
 * Shell completion for mcpc
 *
 * Implements the two-piece pattern used by kubectl/gh/cobra:
 *   1. `mcpc completion <shell>` prints a thin shell script that registers a
 *      completion function for the user's shell.
 *   2. `mcpc __complete -- <words...> <partial>` is a hidden subcommand that
 *      the shell script calls on every TAB. It returns suggestions on stdout,
 *      one per line, with an optional `:<bitflag>` directive line at the end.
 *
 * The shell script is thin and stable — all completion logic lives here in
 * TypeScript, so upgrading mcpc automatically picks up new commands without
 * regenerating any files.
 *
 * Per-command flag suggestions are extracted at runtime from Commander's own
 * tree (`createTopLevelProgram` + `registerSessionCommands` in ../index.ts),
 * so there is no static duplication that could drift. The cycle
 * `index.ts → commands/completion.ts → index.ts` is safe under ESM because
 * the factories are only *called* inside functions, never at module load.
 */

import type { Command } from 'commander';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';
import { theme } from '../output.js';
import { loadSessions } from '../../lib/sessions.js';
import { listAuthProfiles } from '../../lib/auth/profiles.js';
import { readCompletionCache, type CompletionKind } from '../../lib/completion-cache.js';
import { ClientError } from '../../lib/index.js';
import { KNOWN_COMMANDS, KNOWN_SESSION_COMMANDS } from '../parser.js';
import { createTopLevelProgram, createSessionProgram, registerSessionCommands } from '../index.js';

/** Supported shells for completion script generation. */
export const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type Shell = (typeof SUPPORTED_SHELLS)[number];

/**
 * Directive bitflags returned on the last line of `__complete` output.
 * Mirrors the cobra/kubectl convention so existing shell snippets can be
 * adapted with minimal changes.
 */
export const DIRECTIVE = {
  /** Default — add a trailing space after the match, allow file fallback. */
  DEFAULT: 0,
  /** Do not add a trailing space (e.g. partial prefix completion). */
  NO_SPACE: 1,
  /** Do not fall back to filename completion when there are no candidates. */
  NO_FILES: 2,
} as const;

/** Snapshot of per-command flag/option metadata derived from Commander's tree. */
interface CommandFlagMetadata {
  /** Flags valid on the top-level program (`mcpc --foo`). */
  global: readonly string[];
  /** Flags per top-level subcommand: `{ connect: ['--header', '--stdio', ...], ... }`. */
  topLevel: ReadonlyMap<string, readonly string[]>;
  /** Flags per session subcommand. */
  session: ReadonlyMap<string, readonly string[]>;
  /** Flag tokens that take a value (used for skip-ahead during context analysis). */
  flagsWithValues: ReadonlySet<string>;
}

let cachedMetadata: CommandFlagMetadata | undefined;

/**
 * Walk a Commander option-flags spec (e.g. `'-H, --header <header>'`) and
 * return just the flag tokens (`['-H', '--header']`). Argument placeholders
 * (`<header>`, `[name]`) are stripped.
 */
function parseFlagTokens(spec: string): string[] {
  return spec
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((tok) => tok.startsWith('-'));
}

/**
 * Commander tracks the help option outside its public `options` array and
 * provides no public getter. Every command in this codebase keeps the
 * default `-h, --help` (or re-registers it via `.helpOption()`), so we
 * surface those tokens as a known supplement rather than reaching into
 * Commander internals.
 */
const BUILTIN_HELP_FLAGS = ['-h', '--help'] as const;

/** Extract all flag tokens declared on a Commander command (plus `-h, --help`). */
function collectFlags(cmd: Command): string[] {
  const flags: string[] = [];
  for (const opt of cmd.options) flags.push(...parseFlagTokens(opt.flags));
  flags.push(...BUILTIN_HELP_FLAGS);
  return flags;
}

/** Identify whether a Commander option takes a value (`<arg>` or `[arg]` in its spec). */
function optionTakesValue(spec: string): boolean {
  return /[<\[]/.test(spec);
}

/**
 * Build the flag metadata once per process by introspecting the actual
 * Commander programs used at runtime. The factories are pure constructors
 * (no I/O, no auth) so this is cheap and safe.
 */
function getCommandFlagMetadata(): CommandFlagMetadata {
  if (cachedMetadata) return cachedMetadata;

  const topLevelProgram = createTopLevelProgram();
  const sessionProgram = createSessionProgram();
  registerSessionCommands(sessionProgram, '<@session>');

  const flagsWithValues = new Set<string>();
  const collectValueFlags = (cmd: Command): void => {
    for (const opt of cmd.options) {
      if (optionTakesValue(opt.flags)) {
        for (const tok of parseFlagTokens(opt.flags)) flagsWithValues.add(tok);
      }
    }
  };

  collectValueFlags(topLevelProgram);
  collectValueFlags(sessionProgram);

  const global = collectFlags(topLevelProgram);

  const topLevel = new Map<string, readonly string[]>();
  for (const sub of topLevelProgram.commands) {
    collectValueFlags(sub);
    topLevel.set(sub.name(), collectFlags(sub));
  }

  const session = new Map<string, readonly string[]>();
  for (const sub of sessionProgram.commands) {
    collectValueFlags(sub);
    session.set(sub.name(), collectFlags(sub));
  }

  cachedMetadata = { global, topLevel, session, flagsWithValues };
  return cachedMetadata;
}

/** Reset the cached metadata. Intended for tests only. */
export function resetCommandFlagMetadataCache(): void {
  cachedMetadata = undefined;
}

/** Allowed values for `logging-set-level`. */
const LOG_LEVELS = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
];

/** Allowed resources for `mcpc clean`. */
const CLEAN_RESOURCES = ['sessions', 'profiles', 'logs', 'all'];

/**
 * Filter a list of candidates by a prefix (case-sensitive).
 * Empty prefix returns all candidates.
 */
function filterByPrefix(candidates: readonly string[], prefix: string): string[] {
  if (!prefix) return [...candidates];
  return candidates.filter((c) => c.startsWith(prefix));
}

/**
 * Load `@session` names from sessions.json. Never throws — returns [] on any error
 * so a corrupted file never freezes the shell.
 */
async function loadSessionNames(): Promise<string[]> {
  // Session keys in sessions.json already include the `@` prefix (e.g. `@apify`).
  try {
    const storage = await loadSessions();
    return Object.keys(storage.sessions);
  } catch {
    return [];
  }
}

/**
 * Load known server hosts from auth profiles (for `login`/`logout` completion).
 * Returns [] on any error — same best-effort contract as `loadSessionNames`.
 */
async function loadProfileServers(): Promise<string[]> {
  try {
    const profiles = await listAuthProfiles();
    const hosts = new Set<string>();
    for (const p of profiles) {
      try {
        const url = new URL(p.serverUrl);
        hosts.add(url.host);
      } catch {
        // Ignore malformed URLs.
      }
    }
    return Array.from(hosts);
  } catch {
    return [];
  }
}

/**
 * Load distinct profile names across all servers (for `--profile <name>` completion).
 * Returns [] on any error — same best-effort contract as `loadSessionNames`.
 */
async function loadProfileNames(): Promise<string[]> {
  try {
    const profiles = await listAuthProfiles();
    const names = new Set<string>();
    for (const p of profiles) names.add(p.name);
    return Array.from(names);
  } catch {
    return [];
  }
}

/**
 * Context describing where we are in the command line.
 * Pure data — extracted from the tokenized words for easy unit testing.
 */
export interface CompletionContext {
  /** Words already typed (excluding the program name and the partial). */
  words: string[];
  /** The partial token currently being completed (may be empty). */
  partial: string;
  /** First non-option token, if any. */
  firstNonOption?: string;
  /** Whether the first non-option token starts with '@' (session command). */
  isSessionCommand: boolean;
  /** Session subcommand if `isSessionCommand` and a subcommand is present. */
  sessionSubcommand?: string;
  /** Top-level command if not a session command (e.g. 'connect', 'login'). */
  topLevelCommand?: string;
  /** The token immediately before the partial (used for flag-value completion). */
  previousToken?: string;
}

/**
 * Analyze the tokenized command line and figure out what we're completing.
 * Pure function — easy to unit-test without disk or network access.
 *
 * `words` is the list of complete tokens before the cursor (e.g. from
 * COMP_WORDS minus the program name). `partial` is the current incomplete
 * token (possibly empty if the cursor is on whitespace).
 */
export function analyzeContext(words: string[], partial: string): CompletionContext {
  const ctx: CompletionContext = {
    words,
    partial,
    isSessionCommand: false,
  };
  const last = words[words.length - 1];
  if (last !== undefined) {
    ctx.previousToken = last;
  }

  const { flagsWithValues } = getCommandFlagMetadata();

  // Locate the first non-option token. Skip values for options that take one
  // so we route based on positional intent (`-H foo @apify` should still see
  // `@apify` as the command).
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) continue;
    if (w.startsWith('-')) {
      if (flagsWithValues.has(w)) i++;
      continue;
    }
    ctx.firstNonOption = w;
    if (w.startsWith('@')) {
      ctx.isSessionCommand = true;
      for (let j = i + 1; j < words.length; j++) {
        const sub = words[j];
        if (sub === undefined) continue;
        if (sub.startsWith('-')) {
          if (flagsWithValues.has(sub)) j++;
          continue;
        }
        ctx.sessionSubcommand = sub;
        break;
      }
    } else {
      ctx.topLevelCommand = w;
    }
    break;
  }

  return ctx;
}

/**
 * Result of a completion query.
 */
export interface CompletionResult {
  candidates: string[];
  /** Bitmask of DIRECTIVE.* flags. */
  directive: number;
}

/**
 * Compute completion candidates for the given context.
 * Async because @session names live in sessions.json and profile names in profiles.json.
 *
 * Network access is never performed here — only local disk reads via existing
 * lib helpers. Hard failures fall through to "no suggestions".
 */
export async function suggestCompletions(ctx: CompletionContext): Promise<CompletionResult> {
  const { partial, previousToken } = ctx;

  const { flagsWithValues } = getCommandFlagMetadata();

  // 1. Flag-value completion: previous token is a flag that takes a value.
  if (previousToken && flagsWithValues.has(previousToken)) {
    if (previousToken === '--profile') {
      return {
        candidates: filterByPrefix(await loadProfileNames(), partial),
        directive: DIRECTIVE.DEFAULT,
      };
    }
    // For unknown flag values, let the shell fall back to file completion.
    return { candidates: [], directive: DIRECTIVE.DEFAULT };
  }

  // 2. The partial starts with '-' → flag completion.
  if (partial.startsWith('-')) {
    return completeFlags(ctx);
  }

  // 3. The partial starts with '@' OR we're at the first non-option slot
  //    → @session names + top-level commands.
  if (!ctx.firstNonOption) {
    return completeFirstToken(partial);
  }

  // 4. Session command: complete subcommand or its args.
  if (ctx.isSessionCommand) {
    return completeSessionContext(ctx);
  }

  // 5. Top-level command: complete its positional args.
  return completeTopLevelContext(ctx);
}

/** Complete the first token: top-level commands and @session names. */
async function completeFirstToken(partial: string): Promise<CompletionResult> {
  const sessions = await loadSessionNames();
  const all = [...KNOWN_COMMANDS, ...sessions];
  return { candidates: filterByPrefix(all, partial), directive: DIRECTIVE.DEFAULT };
}

/** Complete flags for the current command. */
function completeFlags(ctx: CompletionContext): CompletionResult {
  const meta = getCommandFlagMetadata();
  let flags: readonly string[];
  if (ctx.isSessionCommand) {
    const sub = ctx.sessionSubcommand;
    const subFlags = sub ? (meta.session.get(sub) ?? []) : [];
    flags = [...subFlags, ...meta.global];
  } else if (ctx.topLevelCommand) {
    flags = [...(meta.topLevel.get(ctx.topLevelCommand) ?? []), ...meta.global];
  } else {
    flags = meta.global;
  }
  const seen = new Set<string>();
  const unique = flags.filter((f) => (seen.has(f) ? false : (seen.add(f), true)));
  return { candidates: filterByPrefix(unique, ctx.partial), directive: DIRECTIVE.DEFAULT };
}

/** Map a session subcommand to the cache kind it consumes, if any. */
const SUBCOMMAND_CACHE_KIND: Record<string, CompletionKind> = {
  'tools-get': 'tools',
  'tools-call': 'tools',
  'resources-read': 'resources',
  'resources-subscribe': 'resources',
  'resources-unsubscribe': 'resources',
  'prompts-get': 'prompts',
};

/** Complete after a `@session` — either the subcommand or the subcommand's args. */
async function completeSessionContext(ctx: CompletionContext): Promise<CompletionResult> {
  if (!ctx.sessionSubcommand) {
    return {
      candidates: filterByPrefix(KNOWN_SESSION_COMMANDS, ctx.partial),
      directive: DIRECTIVE.DEFAULT,
    };
  }
  // Subcommand-specific value completion.
  if (ctx.sessionSubcommand === 'logging-set-level') {
    return { candidates: filterByPrefix(LOG_LEVELS, ctx.partial), directive: DIRECTIVE.DEFAULT };
  }
  const cacheKind = SUBCOMMAND_CACHE_KIND[ctx.sessionSubcommand];
  if (cacheKind && ctx.firstNonOption && isFirstPositionalAfterSubcommand(ctx)) {
    // Tool names / resource URIs / prompt names come from the per-session
    // cache populated by `tools-list` / `resources-list` / `prompts-list`.
    // Run those once to warm the cache if completion comes up empty.
    const names = await readCompletionCache(ctx.firstNonOption, cacheKind);
    return { candidates: filterByPrefix(names, ctx.partial), directive: DIRECTIVE.DEFAULT };
  }
  // No suggestions for other free-form args; shell falls back to file completion.
  return { candidates: [], directive: DIRECTIVE.DEFAULT };
}

/**
 * After `@session <subcommand>`, are we still on the first positional arg
 * (i.e. the tool name / URI / prompt name slot)? Used to avoid suggesting
 * names again once the user has typed past the first positional.
 */
function isFirstPositionalAfterSubcommand(ctx: CompletionContext): boolean {
  const { flagsWithValues } = getCommandFlagMetadata();
  let seenSession = false;
  let seenSubcommand = false;
  let positionalsAfter = 0;
  for (let i = 0; i < ctx.words.length; i++) {
    const w = ctx.words[i];
    if (w === undefined) continue;
    if (w.startsWith('-')) {
      if (flagsWithValues.has(w)) i++;
      continue;
    }
    if (!seenSession) {
      seenSession = true;
      continue;
    }
    if (!seenSubcommand) {
      seenSubcommand = true;
      continue;
    }
    positionalsAfter++;
  }
  return seenSubcommand && positionalsAfter === 0;
}

/** Complete after a top-level command (connect, login, clean, etc.). */
async function completeTopLevelContext(ctx: CompletionContext): Promise<CompletionResult> {
  const cmd = ctx.topLevelCommand;
  switch (cmd) {
    case 'connect': {
      // `connect <server> [@session]` — suggest @session names so the user can
      // tab-complete the optional session name. The shell falls back to file
      // completion for the <server> arg (config file paths).
      return {
        candidates: filterByPrefix(await loadSessionNames(), ctx.partial),
        directive: DIRECTIVE.DEFAULT,
      };
    }
    case 'close':
    case 'restart':
    case 'shell': {
      return {
        candidates: filterByPrefix(await loadSessionNames(), ctx.partial),
        directive: DIRECTIVE.DEFAULT,
      };
    }
    case 'login':
    case 'logout': {
      return {
        candidates: filterByPrefix(await loadProfileServers(), ctx.partial),
        directive: DIRECTIVE.DEFAULT,
      };
    }
    case 'clean': {
      return {
        candidates: filterByPrefix(CLEAN_RESOURCES, ctx.partial),
        directive: DIRECTIVE.DEFAULT,
      };
    }
    case 'help': {
      const all = [...KNOWN_COMMANDS, ...KNOWN_SESSION_COMMANDS];
      return { candidates: filterByPrefix(all, ctx.partial), directive: DIRECTIVE.DEFAULT };
    }
    case 'completion': {
      return {
        candidates: filterByPrefix([...SUPPORTED_SHELLS, 'install'], ctx.partial),
        directive: DIRECTIVE.DEFAULT,
      };
    }
    default:
      return { candidates: [], directive: DIRECTIVE.DEFAULT };
  }
}

/**
 * Entry point for the hidden `__complete` subcommand.
 *
 * `args` is everything after `--` on the command line, mirroring `COMP_WORDS`:
 *   args[0]   = program name (typically "mcpc") — ignored
 *   args[1..N-1] = completed tokens
 *   args[N]   = the current partial token (may be empty)
 *
 * Output is written to stdout: one candidate per line, plus an optional
 * `:<bitflag>` directive line.
 */
export async function handleComplete(args: string[]): Promise<void> {
  // Drop the program name; tokens after that are user input.
  const tokens = args.slice(1);
  const partial = tokens[tokens.length - 1] ?? '';
  const words = tokens.slice(0, -1);

  const ctx = analyzeContext(words, partial);
  const result = await suggestCompletions(ctx);

  for (const c of result.candidates) {
    process.stdout.write(c + '\n');
  }
  if (result.directive !== DIRECTIVE.DEFAULT) {
    process.stdout.write(`:${result.directive}\n`);
  }
}

/** Generate the bash completion script. */
export function generateBashScript(): string {
  // All intelligence lives in `mcpc __complete`; this script is just a thin
  // adapter that translates bash's COMP_WORDS/COMP_CWORD into the protocol.
  return `# mcpc bash completion
# Install: source this file, or place it in /etc/bash_completion.d/ or
# ~/.local/share/bash-completion/completions/mcpc
# Generated by 'mcpc completion bash'

_mcpc() {
    COMPREPLY=()
    local IFS=$'\\n'
    local response directive=0 last

    # Pass the program name, all completed words, and the current partial
    # token. mcpc's __complete handler takes care of context analysis.
    if ! response=$(mcpc __complete -- "\${COMP_WORDS[@]:0:\$COMP_CWORD}" "\${COMP_WORDS[\$COMP_CWORD]:-}" 2>/dev/null); then
        return 0
    fi

    # If the last line is ':<number>', it's a directive bitmask (cobra-style).
    last=\${response##*$'\\n'}
    if [[ "\$last" == :* ]]; then
        directive=\${last#:}
        response=\${response%$'\\n'*}
    fi

    while IFS= read -r line; do
        [[ -z "\$line" ]] && continue
        COMPREPLY+=("\$line")
    done <<< "\$response"

    # Directive bit 0 (value 1): no trailing space
    if (( (directive & 1) != 0 )); then
        compopt -o nospace 2>/dev/null
    fi
    # Directive bit 1 (value 2): no file fallback
    if (( (directive & 2) != 0 )); then
        compopt +o default 2>/dev/null
    fi
}

complete -o default -F _mcpc mcpc
`;
}

/** Generate the zsh completion script. */
export function generateZshScript(): string {
  return `#compdef mcpc
# mcpc zsh completion
# Install: place this file in a directory on your $fpath (e.g.
# ~/.zsh/completions) and add 'autoload -U compinit; compinit' to ~/.zshrc.
# Generated by 'mcpc completion zsh'

_mcpc() {
    local -a candidates
    local response directive=0 last

    # Build the words array compatible with the __complete protocol:
    # program name + completed words + the current partial.
    local cur="\${words[CURRENT]:-}"
    local before=("\${words[@]:0:$((CURRENT-1))}")

    response=$(mcpc __complete -- "\${before[@]}" "\$cur" 2>/dev/null) || return

    last=\${response##*$'\\n'}
    if [[ "\$last" == :* ]]; then
        directive=\${last#:}
        response=\${response%$'\\n'*}
    fi

    local IFS=$'\\n'
    candidates=(\${(f)response})

    local -a opts=()
    if (( (directive & 1) != 0 )); then
        opts+=(-S '')  # no space after match
    fi
    if (( \${#candidates[@]} > 0 )); then
        compadd "\${opts[@]}" -- "\${candidates[@]}"
    fi
}

compdef _mcpc mcpc
`;
}

/** Generate the fish completion script. */
export function generateFishScript(): string {
  return `# mcpc fish completion
# Install: place this file in ~/.config/fish/completions/mcpc.fish
# Generated by 'mcpc completion fish'

function __mcpc_complete
    set -l tokens (commandline -opc) (commandline -ct)
    mcpc __complete -- $tokens 2>/dev/null | grep -v '^:[0-9]*$'
end

complete -c mcpc -f -a '(__mcpc_complete)'
`;
}

/** Print the completion script for the given shell to stdout. */
export function printCompletionScript(shell: Shell): void {
  switch (shell) {
    case 'bash':
      process.stdout.write(generateBashScript());
      return;
    case 'zsh':
      process.stdout.write(generateZshScript());
      return;
    case 'fish':
      process.stdout.write(generateFishScript());
      return;
  }
}

/** Compute the recommended install path for a shell. */
export function getInstallPath(shell: Shell): string {
  const home = homedir();
  switch (shell) {
    case 'bash': {
      // Linux/macOS user-local bash-completion path.
      const xdg = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share');
      return join(xdg, 'bash-completion', 'completions', 'mcpc');
    }
    case 'zsh':
      return join(home, '.zsh', 'completions', '_mcpc');
    case 'fish':
      return join(home, '.config', 'fish', 'completions', 'mcpc.fish');
  }
}

/**
 * Detect the user's shell from $SHELL. Returns undefined if it can't be
 * determined or isn't supported.
 */
export function detectShell(): Shell | undefined {
  const shellPath = process.env.SHELL ?? '';
  if (shellPath.endsWith('/bash') || shellPath.endsWith('\\bash.exe')) return 'bash';
  if (shellPath.endsWith('/zsh')) return 'zsh';
  if (shellPath.endsWith('/fish')) return 'fish';
  return undefined;
}

/**
 * Install the completion script for the given (or detected) shell.
 * Writes the file and prints a short instruction block.
 */
export async function installCompletion(shell?: Shell): Promise<void> {
  const resolved = shell ?? detectShell();
  if (!resolved) {
    throw new ClientError(
      `Could not auto-detect your shell from $SHELL.\n` +
        `Run one of:\n` +
        `  mcpc completion install bash\n` +
        `  mcpc completion install zsh\n` +
        `  mcpc completion install fish`
    );
  }

  if (platform() === 'win32') {
    throw new ClientError(
      'Windows shells are not supported yet. ' +
        'Use WSL or run `mcpc completion <shell>` and source the output manually.'
    );
  }

  const installPath = getInstallPath(resolved);
  const script =
    resolved === 'bash'
      ? generateBashScript()
      : resolved === 'zsh'
        ? generateZshScript()
        : generateFishScript();

  await mkdir(dirname(installPath), { recursive: true });
  await writeFile(installPath, script);

  console.log(theme.green(`✓ Installed ${resolved} completion at ${installPath}`));
  printShellSpecificInstructions(resolved, installPath);
}

/** Print post-install instructions specific to each shell. */
function printShellSpecificInstructions(shell: Shell, installPath: string): void {
  switch (shell) {
    case 'bash':
      console.log(
        `\nTo activate, either start a new shell or run:\n` +
          `  source ${installPath}\n\n` +
          `If completions don't work, ensure your shell loads files from\n` +
          `  ~/.local/share/bash-completion/completions/\n` +
          `Most modern bash-completion installations do this automatically.\n` +
          `On macOS with Homebrew bash-completion@2 this is the default.`
      );
      return;
    case 'zsh':
      console.log(
        `\nAdd these lines to ~/.zshrc (if not already present):\n` +
          `  fpath=(${dirname(installPath)} $fpath)\n` +
          `  autoload -U compinit && compinit\n\n` +
          `Then start a new shell or run 'exec zsh' to activate.`
      );
      return;
    case 'fish':
      console.log(
        `\nFish auto-loads completions from this path; ` + `open a new shell to activate.`
      );
      return;
  }
}
