#!/bin/bash
# Test: Session failover (bridge crash recovery)

source "$(dirname "$0")/../../lib/framework.sh"
test_init "sessions/failover"

# Start test server
start_test_server

# Generate unique session name
SESSION=$(session_name "failover")

# Test: create session for failover test
test_case "create session for failover test"
run_mcpc "$TEST_SERVER_URL" connect "$SESSION"
assert_success
_SESSIONS_CREATED+=("$SESSION")
test_pass

# Test: get bridge PID
test_case "get bridge PID"
# Use run_mcpc (not run_xmcpc) because session list can change between runs
run_mcpc --json
bridge_pid=$(json_get ".sessions[] | select(.name == \"$SESSION\") | .pid")
assert_not_empty "$bridge_pid" "should have bridge PID"
test_pass

# Test: verify session works before killing
test_case "session works before kill"
run_xmcpc "$SESSION" tools-list
assert_success
test_pass

# Test: kill bridge process
test_case "kill bridge process"
kill "$bridge_pid" 2>/dev/null || true
sleep 1

# Verify it's no longer running
if kill -0 "$bridge_pid" 2>/dev/null; then
  test_fail "bridge should not be running"
  exit 1
fi
test_pass

# Test: session shows as crashed
test_case "session shows as crashed after bridge kill"
run_mcpc --json
session_status=$(json_get ".sessions[] | select(.name == \"$SESSION\") | .status")
assert_eq "$session_status" "crashed" "session should show as crashed"
test_pass

# Test: using crashed session attempts restart but server rejects old session ID
# This is correct behavior - session should be marked as expired, not auto-reconnected
test_case "using crashed session fails when server rejects session ID"
run_xmcpc "$SESSION" tools-list
# This should FAIL because server rejects the old session ID
# and session is marked as expired (not auto-reconnected)
if [[ "$EXIT_CODE" -eq 0 ]]; then
  test_fail "expected command to fail when server rejects session ID"
  exit 1
fi
test_pass

# Test: session is marked as expired (not live)
test_case "session marked as expired after rejection"
run_mcpc --json
session_status=$(json_get ".sessions[] | select(.name == \"$SESSION\") | .status")
assert_eq "$session_status" "expired" "session should be marked as expired"
test_pass

# Test: explicit restart recovers from expired session
test_case "explicit restart recovers from expired session"
run_mcpc "$SESSION" restart
assert_success
test_pass

# Test: session is live again after explicit restart
test_case "session is live after explicit restart"
run_mcpc --json
session_status=$(json_get ".sessions[] | select(.name == \"$SESSION\") | .status")
assert_eq "$session_status" "live" "session should be live after restart"
test_pass

# Test: commands work after explicit restart
test_case "commands work after explicit restart"
run_xmcpc "$SESSION" tools-list
assert_success "commands should work after explicit restart"
assert_contains "$STDOUT" "echo"
test_pass

# Test: new PID is different
test_case "bridge has new PID after restart"
run_mcpc --json
new_pid=$(json_get ".sessions[] | select(.name == \"$SESSION\") | .pid")
if [[ "$new_pid" == "$bridge_pid" ]]; then
  test_fail "PID should be different after restart"
  exit 1
fi
test_pass

test_done
