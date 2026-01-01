#!/bin/bash
# Test: Stdio transport with filesystem MCP server

source "$(dirname "$0")/../../lib/framework.sh"
test_init "stdio/filesystem"

# Create a config file for the filesystem server
CONFIG=$(create_fs_config "$TEST_TMP")

# =============================================================================
# Test: One-shot commands (direct connection, no session)
# =============================================================================

test_case "one-shot: server info via stdio"
run_mcpc --config "$CONFIG" fs
assert_success
assert_contains "$STDOUT" "Capabilities:"
test_pass

test_case "one-shot: ping via stdio"
run_mcpc --config "$CONFIG" fs ping
assert_success
assert_contains "$STDOUT" "Ping successful"
test_pass

test_case "one-shot: ping --json via stdio"
run_mcpc --json --config "$CONFIG" fs ping
assert_success
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.durationMs'
test_pass

test_case "one-shot: tools-list via stdio"
run_xmcpc --config "$CONFIG" fs tools-list
assert_success
assert_contains "$STDOUT" "read_file"
assert_contains "$STDOUT" "write_file"
test_pass

test_case "one-shot: tools-list --json via stdio"
run_mcpc --json --config "$CONFIG" fs tools-list
assert_success
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '. | type == "array"'
assert_json "$STDOUT" '. | length > 0'
test_pass

# Note: Filesystem server doesn't support resources or prompts,
# so we skip those one-shot tests here. They are tested in basic/resources.test.sh
# and basic/prompts.test.sh using the test server which supports all MCP features.

test_case "one-shot: help via stdio"
run_mcpc --config "$CONFIG" fs help
assert_success
assert_contains "$STDOUT" "Available commands:"
test_pass

# Create test file for one-shot tool call
echo "One-shot test content" > "$TEST_TMP/oneshot.txt"

test_case "one-shot: tools-call read_file via stdio"
run_xmcpc --config "$CONFIG" fs tools-call read_file "path:=$TEST_TMP/oneshot.txt"
assert_success
assert_contains "$STDOUT" "One-shot test content"
test_pass

test_case "one-shot: tools-call --json via stdio"
run_mcpc --json --config "$CONFIG" fs tools-call read_file "path:=$TEST_TMP/oneshot.txt"
assert_success
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.content'
test_pass

# =============================================================================
# Test: Session-based commands
# =============================================================================

# Generate unique session name
SESSION=$(session_name "fs")

# Test: create session with stdio config
test_case "create session with stdio config"
run_mcpc --config "$CONFIG" fs session "$SESSION"
assert_success
_SESSIONS_CREATED+=("$SESSION")
test_pass

# Test: session shows stdio transport (has command field, no url field)
# Note: Use run_mcpc because session list is non-deterministic in parallel tests
# (timestamps change, other tests create sessions). Invariant tested separately.
test_case "session shows stdio transport"
run_mcpc --json
command=$(json_get ".sessions[] | select(.name == \"$SESSION\") | .serverConfig.command")
assert_not_empty "$command" "command should be present for stdio transport"
test_pass

# Test: list tools via stdio session
test_case "tools-list works via stdio session"
run_xmcpc "$SESSION" tools-list
assert_success
assert_contains "$STDOUT" "read_file"
test_pass

# Test: create test file
test_case "create test file"
echo "Hello from E2E test!" > "$TEST_TMP/test.txt"
test_pass

# Test: read file via MCP (read-only tool, safe for run_xmcpc)
test_case "read file via MCP"
run_xmcpc "$SESSION" tools-call read_file "path:=$TEST_TMP/test.txt"
assert_success
assert_contains "$STDOUT" "Hello from E2E test"
test_pass

# Test: list directory via MCP (output includes temp files with random names, use run_mcpc)
test_case "list directory via MCP"
run_mcpc "$SESSION" tools-call list_directory "path:=$TEST_TMP"
assert_success
assert_contains "$STDOUT" "test.txt"
test_pass

# Test: write file via MCP
test_case "write file via MCP"
run_mcpc "$SESSION" tools-call write_file "path:=$TEST_TMP/written.txt" "content:=Written via MCP"
assert_success
test_pass

# Test: verify written file
test_case "verify written file"
content=$(cat "$TEST_TMP/written.txt")
assert_eq "$content" "Written via MCP"
test_pass

# Test: close session
test_case "close session"
run_mcpc "$SESSION" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")
test_pass

test_done
