
# TODOs


## NEW


- the README should show explain each command, show the full options from "mcpc help command" - perhaps this could be on start of the readme,
  with links to the more detailed sections below


- mcp-cli inspiration
Add glob-based tool search across all servers like `mcpc grep *mail*` or `mcpc grep *@session/mail*`.
    Consider making `tools-list` more succinct for discovery.
  Use https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool for inspiration/compatibility?
- 

      $ mcpc grep "*file*"
      $ mcpc grep "@github/*"
      $ mcpc grep -F "anything really"
  
RETURNS
      @github
        - create_or_update_file(name: string, )
      @filesystem
        - read_file
      @filesystem
        - write_file

Then we can have
$ mcpc @github tools-call get_file_contents arg:="yes" # NOW
$ mcpc @github/get_file_contents arg:="yes"  # NEW



## Bugs !

...


## UX/AX

- MAYBE LATER:
  Connects to all entries from file - the
  $ mcpc connect ~/.vscode/mcp.json:puppeteer @puppeteer
  $ mcpc connect ~/.vscode/mcp.json
  $ mcpc connect  # Auto-discovery of existing MCP configs like mcporter

- Make "mcpc connect mcp.apify.com" work without @session, and generate session name on best effort basis (e.g. use the main hostname without TLD 
+ suffix)


- Show tools also when running just "mcpc @apify"

- mcpc @apify tools-get fetch-actor-details => should print also "object" properties in human mode

- mcpc @apify tools-call xxx --help / "mcpc @apify/xxx --help" should print tools-get + command info

## Later


- `--capabilities '{"tools":...,"prompts":...}"` to limit access to selected MCP features and tools,
  for both proxy and normal session, for simplicity. The command could work on the fly, to give
  agents less room to wiggle.
  


## Code mode
- Emit tools to dirs ("codegen" variant?) - see https://cursor.com/blog/dynamic-context-discovery - generate skills file too?
- feature: enable generation of TypeScript stubs based on the server schema, with access to session and schema validation, for TS code mode.
  For simplicity they an just "mcpc" command, later we can use IPC for more efficiency.


# Misc


- sign -r <b64> Sign payment from PAYMENT-REQUIRED header  - why the "-r" is needed?


## Nice to have

- $ mcpc @apify tools-call search-apify-docs query:="test"
  Should skip `structuredContent` in results if there is `content` with "type": "text", and print it as text. AI agents can use --json


- Implement resources-subscribe/resources-unsubscribe, --o file command properly, --max-size
  automatically update the -o file on changes, without it just keep track of changed files in
  bridge process' cache, and report in resources-list/resources-read operatio

- Add support for "mcpc close @session", "mcpc restart @session" and "mcpc shell @session" - add to docs
  
- Add ASCII diagrams to README to help explain major concepts: tool calling, auth, bridge process, etc.
  For inspiration, see https://github.com/philschmid/mcp-cli

- "login" and "logout" commands could work also with file:entry and @session, just use the remote server URL from the config file or session host.
  it would make "connect" and "login" command consistent.
- Restart of expired OAuth session is too many steps - why not add "mcpc login  <session>" to refresh? 

- revise the session states: maybe introduce new session status `auth-failed` or `unauthed` (or some better name?)
  consider forking "alive" session state to "alive" and "disconnected", to indicate the remote server is not responding but bridge 
  runs fine. We can use lastSeenAt + ping interval info for that, or status of last ping.

- ux: Be even more forgiving with `args:=x`, when we know from tools/prompt schema the text is compatible with `x` even if the exact type is not - 
  just re-type it dynamically to make it work.
- nit: Cooler OAuth flow finish web page with CSS animation, add Apify example there, show mcpc info. E.g. next step - check Apify rather than close
- security: For auth profiles, fetch the detailed user info via http, save to profiles.json and show in 'mcpc', ensure the info is up-to-date
- later: Add unique Session.id and Profile.id and use it for OS keychain keys, to truly enable using multiple independent mcpc profiles.
- nit: Implement typing tab-completions (e.g. "mcpc @ap...") - not sure if that's even possible
- Consider adding `--dry-run` https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/
- Show protocolVersion also for stdio - but for that we need to update the SDK to save it! See setProtocolVersion

- nit: show also header / open auth statuses for HTTP servers?

- consider adding --idle-timeout to "connect" and then automatically disconnet from remote server, to avoid handing infinitely
