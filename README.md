# `mcpc`: Universal MCP command-line client

`mcpc` is a CLI for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
that maps MCP operations to intuitive commands for interactive shell use, scripts, and AI coding agents.

`mcpc` is a Swiss Army knife for MCP. It is useful for inspecting servers, scripting,
and enabling AI coding agents to use MCP ["code mode"](#ai-agents) in shell.
After all, UNIX-compatible shell script is THE most universal coding language.

![mcpc screenshot](https://raw.githubusercontent.com/apify/mcpc/main/docs/images/mcpc-demo.gif)

**Key features:**

- 🌎 **Compatible** - Works with any MCP server over Streamable HTTP or stdio.
- 🔄 **Persistent sessions** - Keep multiple server connections alive simultaneously.
- 🔧 **Strong MCP support** - Instructions, tools, resources, prompts, dynamic discovery.
- 🔌 **Code mode** - JSON output enables integration with CLI tools like `jq` and scripting.
- 🤖 **AI sandboxing** - MCP proxy server to securely access authenticated sessions from AI-generated code.
- 🔒 **Secure** - Full OAuth 2.1 support, OS keychain for credentials storage.
- 🪶 **Lightweight** - Minimal dependencies, works on Mac/Win/Linux, doesn't use LLMs on its own.
- 💸 **[Agentic payments (x402)](#agentic-payments-x402)** - Experimental support for the [x402](https://www.x402.org/) payment protocol, enabling AI agents to pay for MCP tool calls with USDC on [Base](https://www.base.org/).

## Table of contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Install](#install)
- [Quickstart](#quickstart)
- [Usage](#usage)
- [Sessions](#sessions)
- [Authentication](#authentication)
- [MCP proxy](#mcp-proxy)
- [AI agents](#ai-agents)
- [Agentic payments (x402)](#agentic-payments-x402)
- [MCP support](#mcp-support)
- [Configuration](#configuration)
- [Security](#security)
- [Errors](#errors)
- [Development](#development)
- [Related work](#related-work)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Install

```bash
npm install -g @apify/mcpc

# Or with Bun
bun install -g @apify/mcpc
```

**Linux users:** `mcpc` uses the OS keychain for secure credential storage via the
[Secret Service API](https://specifications.freedesktop.org/secret-service/).
On desktop systems (GNOME, KDE) this works out of the box. On headless/server/CI environments
without a keyring daemon, `mcpc` automatically falls back to a file-based credential store
(`~/.mcpc/credentials`, mode `0600`).

To use the OS keychain on a headless system, install `libsecret` and a secret service daemon:

```bash
# Debian/Ubuntu
sudo apt-get install libsecret-1-0 gnome-keyring

# Fedora/RHEL/CentOS
sudo dnf install libsecret gnome-keyring

# Arch Linux
sudo pacman -S libsecret gnome-keyring
```

And then run `mcpc` as follows:

```
dbus-run-session -- bash -c "echo -n 'password' | gnome-keyring-daemon --unlock && mcpc ..."
```

## Quickstart

```bash
# List all active sessions and saved authentication profiles
mcpc

# Login to remote MCP server and save OAuth credentials for future use
mcpc login mcp.apify.com

# Create a persistent session and interact with it
mcpc connect mcp.apify.com @test
mcpc @test                                            # show server info
mcpc @test tools-list
mcpc @test tools-call search-actors keywords:="website crawler"
mcpc @test shell

# Use JSON mode for scripting
mcpc --json @test tools-list

# Use a local MCP server package (stdio) referenced from config file
mcpc connect ./.vscode/mcp.json:filesystem @fs
mcpc @fs tools-list
```

## Usage

<!-- AUTO-GENERATED: mcpc --help -->

```
Usage: mcpc [options] [<@session>] [<command>]

Universal command-line client for the Model Context Protocol (MCP).

Options:
  -j, --json                   Output in JSON format for scripting
  -H, --header <header>        HTTP header (can be repeated)
  --verbose                    Enable debug logging
  --profile <name>             OAuth profile for the server ("default" if not provided)
  --schema <file>              Validate tool/prompt schema against expected schema
  --schema-mode <mode>         Schema validation mode: strict, compatible (default), ignore
  --timeout <seconds>          Request timeout in seconds (default: 300)
  -v, --version                Output the version number
  -h, --help                   Display help

Commands:
  connect <server> <@session>  Connect to an MCP server and start a new named @session
  close <@session>             Close a session
  restart <@session>           Restart a session (losing all state)
  shell <@session>             Open interactive shell for a session
  login <server>               Interactively login to a server using OAuth and save profile
  logout <server>              Delete an authentication profile for a server
  clean [resources...]         Clean up mcpc data (sessions, profiles, logs, all)
  x402 [subcommand] [args...]  Configure an x402 payment wallet (EXPERIMENTAL)
  help [command]               Show help for a specific command

MCP session commands (after connecting):
  <@session>                   Show MCP server info and capabilities
  <@session> tools-list        List MCP tools
  <@session> tools-get <name>
  <@session> tools-call <name> [arg:=val ... | <json> | <stdin]
  <@session> prompts-list
  <@session> prompts-get <name> [arg:=val ... | <json> | <stdin]
  <@session> resources-list
  <@session> resources-read <uri>
  <@session> resources-subscribe <uri>
  <@session> resources-unsubscribe <uri>
  <@session> resources-templates-list
  <@session> logging-set-level <level>
  <@session> ping

Run "mcpc" without arguments to show active sessions and OAuth profiles.
```

### General actions

With no arguments, `mcpc` lists all active sessions and saved OAuth profiles:

```bash
# List all sessions and OAuth profiles (also in JSON mode)
mcpc
mcpc --json

# Show command help or version
mcpc --help
mcpc --version

# Clean stale sessions and old log files
mcpc clean
```

### Server formats

The `connect`, `login`, and `logout` commands accept a `<server>` argument in these formats:

- **Remote URL** (e.g. `mcp.apify.com` or `https://mcp.apify.com`) — scheme defaults to `https://`
- **Config file entry** (e.g. `~/.vscode/mcp.json:filesystem`) — `file:entry-name` syntax

### MCP commands

All MCP commands go through a named session created with `connect`:

```bash
# Connect to a remote server and create a session
mcpc connect mcp.apify.com @apify
mcpc @apify tools-list
mcpc @apify tools-call search-apify-docs query:="What are Actors?"

# Connect to a local server via config file entry
mcpc connect ~/.vscode/mcp.json:filesystem @fs
mcpc @fs tools-list
mcpc @fs tools-call list_directory path:=/
```

See [MCP feature support](#mcp-feature-support) for details about all supported MCP features and commands.

#### Command arguments

The `tools-call` and `prompts-get` commands accept arguments as positional parameters after the tool/prompt name:

```bash
# Key:=value pairs (auto-parsed: tries JSON, falls back to string)
mcpc @session tools-call <tool-name> greeting:="hello world" count:=10 enabled:=true
mcpc @session tools-call <tool-name> config:='{"key":"value"}' items:='[1,2,3]'

# Force string type with JSON quotes
mcpc @session tools-call <tool-name> id:='"123"' flag:='"true"'

# Inline JSON object (if first arg starts with { or [)
mcpc @session tools-call <tool-name> '{"greeting":"hello world","count":10}'

# Read from stdin (automatic when no positional args and input is piped)
echo '{"greeting":"hello","count":10}' | mcpc @session tools-call <tool-name>
cat args.json | mcpc @session tools-call <tool-name>
```

**Rules:**

- All arguments use `:=` syntax: `key:=value`
- Values are auto-parsed: valid JSON becomes that type, otherwise treated as string
  - `count:=10` → number `10`
  - `enabled:=true` → boolean `true`
  - `greeting:=hello` → string `"hello"` (not valid JSON, so string)
  - `id:='"123"'` → string `"123"` (JSON string literal)
- Inline JSON: If first argument starts with `{` or `[`, it's parsed as a JSON object/array
- Stdin: When no positional args are provided and input is piped, reads JSON from stdin

**Using shell variables:**

When using shell variables that may contain spaces, use double quotes around the entire argument:

```bash
# Variable with spaces - use double quotes
QUERY="hello world"
mcpc @server tools-call search "query:=${QUERY}"

# Multiple variables
CITY="New York"
TYPE="restaurants"
mcpc @server tools-call search "query:=${CITY} ${TYPE}"

# For complex inputs, consider using JSON via stdin
echo "{\"query\": \"${QUERY}\", \"limit\": 10}" | mcpc @server tools-call search
```

**Common pitfall:** Don't put spaces around `:=` - it won't work:

```bash
# Wrong - spaces around :=
mcpc @server tools-call search query := "hello world"

# Correct - no spaces around :=
mcpc @server tools-call search "query:=hello world"
```

### Interactive shell

`mcpc` provides an interactive shell for discovery and testing of MCP servers.

```bash
mcpc @apify shell
```

Shell commands: `help`, `exit`/`quit`/Ctrl+D, Ctrl+C to cancel.
Arrow keys navigate history (saved to `~/.mcpc/history`).

### JSON mode

By default, `mcpc` prints output in Markdown-ish text format with colors, making it easy to read by both humans and AIs.

With `--json` option, `mcpc` always emits only a single JSON object (or array), to enable [scripting](#scripting).
**For all MCP commands, the returned objects are always consistent with the
[MCP specification](https://modelcontextprotocol.io/specification/latest).**
On success, the JSON object is printed to stdout, on error to stderr.

Note that `--json` is not available for `shell`, `login`, and `mcpc --help` commands.

## Sessions

MCP is a [stateful protocol](https://modelcontextprotocol.io/specification/latest/basic/lifecycle):
clients and servers negotiate protocol version and capabilities, and then communicate within a persistent session.
To support these sessions, `mcpc` can start a lightweight **bridge process** that maintains the connection and state.
This is more efficient than forcing every MCP command to reconnect and reinitialize,
and enables long-term stateful sessions.

The sessions are given names prefixed with `@` (e.g. `@apify`),
which then serve as unique reference in commands.

```bash
# Create a persistent session
mcpc connect mcp.apify.com @apify

# List all sessions and OAuth profiles
mcpc

# Run MCP commands in the session
mcpc @apify tools-list
mcpc @apify shell

# Restart the session (kills and restarts the bridge process)
mcpc @apify restart    # or: mcpc restart @apify

# Close the session, terminates bridge process
mcpc @apify close      # or: mcpc close @apify

# ...now session name "@apify" is forgotten and available for future use
```

### Session lifecycle

The sessions are persistent: metadata is saved in `~/.mcpc/sessions.json` file,
[authentication tokens](#authentication) in OS keychain.
The `mcpc` bridge process keeps the session alive by sending periodic [ping messages](#ping) to the MCP server.
Still, sessions can fail due to network disconnects, bridge process crash, or server dropping it.

**Session states:**

| State            | Meaning                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| 🟢 **`live`**    | Bridge process is running; server might or might not be operational                           |
| 🟡 **`crashed`** | Bridge process crashed or was killed; will auto-restart on next use                           |
| 🔴 **`expired`** | Server rejected the session (auth failed, session ID invalid); requires `close` and reconnect |

Here's how `mcpc` handles various bridge process and server connection states:

- While the **bridge process is running**:
  - If **server positively responds** to pings, the session is marked 🟢 **`live`**, and everything is fine.
  - If **server stops responding**, the bridge will keep trying to reconnect in the background.
  - If **server negatively responds** to indicate `MCP-Session-Id` is no longer valid
    or authentication permanently failed (HTTP 401 or 403),
    the bridge process will flag the session as 🔴 **`expired`** and **terminate** to avoid wasting resources.
    Any future attempt to use the session (`mcpc @my-session ...`) will fail.
- If the **bridge process crashes**, `mcpc` will mark the session as 🟡 **`crashed`** on first use.
  Next time you run `mcpc @my-session ...`, it will attempt to restart the bridge process.
  - If bridge **restart succeeds**, everything starts again (see above).
  - If bridge **restart fails**, `mcpc @my-session ...` returns error, and session remains marked 🟡 **`crashed`**.

Note that `mcpc` never automatically removes sessions from the list.
Instead, it keeps them flagged as 🟡 **`crashed`** or 🔴 **`expired`**,
and any future attempts to use them will fail.

To **remove the session from the list**, you need to explicitly close it:

```bash
mcpc @apify close    # or: mcpc close @apify
```

You can restart a session anytime, which kills the bridge process
and opens new connection with new `MCP-Session-Id`, by running:

```bash
mcpc @apify restart  # or: mcpc restart @apify
```

## Authentication

`mcpc` supports all standard [MCP authorization methods](https://modelcontextprotocol.io/specification/latest/basic/authorization).

### Anonymous access

For local servers (stdio) or remote servers (Streamable HTTP) which do not require credentials,
`mcpc` can be used without authentication:

```bash
mcpc connect mcp.apify.com @test
mcpc @test tools-list
```

### Bearer token authentication

For remote servers that require a Bearer token (but not OAuth), use the `--header` flag to pass the token.
All headers are stored securely in the OS keychain for the session, but they are **not** saved as reusable
[OAuth profiles](#oauth-profiles). This means `--header` needs to be provided whenever
running a one-shot command or connecting new session.

```bash
# Create session with Bearer token (token saved to keychain for this session only)
mcpc connect https://mcp.apify.com @apify --header "Authorization: Bearer ${APIFY_TOKEN}"

# Use the session (Bearer token is loaded from keychain automatically)
mcpc @apify tools-list
```

### OAuth profiles

For OAuth-enabled remote MCP servers, `mcpc` implements the full OAuth 2.1 flow with PKCE,
including `WWW-Authenticate` header discovery, server metadata discovery, client ID metadata documents,
dynamic client registration, and automatic token refresh.

The OAuth authentication **always** needs to be initiated by the user calling the `login` command,
which opens a web browser with login screen. `mcpc` never opens the web browser on its own.

The OAuth credentials to specific servers are securely stored as **authentication profiles** - reusable
credentials that allow you to:

- Authenticate once, use credentials across multiple commands or sessions
- Use different accounts (profiles) with the same server
- Manage credentials independently from sessions

Key concepts:

- **Authentication profile**: Named set of OAuth credentials for a specific server (stored in `~/.mcpc/profiles.json` + OS keychain)
- **Session**: Active connection to a server that may reference an authentication profile (stored in `~/.mcpc/sessions.json`)
- **Default profile**: When `--profile` is not specified, `mcpc` uses the authentication profile named `default`

**Example:**

```bash
# Login to server and save 'default' authentication profile for future use
mcpc login mcp.apify.com

# Use named authentication profile instead of 'default'
mcpc login mcp.apify.com --profile work

# Create two sessions using the two different credentials
mcpc connect mcp.apify.com @apify-personal
mcpc connect mcp.apify.com @apify-work --profile work

# Both sessions now work independently
mcpc @apify-personal tools-list  # Uses personal account
mcpc @apify-work tools-list      # Uses work account

# Re-authenticate existing profile (e.g., to refresh or change scopes)
mcpc login mcp.apify.com --profile work

# Delete "default" and "work" authentication profiles
mcpc logout mcp.apify.com
mcpc logout mcp.apify.com --profile work
```

### Authentication precedence

When multiple authentication methods are available, `mcpc` uses this precedence order:

1. **Command-line `--header` flag** (highest priority) - Always used if provided
2. **Saved authentication profiles** - OAuth tokens from saved profile
3. **Config file headers** - Headers from `--config` file for the server
4. **No authentication** - Attempts unauthenticated connection

`mcpc` automatically handles authentication based on whether you specify a profile:

**When `--profile <name>` is specified:**

1. **Profile exists for the server**: Use its stored credentials
   - If authentication succeeds → Continue with command/session
   - If authentication fails (expired/invalid) → Fail with an error
2. **Profile doesn't exist**: Fail with an error

**When no `--profile` is specified:**

1. **`default` profile exists for the server**: Use its stored credentials
   - If authentication succeeds → Continue with command/session
   - If authentication fails (expired/invalid) → Fail with an error
2. **`default` profile doesn't exist**: Attempt unauthenticated connection
   - If server accepts (no auth required) → Continue without creating profile
   - If server rejects with 401 + `WWW-Authenticate` → Fail with an error

On failure, the error message includes instructions on how to login and save the profile, so you know what to do.

This flow ensures:

- You only authenticate when necessary
- Credentials are never silently mixed up (personal → work) or downgraded (authenticated → unauthenticated)
- You can mix authenticated sessions (with named profiles) and public access on the same server

**Examples:**

```bash
# With specific profile - always authenticated:
# - Uses 'work' if it exists
# - Fails if it doesn't exist
mcpc connect mcp.apify.com @apify-work --profile work

# Without profile - opportunistic authentication:
# - Uses 'default' if it exists
# - Tries unauthenticated if 'default' doesn't exist
# - Fails if the server requires authentication
mcpc connect mcp.apify.com @apify-personal
```

## MCP proxy

For stronger isolation, `mcpc` can expose an MCP session under a new local proxy MCP server using the `--proxy` option.
The proxy forwards all MCP requests to the upstream server but **never exposes the original authentication tokens** to the client.
This is useful when you want to give someone or something MCP access without revealing your credentials.
See also [AI sandboxes](#ai-sandboxes).

```bash
# Human authenticates to a remote server
mcpc login mcp.apify.com

# Create authenticated session with proxy server on localhost:8080
mcpc connect mcp.apify.com @open-relay --proxy 8080

# Now any MCP client can connect to proxy like to a regular MCP server
# The client has NO access to the original OAuth tokens or HTTP headers
# Note: localhost/127.0.0.1 URLs default to http:// (no scheme needed)
mcpc connect localhost:8080 @sandboxed
mcpc @sandboxed tools-call search-actors keywords:="web scraper"

# Optionally protect proxy with bearer token for better security (stored in OS keychain)
mcpc connect mcp.apify.com @secure-relay --proxy 8081 --proxy-bearer-token secret123
# To use the proxy, caller needs to pass the bearer token in HTTP header
mcpc connect localhost:8081 @sandboxed2 --header "Authorization: Bearer secret123"
```

**Proxy options for `connect` command:**

| Option                         | Description                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `--proxy [host:]port`          | Start proxy MCP server. Default host: `127.0.0.1` (localhost only)             |
| `--proxy-bearer-token <token>` | Requires `Authorization: Bearer <token>` header to access the proxy MCP server |

**Security model:**

- **Localhost by default**: `--proxy 8080` binds to `127.0.0.1` only, preventing network access
- **Tokens hidden**: Original OAuth tokens and/or HTTP headers are never exposed to proxy clients
- **Optional auth**: Use `--proxy-bearer-token` to add another layer of security
- **Explicit opt-in**: Proxy only starts when `--proxy` flag is provided

**Binding to network interfaces:**

```bash
# Localhost only (default, most secure)
mcpc connect mcp.apify.com @relay --proxy 8080

# Bind to all interfaces (allows network access - use with caution!)
mcpc connect mcp.apify.com @relay --proxy 0.0.0.0:8080

# Bind to specific interface
mcpc connect mcp.apify.com @relay --proxy 192.168.1.100:8080
```

When listing sessions, proxy info is displayed prominently:

```bash
mcpc
# @relay → https://mcp.apify.com (HTTP, OAuth: default) [proxy: 127.0.0.1:8080]
```

## AI agents

`mcpc` is designed for CLI-enabled AI agents like Claude Code or Codex CLI, supporting both
interactive **tool calling** and **[code mode](https://www.anthropic.com/engineering/code-execution-with-mcp)**.

**Tool calling mode** - Agents call `mcpc` commands to dynamically explore and interact with MCP servers,
using the default text output. This is similar to how MCP connectors in ChatGPT or Claude work,
but CLI gives you more flexibility and longer operation timeouts.

```bash
# Discover available tools
mcpc @server tools-list

# Get tool schema
mcpc @server tools-get search

# Call a tool
mcpc @server tools-call search query:="hello world"
```

**Code mode** - Once agents understand the server's capabilities, they can write shell scripts
that compose multiple `mcpc` commands with `--json` output. This can be
[more accurate](https://www.anthropic.com/engineering/code-execution-with-mcp)
and use fewer tokens than tool calling for complex workflows.

```bash
# AI-generated script using --json for structured data
mcpc --json @apify tools-call search-actors keywords:="scraper" \
  | jq '.content[0].text | fromjson | .items[0].id' \
  | xargs -I {} mcpc @apify tools-call get-actor actorId:="{}"
```

With [schema validation](#schema-validation), agents can ensure stability of integrations and faster failure recovery.
Agents, make no harm!

See an [example](./docs/examples/company-lookup.sh) of an AI-generated shell script.

### Scripting

Use `--json` for machine-readable output (stdout on success, stderr on error).
JSON output of all MCP commands follows the [MCP specification](https://modelcontextprotocol.io/specification/latest) strictly.

```bash
# Chain tools across sessions
mcpc --json @apify tools-call search-actors keywords:="scraper" \
  | jq '.content[0].text | fromjson | .items[0].id' \
  | xargs -I {} mcpc @apify tools-call get-actor actorId:="{}"

# Batch operations
for tool in $(mcpc --json @server tools-list | jq -r '.[].name'); do
  mcpc --json @server tools-get "$tool" > "schemas/$tool.json"
done
```

For a complete example script, see [`docs/examples/company-lookup.sh`](./docs/examples/company-lookup.sh).

### Schema validation

Validate tool/prompt schemas using the `--schema` option to detect breaking changes early:

```bash
# Save expected schema
mcpc --json @apify tools-get search-actors > expected.json

# Validate before calling (fails if schema changed incompatibly)
mcpc @apify tools-call search-actors --schema expected.json keywords:="test"
```

Available schema validation modes (`--schema-mode`):

- `compatible` (default)
  - Input schema: new optional fields OK, required fields must have the same type.
  - Output schema: new fields OK, removed required fields cause error.
- `strict` - Both input and output schemas must match exactly, including all fields, types, and descriptions
- `ignore` - Skip validation completely (YOLO)

### AI sandboxes

To ensure AI coding agents don't perform destructive actions or leak credentials,
it's always a good idea to run them in a code sandbox with limited access to your resources.

The [proxy MCP server](#mcp-proxy) feature provides a security boundary for AI agents:

1. **Human creates authentication profile**: `mcpc login mcp.apify.com --profile ai-access`
2. **Human creates session**: `mcpc connect mcp.apify.com @ai-sandbox --profile ai-access --proxy 8080`
3. **AI runs inside a sandbox**: If sandbox has access limited to `localhost:8080`,
   it can only interact with the MCP server through the `@ai-sandbox` session,
   without access to the original OAuth credentials, HTTP headers, or `mcpc` configuration.

This ensures AI agents operate only with pre-authorized credentials, preventing unauthorized access to MCP servers.
The human controls which servers the AI can access and with what permissions (OAuth scopes).

**IMPORTANT:** Beware that MCP proxy will not make an insecure MCP server secure.
Local stdio servers will still have access to your local system, and HTTP servers to provided auth credentials,
and both can easily perform destructive actions or leak credentials on their own, or let MCP clients do such actions.
**Always use only trusted local and remote MCP servers and limit their access to the necessary minimum.**

### Agent skills

To help Claude Code use `mcpc`, you can install this [Claude skill](./docs/claude-skill/README.md):

<!-- TODO: Add also AGENTS.md, GitHub skills etc. -->

## Agentic payments (x402)

> ⚠️ **Experimental.** This feature is under active development and may change.

`mcpc` has experimental support for the [x402 payment protocol](https://www.x402.org/),
which enables AI agents to autonomously pay for MCP tool calls using cryptocurrency.
When an MCP server charges for a tool call (HTTP 402), `mcpc` automatically signs a USDC payment
on the [Base](https://base.org/) blockchain and retries the request — no human intervention needed.

This is entirely **opt-in**: existing functionality is unaffected unless you explicitly pass the `--x402` flag.

### How it works

1. **Server returns HTTP 402** with a `PAYMENT-REQUIRED` header describing the price and payment details.
2. `mcpc` parses the header, signs an [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) `TransferWithAuthorization` using your local wallet.
3. `mcpc` retries the request with a `PAYMENT-SIGNATURE` header containing the signed payment.
4. The server verifies the signature and fulfills the request.

For tools that advertise pricing in their `_meta.x402` metadata, `mcpc` can **proactively sign** payments
on the first request, avoiding the 402 round-trip entirely.

### Wallet setup

`mcpc` stores a single wallet in `~/.mcpc/wallets.json` (file permissions `0600`).
You need to create or import a wallet before using x402 payments.

```bash
# Create a new wallet (generates a random private key)
mcpc x402 init

# Or import an existing wallet from a private key
mcpc x402 import <private-key>

# Show wallet address and creation date
mcpc x402 info

# Remove the wallet
mcpc x402 remove
```

After creating a wallet, **fund it with USDC on Base** (mainnet or Sepolia testnet) to enable payments.

### Using x402 with MCP servers

Pass the `--x402` flag when connecting to a session or running direct commands:

```bash
# Create a session with x402 payment support
mcpc connect mcp.apify.com @apify --x402

# The session now automatically handles 402 responses
mcpc @apify tools-call expensive-tool query:="hello"

# Restart a session with x402 enabled
mcpc @apify restart --x402
```

When `--x402` is active, a fetch middleware wraps all HTTP requests to the MCP server.
If any request returns HTTP 402, the middleware transparently signs and retries.

### Supported networks

| Network              | Status       |
| -------------------- | ------------ |
| Base Mainnet         | ✅ Supported |
| Base Sepolia testnet | ✅ Supported |

## MCP support

`mcpc` is built on the official [MCP SDK for TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) and supports most [MCP protocol features](https://modelcontextprotocol.io/specification/latest).

### Transport

- **stdio**: Direct bidirectional JSON-RPC communication over
  stdio server from the [config file](#mcp-server-config-file).
- **Streamable HTTP**: Fully supported.
- **HTTP with SSE** (deprecated): Legacy mode, not supported.

### Authorization

- [Anonymous access](#anonymous-access)
- [HTTP header authorization](#bearer-token-authentication)
- [OAuth 2.1](#oauth-profiles)

### MCP session

The bridge process manages the full MCP session lifecycle:

- Performs initialization handshake (`initialize` → `initialized`)
- Negotiates protocol version and capabilities
- Fetches server-provided `instructions`
- Maintains persistent HTTP connections with bidirectional streaming, or stdio bidirectional pipe to subprocess
- Handles `MCP-Protocol-Version` and `MCP-Session-Id` headers automatically
- Handles multiple concurrent requests
- Recovers transparently from network disconnections and bridge process crashes

### MCP feature support

| **Feature**                                        | **Status**                        |
| :------------------------------------------------- | :-------------------------------- |
| 📖 [**Instructions**](#server-instructions)        | ✅ Supported                      |
| 🔧 [**Tools**](#tools)                             | ✅ Supported                      |
| 💬 [**Prompts**](#prompts)                         | ✅ Supported                      |
| 📦 [**Resources**](#resources)                     | ✅ Supported                      |
| 📝 [**Logging**](#server-logs)                     | ✅ Supported                      |
| 🔔 [**Notifications**](#list-change-notifications) | ✅ Supported                      |
| 📄 [**Pagination**](#pagination)                   | ✅ Supported                      |
| 🏓 [**Ping**](#ping)                               | ✅ Supported                      |
| ⏳ **Async tasks**                                 | 🚧 Planned                        |
| 📁 **Roots**                                       | 🚧 Planned                        |
| ❓ **Elicitation**                                 | 🚧 Planned                        |
| 🔤 **Completion**                                  | 🚧 Planned                        |
| 🤖 **Sampling**                                    | ❌ Not applicable (no LLM access) |

#### Server instructions

MCP servers can provide instructions describing their capabilities and usage. These are displayed when you connect to a server or run the `help` command:

```bash
# Show server info, capabilities, and instructions (both commands behave the same)
mcpc @apify
mcpc @apify help

# JSON mode
mcpc @apify --json
```

In [JSON mode](#json-mode), the resulting object adheres
to [`InitializeResult`](https://modelcontextprotocol.io/specification/latest/schema#initializeresult) object schema,
and includes the `_mcpc` field with relevant server/session metadata.

```json
{
  "_mcpc": {
    "sessionName": "@apify",
    "profileName": "default",
    "server": {
      "url": "https://mcp.apify.com"
    },
    "notifications": {
      "tools": { "listChangedAt": "2026-01-01T00:42:58.049Z" }
    }
  },
  "protocolVersion": "2025-06-18",
  "capabilities": {
    "logging": {},
    "prompts": {},
    "resources": {},
    "tools": { "listChanged": true }
  },
  "serverInfo": {
    "name": "apify-mcp-server",
    "version": "1.0.0"
  },
  "instructions": "Apify is the largest marketplace of tools for web scraping..."
}
```

#### Tools

List, inspect, and call server-provided tools:

```bash
# List available tools (only names and attributes - useful for dynamic discovery)
mcpc @apify tools-list

# List available tools (full details including input/output args and description)
mcpc @apify tools-list --full

# Get tool schema with full details
mcpc @apify tools-get search-actors

# Call a tool with arguments
mcpc @apify tools-call search-actors keywords:="web scraper"

# Pass complex JSON arguments
mcpc @apify tools-call create-task '{"name": "my-task", "options": {"memory": 1024}}'

# Load arguments from stdin
cat data.json | mcpc @apify tools-call bulk-import
```

#### Prompts

List and retrieve server-defined prompt templates:

```bash
# List available prompts
mcpc @apify prompts-list

# Get a prompt with arguments
mcpc @apify prompts-get analyze-website url:=https://example.com
```

<!-- TODO: Add example of prompt templates -->

#### Resources

Access server-provided data sources by URI:

```bash
# List available resources
mcpc @apify resources-list

# Read a resource
mcpc @apify resources-read "file:///config.json"

# Subscribe to resource changes (in shell mode)
mcpc @apify resources-subscribe "https://api.example.com/data"

# List resource templates
mcpc @apify resources-templates-list
```

#### List change notifications

When connected via a [session](#sessions), `mcpc` automatically handles `list_changed`
notifications for tools, resources, and prompts.
The bridge process tracks when each notification type was last received.
In [shell mode](#interactive-shell), notifications are displayed in real-time.
The timestamps are available in JSON output of `mcpc @session --json` under the `_mcpc.notifications`
field - see [Server instructions](#server-instructions).

#### Server logs

`mcpc` supports server logging settings (`logging/setLevel`) and log messages (`notifications/message`).
Log messages are printed to bridge log or stderr, subject to [verbosity level](#verbose-mode).

You can instruct MCP servers to adjust their [logging level](https://modelcontextprotocol.io/specification/latest/server/utilities/logging)
using the `logging-set-level` command:

```bash
# Set server log level to debug for detailed output
mcpc @apify logging-set-level debug

# Reduce server logging to only errors
mcpc @apify logging-set-level error
```

Note that this sets the logging level on the **server side**.
The actual log output depends on the server's implementation.

#### Pagination

MCP servers may return paginated results for list operations
(`tools-list`, `resources-list`, `prompts-list`, `resources-templates-list`).
`mcpc` handles this automatically and always fetches all available pages using the `nextCursor`
token - you always get the complete list without manual iteration. Keep it simple.

#### Ping

Sessions automatically send periodic pings to keep the [connection alive](#session-lifecycle) and detect failures early.
Send a ping to check if a server connection is alive:

```bash
# Ping a session and measure round-trip time
mcpc @apify ping
mcpc @apify ping --json
```

## Configuration

You can configure `mcpc` using a config file, environment variables, or command-line flags.

**Precedence** (highest to lowest):

1. Command-line flags (including `--config` option)
2. Environment variables
3. Built-in defaults

### MCP server config file

`mcpc` supports the ["standard"](https://gofastmcp.com/integrations/mcp-json-configuration)
MCP server JSON config file, compatible with Claude Desktop, VS Code, and other MCP clients.
Use the `file:entry` syntax to reference a server from a config file:

```bash
# Open a session to a server specified in the Visual Studio Code config
mcpc connect .vscode/mcp.json:apify @my-apify
mcpc @my-apify tools-list
```

**Example MCP config JSON file:**

```json
{
  "mcpServers": {
    "apify": {
      "url": "https://mcp.apify.com",
      "headers": {
        "Authorization": "Bearer ${APIFY_TOKEN}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "DEBUG": "mcp:*"
      }
    },
    "local-package": {
      "command": "node",
      "args": ["/path/to/server.js"]
    }
  }
}
```

**Server configuration properties:**

For **Streamable HTTP servers:**

- `url` (required) - MCP server endpoint URL
- `headers` (optional) - HTTP headers to include with requests
- `timeout` (optional) - Request timeout in seconds

For **stdio servers:**

- `command` (required) - Command to execute (e.g., `node`, `npx`, `python`)
- `args` (optional) - Array of command arguments
- `env` (optional) - Environment variables for the process

**Using servers from config file:**

Reference servers by their name using the `file:entry` syntax:

```bash
# Create a named session from a server in the config
mcpc connect .vscode/mcp.json:filesystem @fs
mcpc @fs tools-list
mcpc @fs tools-call search
```

**Environment variable substitution:**

Config files support environment variable substitution using `${VAR_NAME}` syntax:

```json
{
  "mcpServers": {
    "secure-server": {
      "url": "https://mcp.apify.com",
      "headers": {
        "Authorization": "Bearer ${APIFY_TOKEN}",
        "X-User-ID": "${USER_ID}"
      }
    }
  }
}
```

### Saved state

`mcpc` saves its state to `~/.mcpc/` directory (unless overridden by `MCPC_HOME_DIR`), in the following files:

- `~/.mcpc/sessions.json` - Active sessions with references to authentication profiles (file-locked for concurrent access)
- `~/.mcpc/profiles.json` - Authentication profiles (OAuth metadata, scopes, expiry)
- `~/.mcpc/wallets.json` - x402 wallet data (file permissions `0600`)
- `~/.mcpc/bridges/` - Unix domain socket files for each bridge process
- `~/.mcpc/logs/bridge-*.log` - Log files for each bridge process
- OS keychain - Sensitive credentials (OAuth tokens, bearer tokens, client secrets)

### Environment variables

- `MCPC_HOME_DIR` - Directory for session and authentication profiles data (default is `~/.mcpc`)
- `MCPC_VERBOSE` - Enable verbose logging (set to `1`, `true`, or `yes`, case-insensitive)
- `MCPC_JSON` - Enable JSON output (set to `1`, `true`, or `yes`, case-insensitive)
- `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` - Proxy URL for outbound connections (e.g. `http://proxy.example.com:8080`); `HTTPS_PROXY` takes precedence
- `NO_PROXY` / `no_proxy` - Comma-separated list of hostnames/IPs to bypass the proxy (e.g. `localhost,127.0.0.1`)

### Cleanup

You can clean up the `mcpc` state and data using the `clean` command:

```bash
# Safe non-destructive cleanup: remove expired sessions, delete old orphaned logs
mcpc clean

# Clean specific resources
mcpc clean sessions    # Kill bridges, delete all sessions
mcpc clean profiles    # Delete all authentication profiles
mcpc clean logs        # Delete all log files

# Nuclear option: remove everything
mcpc clean all         # Delete all sessions, profiles, logs, and sockets
```

## Security

`mcpc` follows [MCP security best practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices).
MCP enables arbitrary tool execution and data access - treat servers like you treat shells:

- Use least-privilege tokens/headers
- Only use trusted servers!
- Audit tools before running them

### Credential protection

| What                   | How                                             |
| ---------------------- | ----------------------------------------------- |
| **OAuth tokens**       | Stored in OS keychain, never on disk            |
| **HTTP headers**       | Stored in OS keychain per-session               |
| **Bridge credentials** | Passed via Unix socket IPC, kept in memory only |
| **Process arguments**  | No secrets visible in `ps aux`                  |
| **x402 private key**   | Stored in `wallets.json` (`0600` permissions)   |
| **Config files**       | Contain only metadata, never tokens             |
| **File permissions**   | `0600` (user-only) for all config files         |

### Network security

- HTTPS enforced for remote servers (auto-upgraded from HTTP)
- OAuth callback binds to `127.0.0.1` only
- Credentials never logged, even in verbose mode

### AI security

See [AI sandboxes](#ai-sandboxes) for details.

## Errors

`mcpc` provides clear error messages for common issues:

- **Connection failures**: Displays transport-level errors with retry suggestions
- **Session timeouts**: Automatically attempts to reconnect or prompts for session recreation
- **Invalid commands**: Shows available commands and correct syntax
- **Tool execution errors**: Returns server error messages with context
- **Bridge crashes**: Detects and cleans up orphaned processes, offers restart

### Exit codes

- `0` - Success
- `1` - Client error (invalid arguments, command not found, etc.)
- `2` - Server error (tool execution failed, resource not found, etc.)
- `3` - Network error (connection failed, timeout, etc.)
- `4` - Authentication error (invalid credentials, forbidden, etc.)

### Verbose mode

To see what's happening, enable detailed logging with `--verbose`.

```bash
mcpc --verbose @apify tools-list
```

This causes `mcpc` to print detailed debug messages to stderr.

### Logs

The background bridge processes log to `~/.mcpc/logs/bridge-@<session>.log`.
The main `mcpc` process doesn't save log files, but supports [verbose mode](#verbose-mode).
`mcpc` automatically rotates log files: keep last 10MB per session, max 5 files.

### Troubleshooting

**"Cannot connect to bridge"**

- Bridge may have crashed. Try: `mcpc @<session-name> tools-list` to restart the bridge
- Check bridge is running: `ps aux | grep -e 'mcpc-bridge' -e '[m]cpc/dist/bridge'`
- Check socket exists: `ls ~/.mcpc/bridges/`

**"Session not found"**

- List existing sessions: `mcpc`
- Create new session if expired: `mcpc @<session-name> close` and `mcpc connect <server> @<session-name>`

**"Authentication failed"**

- List saved OAuth profiles: `mcpc`
- Re-authenticate: `mcpc login <server> [--profile <name>]`
- For bearer tokens: provide `--header "Authorization: Bearer ${TOKEN}"` again

## Development

The initial version of `mcpc` was developed and [launched by Jan Curn](https://x.com/jancurn/status/2007144080959291756) of [Apify](https://apify.com)
with the help of Claude Code, during late nights over Christmas 2025 in North Beach, San Francisco.

See [CONTRIBUTING](./CONTRIBUTING.md) for development setup, architecture overview, and contribution guidelines.

## Related work

### MCP CLI clients

<!-- Stars and activity as of March 2026. -->

| Tool | Lang | Stars | Active | Tools | Resources | Prompts | Code mode | Sessions | OAuth | Stdio | HTTP | Tool search | LLM |
|---|---|--:|---|---|---|---|---|---|---|---|---|---|---|
| **[apify/mcpc](https://github.com/apify/mcpc)** | TS | ~350 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| [steipete/mcporter](https://github.com/steipete/mcporter) | TS | ~2.6k | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| [IBM/mcp-cli](https://github.com/IBM/mcp-cli) | Python | ~1.9k | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| [f/mcptools](https://github.com/f/mcptools) | Go | ~1.5k | ⚠️ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | — | — |
| [philschmid/mcp-cli](https://github.com/philschmid/mcp-cli) | TS | ~950 | ✅ | ✅ | — | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | — |
| [adhikasp/mcp-client-cli](https://github.com/adhikasp/mcp-client-cli) | Python | ~670 | ⚠️ | ✅ | ✅ | ✅ | — | — | — | ✅ | — | — | ✅ |
| [thellimist/clihub](https://github.com/thellimist/clihub) | Go | ~590 | ✅ | ✅ | — | — | — | — | ✅ | ✅ | ✅ | ✅ | — |
| [wong2/mcp-cli](https://github.com/wong2/mcp-cli) | JS | ~420 | ⚠️ | ✅ | ✅ | ✅ | — | — | ✅ | — | ✅ | — | — |
| [knowsuchagency/mcp2cli](https://github.com/knowsuchagency/mcp2cli) | Python | ~170 | ✅ | ✅ | — | — | ✅ | — | — | ✅ | ✅ | ✅ | — |
| [mcpshim/mcpshim](https://github.com/mcpshim/mcpshim) | Go | ~46 | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |
| [EstebanForge/mcp-cli-ent](https://github.com/EstebanForge/mcp-cli-ent) | Go | ~13 | ✅ | ✅ | — | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | — |

**Legend:** ✅ = supported, ⚠️ = stale (no commits in 3+ months), **LLM** = requires/uses an LLM.

**Notes:**
- [thellimist/clihub](https://github.com/thellimist/clihub) is a code generator that compiles MCP tools into standalone CLI binaries, rather than a runtime client ([HN discussion](https://news.ycombinator.com/item?id=47157398)).
- [knowsuchagency/mcp2cli](https://github.com/knowsuchagency/mcp2cli) also supports OpenAPI specs directly and uses a custom TOON encoding for token-efficient tool schemas.
- [IBM/mcp-cli](https://github.com/IBM/mcp-cli) and [mcp-client-cli](https://github.com/adhikasp/mcp-client-cli) integrate an LLM (Ollama, OpenAI, etc.) for chat-style interaction, while the other tools are pure CLI clients.

### Code mode and dynamic tool discovery

These resources describe the "code mode" pattern (replacing many tool definitions with `search` + `execute`) and dynamic tool discovery:

- [Code mode](https://www.anthropic.com/engineering/code-execution-with-mcp) - Anthropic's blog post on code execution with MCP
- [Code mode at Cloudflare](https://blog.cloudflare.com/code-mode/) - Cloudflare's implementation of the code mode pattern
- [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) - Anthropic's engineering post on tool search
  - [Claude tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) - Claude platform docs
- [Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery) - Cursor's approach to dynamic tool discovery
- [cmcp](https://github.com/assimelha/cmcp) (~27 stars, Rust) - MCP proxy aggregating servers behind `search()` + `execute()`
- [cloudflare-mcp](https://github.com/mattzcarey/cloudflare-mcp) (~124 stars, TS) - MCP server for the Cloudflare API using code mode
- [infinite-mcp](https://github.com/day50-dev/infinite-mcp) (Python) - Meta-MCP server that exposes 1000+ pre-indexed MCP servers via semantic search and dynamic tool discovery

### Other

- [mcpGraph](https://github.com/TeamSparkAI/mcpGraph) - MCP server that orchestrates directed graphs of MCP tool calls

## License

Apache-2.0 - see [LICENSE](./LICENSE) for details.
