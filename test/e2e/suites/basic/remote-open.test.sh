#!/bin/bash
# Test: Open remote MCP server (no authentication required)
# Tests connectivity to mcp.apify.com/tools=docs which is publicly accessible

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/remote-open" --isolated

# Remote server URL (open, no auth required)
# The ?tools=docs parameter selects the documentation tools subset, ensuring no auth is needed
REMOTE_SERVER="https://mcp.apify.com?tools=docs"

# =============================================================================
# Setup: Create dummy auth profile for open server
# =============================================================================
# mcpc requires an auth profile for HTTP servers, but this server doesn't
# need authentication. Create a minimal profile to satisfy mcpc.

test_case "setup: create dummy profile for open server"
profiles_file="$MCPC_HOME_DIR/profiles.json"
mkdir -p "$MCPC_HOME_DIR"

# Extract hostname from URL for profile key
server_host="mcp.apify.com"

cat > "$profiles_file" << EOF
{
  "profiles": {
    "$server_host": {
      "default": {
        "name": "default",
        "serverUrl": "$REMOTE_SERVER",
        "authType": "none",
        "createdAt": "2025-01-01T00:00:00Z"
      }
    }
  }
}
EOF
test_pass

# =============================================================================
# Test: Direct connection without authentication
# =============================================================================

test_case "connect to open remote server"
# Note: Using run_mcpc instead of run_xmcpc because remote server output
# may vary between calls (non-deterministic ordering, dynamic data)
run_mcpc "$REMOTE_SERVER"
assert_success
assert_contains "$STDOUT" "Apify"
test_pass

test_case "tools-list returns tools"
run_mcpc "$REMOTE_SERVER" tools-list
assert_success
assert_not_empty "$STDOUT"
test_pass

test_case "tools-list --json returns valid JSON array"
run_mcpc --json "$REMOTE_SERVER" tools-list
assert_success
assert_json_valid "$STDOUT"
# JSON output is a direct array of tools
assert_json "$STDOUT" '. | type == "array"'
assert_json "$STDOUT" '. | length > 0'
test_pass

test_case "ping succeeds"
run_mcpc "$REMOTE_SERVER" ping
assert_success
test_pass

# =============================================================================
# Test: Session with open server
# =============================================================================

test_case "create session without authentication"
SESSION=$(session_name "open")
run_mcpc "$REMOTE_SERVER" session "$SESSION"
assert_success
_SESSIONS_CREATED+=("$SESSION")
test_pass

test_case "session tools-list works"
run_mcpc "$SESSION" tools-list
assert_success
assert_not_empty "$STDOUT"
test_pass

test_case "session ping works"
run_mcpc "$SESSION" ping
assert_success
test_pass

test_case "session info shows server capabilities"
run_mcpc "$SESSION"
assert_success
assert_contains "$STDOUT" "Capabilities:"
test_pass

# =============================================================================
# Test: Close session
# =============================================================================

test_case "close session"
run_mcpc "$SESSION" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")
test_pass

test_done
