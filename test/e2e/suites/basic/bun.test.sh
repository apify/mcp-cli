#!/bin/bash
# Test: mcpc works under the Bun runtime
# Skipped automatically if bun is not installed.
#
# When run standalone this sets MCPC to use bun directly.
# When run via `./run.sh --runtime bun`, E2E_RUNTIME=bun is already set by the
# runner and framework.sh picks it up; the explicit override below is a no-op.

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/bun"

# Skip entire test suite if bun is not available
if ! command -v bun &>/dev/null; then
  echo "# Bun not installed, skipping"
  test_case "bun runtime (skipped - bun not installed)"
  test_skip "bun not installed"
  test_done
fi

BUN_VERSION=$(bun --version)
echo "# Bun version: $BUN_VERSION"

# Ensure all mcpc invocations in this file use bun (for standalone runs)
MCPC="bun $PROJECT_ROOT/dist/cli/index.js"

# Start test server (still uses Node/tsx - it's the remote MCP server, not the client)
start_test_server

# Test: --version works under Bun
test_case "bun: --version works"
run_mcpc --version
assert_success
if [[ ! "$STDOUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  test_fail "version should be semver format, got: $STDOUT"
  exit 1
fi
test_pass

# Test: --help works under Bun
test_case "bun: --help works"
run_mcpc --help
assert_success
assert_contains "$STDOUT" "Usage:"
assert_contains "$STDOUT" "mcpc"
test_pass

# Test: --json output works under Bun
test_case "bun: --version --json works"
run_mcpc --version --json
assert_success
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.version'
test_pass

# Create a session to use for session-based tests
BUN_SESSION=$(session_name "bun")
run_mcpc connect "$TEST_SERVER_URL" "$BUN_SESSION" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$BUN_SESSION")

# Test: tools-list via session
test_case "bun: tools-list (session)"
run_xmcpc "$BUN_SESSION" tools-list
assert_success
assert_contains "$STDOUT" "echo"
test_pass

# Test: tools-call via session
test_case "bun: tools-call (session)"
run_mcpc "$BUN_SESSION" tools-call echo 'message:=hello from bun'
assert_success
assert_contains "$STDOUT" "hello from bun"
test_pass

# Test: resources-list via session
test_case "bun: resources-list (session)"
run_xmcpc "$BUN_SESSION" resources-list
assert_success
test_pass

# Test: JSON mode via session
test_case "bun: tools-list --json (session)"
run_mcpc --json "$BUN_SESSION" tools-list
assert_success
assert_json_valid "$STDOUT"
test_pass

# =============================================================================
# Keychain path: create a session with a bearer token.
# mcpc stores the token in the OS keychain (via @napi-rs/keyring) on connect,
# then reads it back on every subsequent command.  This exercises the native
# keyring add-on under the Bun runtime.
# =============================================================================

test_case "bun: session with bearer token (keychain write)"
SESSION=$(session_name "bearer")
run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true" --header "Authorization: Bearer testtoken-bun-$$"
assert_success
test_pass

test_case "bun: session tools-list (keychain read)"
run_xmcpc "$SESSION" tools-list
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "bun: session tools-call (keychain read)"
run_mcpc "$SESSION" tools-call echo 'message:=hello from bun session'
assert_success
assert_contains "$STDOUT" "hello from bun session"
test_pass

test_case "bun: session close"
run_mcpc "$SESSION" close
assert_success
test_pass

test_done
