#!/bin/bash
# Test: Inline stdio command for `mcpc connect` (issue #163)
#
# Covers both surface forms (heuristic quoted string + `--` separator),
# auto-generated session names, session reuse, and flag-validation errors.
#
# The flag-validation tests run first because they don't actually spawn any
# child process (the connect action rejects the flags before launching).

source "$(dirname "$0")/../../lib/framework.sh"
test_init "stdio/inline-command"

SHORT="$_TEST_SHORT_ID"
NATIVE_TMP="$(to_native_path "$TEST_TMP")"

# A bogus path is fine for flag-validation tests since the connect action rejects
# the incompatible flag before attempting to spawn anything.
INLINE_CMD="echo unused-but-must-have-spaces"

# =============================================================================
# Flag-validation errors (no MCP connection, no spawning)
# =============================================================================

# Test 1: --profile cannot be combined with inline command
test_case "--profile rejected with inline command"
run_mcpc connect "$INLINE_CMD" "@e-${SHORT}-bad" --profile default
assert_failure
assert_contains "$STDERR" "--profile"
test_pass

# Test 2: --header cannot be combined with inline command
test_case "--header rejected with inline command"
run_mcpc connect "$INLINE_CMD" "@e-${SHORT}-bad" --header "X-Test: 1"
assert_failure
assert_contains "$STDERR" "--header"
test_pass

# Test 3: --x402 cannot be combined with inline command
test_case "--x402 rejected with inline command"
run_mcpc connect "$INLINE_CMD" "@e-${SHORT}-bad" --x402
assert_failure
assert_contains "$STDERR" "--x402"
test_pass

# Test 4: combining a server arg with `--` is rejected
test_case "combining server arg with -- is rejected"
run_mcpc connect mcp.apify.com -- node dist/foo.js
assert_failure
assert_contains "$STDERR" "Cannot combine"
test_pass

# Test 5: `--` with no trailing tokens is rejected
test_case "-- with no command is rejected"
run_mcpc connect "@e-${SHORT}-bad" --
assert_failure
assert_contains "$STDERR" "must be followed"
test_pass

# Test 6: `--` outside connect is rejected
test_case "-- outside connect is rejected"
run_mcpc tools-list -- something
assert_failure
assert_contains "$STDERR" "only supported with 'connect'"
test_pass

# =============================================================================
# Real stdio connect via inline command (requires npx + network)
# =============================================================================

# Test 7: heuristic form with explicit @session
SESSION1="@e-${SHORT}-h1"
test_case "heuristic form: connect with explicit @session"
run_mcpc connect "npx -y @modelcontextprotocol/server-filesystem $NATIVE_TMP" "$SESSION1"
assert_success
_SESSIONS_CREATED+=("$SESSION1")
test_pass

# Test 8: tools-list works via heuristic-form session
test_case "heuristic form: tools-list works"
run_mcpc "$SESSION1" tools-list
assert_success
assert_contains "$STDOUT" "read_file"
test_pass

# Test 9: session shows stdio transport (command field present, no url)
test_case "heuristic form: session shows stdio transport"
run_mcpc --json
command_field=$(echo "$STDOUT" | jq -r ".sessions[] | select(.name == \"$SESSION1\") | .server.command")
assert_eq "$command_field" "npx" "command field should be 'npx' for inline stdio session"
url_field=$(echo "$STDOUT" | jq -r ".sessions[] | select(.name == \"$SESSION1\") | .server.url // empty")
assert_eq "$url_field" "" "url field should be empty for stdio session"
test_pass

# Test 10: re-running identical heuristic connect reuses the session ("already active")
test_case "heuristic form: identical re-run reuses session"
run_mcpc connect "npx -y @modelcontextprotocol/server-filesystem $NATIVE_TMP" "$SESSION1"
assert_success
assert_contains "$STDOUT" "already active"
test_pass

# Test 11: close the heuristic-form session
test_case "close heuristic-form session"
run_mcpc "$SESSION1" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION1}")
test_pass

# Test 12: `--` form with explicit @session
SESSION2="@e-${SHORT}-d1"
test_case "-- form: connect with explicit @session"
run_mcpc connect "$SESSION2" -- npx -y @modelcontextprotocol/server-filesystem "$NATIVE_TMP"
assert_success
_SESSIONS_CREATED+=("$SESSION2")
test_pass

# Test 13: tools-list via `--`-form session
test_case "-- form: tools-list works"
run_mcpc "$SESSION2" tools-list
assert_success
assert_contains "$STDOUT" "read_file"
test_pass

# Test 14: close the `--`-form session
test_case "close -- form session"
run_mcpc "$SESSION2" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION2}")
test_pass

test_done
