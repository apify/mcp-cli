
# TODOs


## Bugs !

Unauthenticated session to sentry MCP keeps showing as live, but it should be expired.

$ mcpc @dumy**                                                                                                            ✔
[@dumy → https://mcp.sentry.dev/mcp (HTTP)]

Error: Authentication required by server.

To authenticate, run:
mcpc https://mcp.sentry.dev/mcp login

Then recreate the session:
mcpc https://mcp.sentry.dev/mcp session @dumy

$ mcpc                                                                                                                4 ✘
MCP sessions:
@fss → npx -y @modelcontextprotocol/server-filesystem /Users/jancurn/Projects/mcpc (stdio) ● live
@fs → npx -y @modelcontextprotocol/server-filesystem /Users/jancurn/Projects/mcpc (stdio) ● live
@dumy → https://mcp.sentry.dev/mcp (HTTP) ● live

Available OAuth profiles:
mcp.notion.com / default, refreshed 1 weeks ago
mcp.apify.com / default, created 58m ago

Run "mcpc --help" for usage information.



- mcpc @session --timeout ... / mcpc @session <cmd> --timeout ... has no effect

- createSessionProgram() advertises --header and --profile options for mcpc @session ..., but these values are never applied: withMcpClient()/SessionClient ignore headers/profile overrides and always use the session’s stored config. This is misleading for users and makes it easy to think a command is authenticated/modified when it isn’t. Either wire these options into session execution (e.g. by updating/restarting the session/bridge) or remove them from the session program/help.

- parseServerArg() splits config entries using the first : (arg.indexOf(':')). This breaks Windows paths with drive letters (e.g. C:\Users\me\mcp.json:filesystem), which would be parsed as file=C entry=\Users\.... Consider special-casing ^[A-Za-z]:[\\/] and/or using lastIndexOf(':') for the file/entry delimiter to keep Windows paths working


## x402
- sign -r <b64> Sign payment from PAYMENT-REQUIRED header  - why the "-r" is needed?

## NEW

- mcp-cli inspiration
Add glob-based tool search across all servers like `mcpc grep *mail*` or `mcpc grep *@session/mail*`.
    Consider making `tools-list` more succinct for discovery.
  Use https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool for inspiration/compatibility?
      $ mcpc grep "*file*"
      $ mcpc grep "@github/*"
      $ mcpc grep -F "anything really"
  
RETURNS
      @github/create_or_update_file
      @filesystem/read_file
      @filesystem/write_file

Then we can have
$ mcpc call @github/get_file_contents arg:="yes"

or maybe just?
$ mcpc @session/tool arg:="yes"
support also (undocumented)
$ mcpc @session:tool




## Later

$ mcpc @apify tools-call search-apify-docs query:="test"
Should skip `structuredContent` in results if there is `content` with "type": "text", and print it as text. AI agents can use --json


- `--capabilities '{"tools":...,"prompts":...}"` to limit access to selected MCP features and tools,
  for both proxy and normal session, for simplicity. The command could work on the fly, to give
  agents less room to wiggle.
- Implement resources-subscribe/resources-unsubscribe, --o file command properly, --max-size
  automatically update the -o file on changes, without it just keep track of changed files in
  bridge process' cache, and report in resources-list/resources-read operatio


- MAYBE LATER:
Connects to all entries from file - the
NOW: $ mcpc connect ~/.vscode/mcp.json:puppeteer @puppeteer
$ mcpc connect ~/.vscode/mcp.json
$ mcpc connect


- add support for OAuth `--client-id XXX` and `--client-secret YYY` for servers that don't have DCR !!!
  and equally, we should add `--header XXX` to save logins via HTTP header

## Code mode
- Emit tools to dirs ("codegen" variant?) - see https://cursor.com/blog/dynamic-context-discovery - generate skills file too?
- feature: enable generation of TypeScript stubs based on the server schema, with access to session and schema validation, for TS code mode.
  For simplicity they an just "mcpc" command, later we can use IPC for more efficiency.


# Misc

- Ensure "logging-set-level" works well

- Restart of expires OAuth session is too many steps - why not add "mcpc <session> login" to refresh?
- Tool list server refresh - let's print it to stderr on first time after it happens, so the agent/user would notice there are new tools


## Nice to have

- Add support for "mcpc close @session", "mcpc restart @session" and "mcpc shell @session" - add to docs

- mcpc @apify tools-get fetch-actor-details => should print also "object" properties in human mode

- Add ASCII diagrams to README to help explain major concepts: tool calling, auth, bridge process, etc.

- "login" and "logout" commands could work also with file:entry, just use the remote server URL

- maybe introduce new session status: auth failed or unauthed
  ux: consider forking "alive" session state to "alive" and "disconnected", to indicate the remote server is not responding but bridge 
  runs fine. We can use lastSeenAt + ping interval info for that, or status of last ping.
- ux: Be even more forgiving with `args:=x`, when we know from tools/prompt schema the text is compatible with `x` even if the exact type is not - 
  just re-type it dynamically to make it work.
- nit: Cooler OAuth flow finish web page with CSS animation, add Apify example there, show mcpc info. E.g. next step - check Apify rather than close
- security: For auth profiles, fetch the detailed user info via http, save to profiles.json and show in 'mcpc', ensure the info is up-to-date
- later: Add unique Session.id and Profile.id and use it for OS keychain keys, to truly enable using multiple independent mcpc profiles. Use cry
- nit: Implement typing completions (e.g. "mcpc @ap...") - not sure if that's even possible
- later: maybe add --no-color option to disable chalk
- Consider adding --dry-run https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/ 
- Auto-discovery of existing MCP configs like mcporter
- Show protocolVersion also for stdio - but for that we need to update the SDK to save it! See setProtocolVersion

- nit: show also header / open auth statuses for HTTP servers?


