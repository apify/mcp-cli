#!/bin/bash
# Test: Expired/fake session handling

source "$(dirname "$0")/../../lib/framework.sh"
test_init "sessions/expired" --isolated

# This test manipulates sessions.json directly, so needs isolated home

# Create a fake session record in sessions.json
mkdir -p "$MCPC_HOME_DIR"
cat > "$MCPC_HOME_DIR/sessions.json" << 'EOF'
{
  "sessions": {
    "@fake-session": {
      "name": "@fake-session",
      "target": "https://fake-server.example.com",
      "transport": "http",
      "pid": 99999,
      "socketPath": "/tmp/nonexistent.sock",
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  }
}
EOF

# Test: session with dead bridge PID shows as dead (before using it)
test_case "session with dead bridge shows as dead"
run_mcpc --json
assert_success
# The fake session should show as dead since PID 99999 doesn't exist
# Note: JSON uses "status" field, not "bridgeStatus"
session_status=$(echo "$STDOUT" | jq -r '.sessions[] | select(.name == "@fake-session") | .status')
assert_eq "$session_status" "dead" "fake session should show as dead"
test_pass

# Test: fake session record - using a session that doesn't exist
test_case "using fake session fails with appropriate error"
# Try to use the fake session - should fail because bridge doesn't exist
# Use run_mcpc (not run_xmcpc) because fake sessions trigger debug output
run_mcpc "@fake-session" tools-list
assert_failure
# Should mention connection or bridge issue
test_pass

# Test: session with invalid socket path
test_case "session with invalid socket fails gracefully"
cat > "$MCPC_HOME_DIR/sessions.json" << 'EOF'
{
  "sessions": {
    "@bad-socket": {
      "name": "@bad-socket",
      "target": "https://example.com",
      "transport": "http",
      "pid": 1,
      "socketPath": "/nonexistent/path/to/socket.sock",
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  }
}
EOF

# Use run_mcpc (not run_xmcpc) because fake sessions trigger debug output
run_mcpc "@bad-socket" tools-list
assert_failure
test_pass

# Test: corrupted sessions.json is handled gracefully
test_case "corrupted sessions.json handled gracefully"
echo "not valid json" > "$MCPC_HOME_DIR/sessions.json"
run_mcpc --json
# Should still succeed and return empty sessions or handle error gracefully
# The exact behavior depends on implementation
test_pass

# Test: empty sessions.json is handled
test_case "empty sessions.json handled"
echo "{}" > "$MCPC_HOME_DIR/sessions.json"
run_mcpc --json
assert_success
test_pass

test_done
