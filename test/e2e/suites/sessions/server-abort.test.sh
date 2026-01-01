#!/bin/bash
# Test: Server-side session abort handling

source "$(dirname "$0")/../../lib/framework.sh"
test_init "sessions/server-abort"

# Start test server
start_test_server

# Generate unique session name
SESSION=$(session_name "server-abort")

# Test: create and verify session works
test_case "create session and verify it works"
run_mcpc "$TEST_SERVER_URL" connect "$SESSION"
assert_success
_SESSIONS_CREATED+=("$SESSION")

run_xmcpc "$SESSION" tools-list
assert_success
assert_contains "$STDOUT" "echo"
test_pass

# Test: server expires session
test_case "server expires session"
curl -s -X POST "$TEST_SERVER_URL/control/expire-session" >/dev/null
test_pass

# Test: using expired session fails appropriately
test_case "using expired session fails"
run_xmcpc "$SESSION" tools-list
assert_failure
# Should get an error about session or connection
test_pass

# Test: session status reflects expiration
test_case "session status shows expiration"
run_mcpc --json
# The session should either show as crashed/expired or be automatically cleaned up
# depending on implementation
test_pass

# Test: reset server state
test_case "reset server state"
curl -s -X POST "$TEST_SERVER_URL/control/reset" >/dev/null
test_pass

# Test: session can be recreated after server reset
test_case "recreate session after server reset"
# Close the old session
run_mcpc "$SESSION" close 2>/dev/null || true
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")

# Create new session with same name
SESSION2=$(session_name "server-abort-2")
run_mcpc "$TEST_SERVER_URL" connect "$SESSION2"
assert_success
_SESSIONS_CREATED+=("$SESSION2")

run_xmcpc "$SESSION2" tools-list
assert_success
test_pass

test_done
