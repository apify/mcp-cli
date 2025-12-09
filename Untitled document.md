# **mcp2cli**

Wrap any **remote or local MCP server** as a friendly, scriptable **command-line tool** — with **real sessions**.

`mcp2cli` speaks the **Model Context Protocol (MCP) 2025-11-25** over standard transports (Streamable HTTP \+ stdio), maps MCP concepts to intuitive CLI commands, and uses a **bridge process per session** so you can keep multiple MCP connections alive simultaneously. [Model Context Protocol+2Model Context Protocol+2](https://modelcontextprotocol.io/specification/2025-11-25?utm_source=chatgpt.com)

---

## **Why a bridge process?**

MCP is **stateful**: clients and servers negotiate capabilities during initialization and then communicate within a **session**. On HTTP transports, servers can issue an `MCP-Session-Id`, and can send asynchronous messages via SSE streams; disconnects are not cancellations and resuming streams uses `Last-Event-ID`. [Model Context Protocol+2Model Context Protocol+2](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com)

So instead of forcing every command to “reconnect and reinitialize”, `mcp2cli` can run a lightweight **bridge** that:

* keeps the session warm (incl. session id / negotiated protocol version), [Model Context Protocol+1](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com)

* manages SSE streams and resumption, [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com)

* multiplexes multiple concurrent requests,

* lets you run **many servers at once** and pipe outputs between them.

---

## **Install**

`npm i -g mcp2cli`

---

## **Quickstart**

### **1\) Run a one-shot command (ephemeral session)**

`mcp2cli -H "Authorization: Basic $API_KEY" https://mcp.apify.com?params=1 tools list`  
`mcp2cli https://mcp.apify.com?params=1 search-actors --query="tiktok scraper"`

### **2\) Create a persistent session (bridge) and reuse it**

`mcp2cli connect --name apify -H "Authorization: Basic $API_KEY" https://mcp.apify.com?params=1`  
`mcp2cli use apify tools list`  
`mcp2cli use apify search-actors --query="tiktok scraper"`

### **3\) Interactive shell (like `ssh` / `sftp`)**

`mcp2cli shell https://mcp.apify.com?params=1`  
`# or attach to an existing session`  
`mcp2cli shell --session apify`

---

## **Servers you can target**

`<server>` can be one of:

* **Remote MCP endpoint URL** (Streamable HTTP)  
   `https://example.com/mcp`

* **Local MCP server package** (stdio)  
   `@microsoft/playwright-mcp`

* **Named entry in a config file** (via `--config`)  
   `mcp2cli --config ~/.../claude_desktop_config.json my-server tools list`

* **A config file path** as the first positional argument  
   `mcp2cli ~/.../claude_desktop_config.json tools list`

Transports are selected automatically: HTTP URLs use the MCP HTTP transport; local packages are spawned and spoken to over stdio. [Model Context Protocol+1](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com)

---

## **Command model (maps MCP features)**

### **Discoverability**

`mcp2cli help`  
`mcp2cli --version`  
`mcp2cli <server> help`

`<server> help` prints server info (from server instructions/metadata when available) and shows available tools/resources/prompts. [Model Context Protocol+1](https://modelcontextprotocol.io/specification/2025-11-25?utm_source=chatgpt.com)

### **Tools**

`mcp2cli <server> tools list`  
`mcp2cli <server> tools get <name>`  
`mcp2cli <server> <tool-name> [tool-args...]`

### **Resources**

`mcp2cli <server> resources list`  
`mcp2cli <server> resources get <uri>`  
`mcp2cli <server> resources get <uri> -o ./file`

### **Prompts**

`mcp2cli <server> prompts list`  
`mcp2cli <server> prompts get <name> [--arg key=val ...]`

### **Tasks (progress \+ cancellation)**

`mcp2cli <server> tasks list`  
`mcp2cli <server> tasks watch <task-id>`  
`mcp2cli <server> tasks cancel <task-id>`

Cancellation is explicit (disconnecting does **not** imply cancellation in MCP HTTP transports). [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com)

---

## **Sessions & concurrency**

### **Session lifecycle**

`mcp2cli connect <server> [--name NAME] [global flags...]`  
`mcp2cli ls-sessions`  
`mcp2cli use <NAME|ID> <command...>`  
`mcp2cli disconnect <NAME|ID>`

### **Multiple servers at once**

`mcp2cli connect --name apify  https://mcp.apify.com?params=1`  
`mcp2cli connect --name other  https://other.example/mcp`

`mcp2cli use apify tools list`  
`mcp2cli use other tools list`

### **Pipe results between servers**

Use `--json` for machine-readable output:

`mcp2cli --session apify some-tool --json \`  
  `| mcp2cli --session other other-tool --input @stdin`

---

## **Global flags (common)**

* `-H, --header "K: V"` – add HTTP header(s) (repeatable)

* `--config <path>` – load server definitions from an MCP config file

* `--session <name|id>` – run a command against an existing session

* `--json` – print raw JSON output

* `-v, --verbose` – debug logs

---

## **Protocol notes (MCP 2025-11-25)**

* `mcp2cli` negotiates protocol version on init; subsequent HTTP requests include the negotiated `MCP-Protocol-Version`. [Model Context Protocol+1](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com)

* For Streamable HTTP, the bridge manages SSE streams, reconnection, and optional `Last-Event-ID` resumption. [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com)

* `mcp2cli` supports MCP server features (tools/resources/prompts) and handles server-initiated flows where possible (e.g., progress/logging/cancellation). [Model Context Protocol+1](https://modelcontextprotocol.io/specification/2025-11-25?utm_source=chatgpt.com)

---

## **Security**

MCP enables arbitrary tool execution and data access; treat servers like you treat shells:

* use least-privilege tokens/headers,

* prefer trusted endpoints,

* audit what tools do before running them. [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25?utm_source=chatgpt.com)

---

## **Status**

`mcp2cli` is under active development. Contributions welcome:

* transport compatibility tests (Streamable HTTP \+ stdio),

* UX polish (completion, help output),

* session persistence and secure credential storage.

