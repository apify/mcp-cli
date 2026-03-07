# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `--client-id` and `--client-secret` options for `mcpc login` command, for servers that don't support dynamic client registration
- `mcpc close @session`, `mcpc restart @session`, and `mcpc shell @session` command-first syntax as alternatives to `mcpc @session close/restart/shell`
- E2E tests now run under the Bun runtime (in addition to Node.js); use `./test/e2e/run.sh --runtime bun` or `npm run test:e2e:bun`

### Changed
- **Breaking:** CLI syntax redesigned to command-first style. All commands now start with a verb; MCP operations require a named session.

  | Before                                        | After |
  |-----------------------------------------------|-------|
  | `mcpc <server> tools-list`                    | `mcpc connect <server> @name` then `mcpc @name tools-list` |
  | `mcpc <server> connect @name`                    | `mcpc connect <server> @name` |
  | `mcpc <server> login`                            | `mcpc login <server>` |
  | `mcpc <server> logout`                           | `mcpc logout <server>` |
  | `mcpc --clean=sessions`                       | `mcpc clean sessions` |
  | `mcpc --config file.json entry connect @name` | `mcpc connect file.json:entry @name` |

  Direct one-shot URL access (e.g. `mcpc mcp.apify.com tools-list`) is removed; create a session first with `mcpc connect`.

- `@napi-rs/keyring` native addon is now loaded lazily: `mcpc` starts and works normally even when `libsecret` (Linux) or the addon itself is missing; a one-time warning is emitted and credentials fall back to `~/.mcpc/credentials.json` (mode 0600)

## [0.1.10] - 2026-03-01

### Added
- Support for `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` / lowercase variants env vars for outbound connections
- CI/CD automated test pipeline

### Changed
- Replaced deprecated `keytar` package with `@napi-rs/keyring` for OS keychain integration
- Temp files now written to `~/.mcpc/` instead of `/tmp/` to avoid cross-device rename errors on Linux
- Improved error messages for invalid server hostnames and mistyped commands (e.g. `mcpc login`)
- Added `prettier` formatting check to lint step

### Fixed
- Fixed `ExperimentalWarning: Importing JSON modules is an experimental feature` on Node.js 22+
- Fixed OAuth token refresh for servers with root-based discovery (`.well-known` at `/`)
- Fixed OAuth errors incorrectly expiring the session instead of failing gracefully

## [0.1.9] - 2026-02-02

### Added
- Added CHANGELOG.md for tracking changes
- Automated GitHub release creation in publish script

### Changed
- `tools-list` now shows a compact summary by default to support dynamic tool discovery
- Added `--full` flag to `tools-list` for detailed tool information
- Publish script now automatically updates CHANGELOG.md version on release

## [0.1.8] - 2026-01-21

### Changed
- Session is now marked as expired (not auto-reconnected) when server rejects MCP session ID
- Users must explicitly run `mcpc @session restart` to recover from expired sessions

### Fixed
- Fixed incorrect flagging of expired sessions as crashed
- Fixed session expiration detection for various error message formats
- Fixed help command output

## [0.1.7] - 2026-01-03

### Changed
- Documentation improvements and updates
- Various cosmetic improvements to CLI output

### Fixed
- Minor bug fixes

## [0.1.6] - 2026-01-02

### Added
- Session notifications with timestamps for tracking list changes (`tools/list_changed`, `resources/list_changed`, `prompts/list_changed`)

### Changed
- Renamed `_meta` to `_mcpc` in JSON output for MCP spec conformance
- Improved formatting of prompts output
- Various cosmetic improvements

### Fixed
- Fixed proxy server issues
- Fixed screenshot URL in README

## [0.1.5] - 2026-01-01

### Added
- Implemented `--proxy` option for exposing sessions as local MCP servers
- Added `mcpc @session restart` command

### Changed
- Renamed `session` command to `connect` for clarity
- Renamed "dead" session status to "crashed" for clarity

### Fixed
- Fixed `--timeout` option handling

## [0.1.4] - 2025-12-31

### Added
- Implemented `--schema` and `--schema-mode` options for tools
- Added `mcpc @session restart` command

### Changed
- Renamed `tools-schema` command to `tools-get`
- Improved formatting for prompts and tools output
- Security review and improvements

## [0.1.3] - 2025-12-29

### Added
- Initial public release
- Support for Streamable HTTP and stdio transports
- Session management with persistent bridge processes
- OAuth 2.1 authentication with PKCE
- Full MCP protocol support: tools, resources, prompts
- Interactive shell mode
- JSON output mode for scripting

[Unreleased]: https://github.com/apify/mcpc/compare/v0.1.10...HEAD
[0.1.10]: https://github.com/apify/mcpc/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/apify/mcpc/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/apify/mcpc/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/apify/mcpc/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/apify/mcpc/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/apify/mcpc/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/apify/mcpc/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/apify/mcpc/releases/tag/v0.1.3
