
# TODOs

## Bugs
...


## Next

- Expand --help to use same text as in README, add link to README

BIG: We need to decide whether to show Markdown-ish or not

- Do not use Markdown formatting

# MCP features

- Implement resources-subscribe/resources-unsubscribe, --o file command properly, --max-size
  automatically update the -o file on changes, without it just keep track of changed files in bridge process' cache, and report in resources-list
- Add `--proxy [HOST:]PORT` feature to `connect` command to enable MCP proxy:
  - `--proxy-bearer-token X` to require auth token for better security
  - `--proxy-capabilities tools:TOOL_NAME,TOOL_NAME2,...,prompts[:...],...` to limit access to selected MCP features and tools
    (what if tools have ":" or "," in their names?)
    In theory, we could add limit of capabilities to normal sessions, but the LLM could still break out of it, so what's the point.
  - Explain this is useful for AI sandboxing!
- Add support for MCP elicitations, and potentially for sampling (e.g. via shell interface?)
- In tools-list, let's show simplified args on tool details view, e.g. read_text_file
   • Tool: `write_file` [destructive, idempotent]
   Input:
     path: string
     tail: number - If provided, returns only the last N lines of the file
     Output: N/A
  Description:
  Text...
  
## Security
- Double-check the MCP security guidelines
- OAuth issuer - maybe save it and double-check it to ensure domain is not spoofed?

## Later


- Implement "mcpc @session restart" .. and how about "mcpc <server> connect @session" ?

- nit: Colorize output, e.g. JSONs in one color. MCP provided data like descriptions and instructions in orange.
  -  warnings could be orange, errors red
- nit: Cooler OAuth flow finish web page with CSS animation, add Apify example there, show mcpc info. E.g. next step - check Apify rather than close
- For auth profiles, fetch the detailed user info via http, ensure the info is up-to-date

- audit that on every command, we print next steps as examples
- add more shortcuts, e.g. --profile => -p
- nit: in README, explain the MCP commands better in a standlone section, with details how they work
- Add unique Session.id and Profile.id and use it for OS keychain keys, to truly enable using multiple independent mcpc profiles
- When user runs --clean=profiles, print warning if some sessions were using them 

- nit: Implement typing completions (e.g. "mcpc @a...") - not sure how difficult that is





## E2E test scenarios
- DONE?: add end-to-end tests e.g. under `test/e2e` - one bash script per test suite , organized in directories,and one master script that runs them all or selected ones (per directory) in parallel

Now, let's finish a proper E2E testing infrastructure. Here are main features:
- For each test run, create a new dir to avoid interaction with normal local "mcpc" use and other tests (e.g. `test/runs/123`).
  Add mcpc home dir to it, and save there logs from tests (one test per log file).
  - Ensure when we create sessions, they are unique to avoid OS keychain conflicts, e.g. `test-123-sessionx`
  - If needed, we can create/copy testing artefacts in this dir too
  - Save there logs from tests (one test per log file), in the same dir structure as they are in e2e, to make it easy to find
- Create two commands for testing "mcpc" and "xmcpc" - the latter is to test the main invariants:
  - --verbose only adds extra info to stderr, never to stdout
  - --json always returns single JSON object to stdout on success (exit code = 0), or an object or nothing at all on error (exit code != 0)
  Note: There will be cases when we need to just test "mcpc" without the invariants, hence two commands. We can either use alias (if it stays local)
  or mcpc.sh/xmcpc.sh. Figure out the best way, which makes it easy to write tests.

- For testing we can use these MCP servers we can use:
  - https://mcp.apify.com (for testing real OAuth login, we can create various accounts, both OAuth and API tokens)
  - https://mcp.apify.com/tools=docs (anonymous, no auth needed)
  - https://mcp.sentry.dev/mcp (for testing if no auth profile available)
  - We'll need a testing MCP server with all the available features and configurable, for testing, on localhost. Maybe there is something in MCP SDK?
- To set up the testing, the user will have to create OAuth profiles, by running "mcpc <server> login". Let's assume we'll have the following profiles available for tests:
  - 

- The exact text output in non-json mode can change, but we should ensure in the tests the core text are there, including copy from MCP server.
- Ideally, "npm run test:coverage" would also work with e2e tests (it doesn't seem so). Not sure if that's easily possible - if not, we can use some Node-based bash runtime later for that.
- Here are some test scenarios, for inspiration to understand the structure. More will come:
  - handling of errors, invalid params, names, etc.
  - pagination
  - env vars...
  - stdio + filesystem operations
  - sessions
  - test stdio transport with fs mcp server
  - test expired session (create fake record in session.json) - ensure attempts to use it will fail with the right error
  - for all commands, tests --verbose doesn't print anything extra to stdout, --json returns json
  - that on session close we send HTTP DELETE https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management
  - Test session failover - e.g. kill the bridge process, and try to access the session again - should be restarted, work, and have same MCP-Session-Id
  - Test auth - if no profile available and server requires OAuth, we need to fail with info what to do! e.g. "mcpc https://mcp.sentry.dev/mcp --verbose"
  - Test server session aborting - if session is aborted by server, bridge process should exit and set session status to "expired"
  - Test auth profiles work long-term and sessions too - basically when running some tests the next day they should use old saved auths and sessions
  - Test "mcpc @test close" and "mcpc <server> session @test" in rapid succession, it should work and use different pid (check sessions.json)
  - Ensure calling invalid/unknown MCP command in shell and normally doesn't causes the bridge to be flagged as expired or dead

Now deeply review current e2e testing setup, and update it to conform with the above. The main goal is to make it really easy to write individual tests, without too much fluff.
The test suite should clean up after itself when done, in particular delete session info from OS keychain.
If everything is clear, you can go ahead with implementation of the testing framework and add a few simple tests before we continue with the other scenarios.
If something is not clear and decisions need to be made, ask me. Good luck!
  
