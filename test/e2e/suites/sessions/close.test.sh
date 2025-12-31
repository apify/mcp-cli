#!/bin/bash
# Test: Session close behavior (HTTP DELETE)

source "$(dirname "$0")/../../lib/framework.sh"
test_init "sessions/close"

# Start test server
start_test_server

# Test: graceful close sends HTTP DELETE to server
test_case "graceful close sends HTTP DELETE to server"

# Reset server state to clear any previous deleted sessions
curl -s -X POST "$TEST_SERVER_URL/control/reset" >/dev/null

# Create session
SESSION=$(session_name "close-delete")
run_mcpc "$TEST_SERVER_URL" session "$SESSION"
assert_success
_SESSIONS_CREATED+=("$SESSION")

# Use the session to establish MCP session with server
run_xmcpc "$SESSION" tools-list
assert_success

# Get the MCP session ID from the session info
run_mcpc "$SESSION" --json
assert_success
mcp_session_id=$(echo "$STDOUT" | jq -r '.mcpSessionId // empty')

# Close the session gracefully
run_mcpc "$SESSION" close
assert_success

# Check that the server received a DELETE for this session
deleted_sessions=$(curl -s "$TEST_SERVER_URL/control/get-deleted-sessions" | jq -r '.deletedSessions[]')

# If we had an MCP session ID, verify it was deleted
if [[ -n "$mcp_session_id" ]]; then
  if echo "$deleted_sessions" | grep -q "$mcp_session_id"; then
    test_pass
  else
    test_fail "Server did not receive DELETE for MCP session ID: $mcp_session_id (deleted: $deleted_sessions)"
    exit 1
  fi
else
  # If no MCP session ID was captured, at least verify some DELETE was sent
  if [[ -n "$deleted_sessions" ]]; then
    test_pass
  else
    test_fail "Server did not receive any DELETE requests"
    exit 1
  fi
fi

# Remove from cleanup list since we already closed it
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")

# Test: session is removed from sessions list after close
test_case "session is removed from sessions list after close"
# Use run_mcpc (not run_xmcpc) because session list can change between runs
run_mcpc --json
assert_success
session_exists=$(echo "$STDOUT" | jq -r ".sessions[] | select(.name == \"$SESSION\") | .name")
assert_empty "$session_exists" "session should not exist after close"
test_pass

# Test: rapid close/create same session name
test_case "rapid close/create same session name"
# Reset server state
curl -s -X POST "$TEST_SERVER_URL/control/reset" >/dev/null

SESSION2=$(session_name "rapid")
for i in 1 2 3; do
  run_mcpc "$TEST_SERVER_URL" session "$SESSION2"
  assert_success "iteration $i: create should succeed"
  run_mcpc "$SESSION2" close
  assert_success "iteration $i: close should succeed"
done
test_pass

# Test: close non-existent session fails gracefully
test_case "close non-existent session fails gracefully"
run_mcpc "@nonexistent-session-$RANDOM" close
assert_failure
test_pass

test_done
