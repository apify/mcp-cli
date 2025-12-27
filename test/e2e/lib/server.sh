#!/bin/bash
# Test server management helpers
# Source this after common.sh when you need a test MCP server

# ============================================================================
# Test Server Management
# ============================================================================

# Default test server port (can be overridden per suite)
TEST_SERVER_PORT="${TEST_SERVER_PORT:-13456}"
TEST_SERVER_PID=""

# Start the test MCP server (HTTP transport)
# Usage: start_test_server [port]
# Environment variables to configure server:
#   TEST_SERVER_PAGINATION_SIZE - items per page (0 = no pagination)
#   TEST_SERVER_LATENCY_MS - artificial latency
#   TEST_SERVER_REQUIRE_AUTH - require authorization header
start_test_server() {
  local port="${1:-$TEST_SERVER_PORT}"

  # Build environment for test server
  local env_vars=""
  env_vars+="PORT=$port "
  env_vars+="PAGINATION_SIZE=${TEST_SERVER_PAGINATION_SIZE:-0} "
  env_vars+="LATENCY_MS=${TEST_SERVER_LATENCY_MS:-0} "
  env_vars+="REQUIRE_AUTH=${TEST_SERVER_REQUIRE_AUTH:-false} "

  # Start server in background (using tsx for TypeScript)
  cd "$PROJECT_ROOT"
  env $env_vars npx tsx test/e2e/server/index.ts &
  TEST_SERVER_PID=$!

  # Wait for server to be ready
  local max_wait=10
  local waited=0
  while ! curl -s "http://localhost:$port/health" >/dev/null 2>&1; do
    sleep 0.2
    ((waited++)) || true
    if [[ $waited -ge $((max_wait * 5)) ]]; then
      echo "Error: Test server failed to start on port $port"
      kill $TEST_SERVER_PID 2>/dev/null || true
      exit 1
    fi
  done

  echo "# Test server started on port $port (PID: $TEST_SERVER_PID)"
  export TEST_SERVER_URL="http://localhost:$port"
}

# Stop the test server
stop_test_server() {
  if [[ -n "$TEST_SERVER_PID" ]]; then
    kill "$TEST_SERVER_PID" 2>/dev/null || true
    wait "$TEST_SERVER_PID" 2>/dev/null || true
    echo "# Test server stopped"
    TEST_SERVER_PID=""
  fi
}

# Ensure server is stopped on exit
_cleanup_server() {
  stop_test_server
}

# Add to existing trap (don't override cleanup_test)
trap '_cleanup_server; cleanup_test' EXIT

# ============================================================================
# Test Server Control API
# ============================================================================

# Make the server fail the next N requests
# Usage: server_fail_next [count]
server_fail_next() {
  local count="${1:-1}"
  curl -s -X POST "$TEST_SERVER_URL/control/fail-next?count=$count" >/dev/null
}

# Expire the current session (triggers 404 on next request)
server_expire_session() {
  curl -s -X POST "$TEST_SERVER_URL/control/expire-session" >/dev/null
}

# Reset server state
server_reset() {
  curl -s -X POST "$TEST_SERVER_URL/control/reset" >/dev/null
}

# ============================================================================
# Stdio Server Helpers
# ============================================================================

# Create a config file for stdio server
# Usage: create_stdio_config <name> <command> [args...]
create_stdio_config() {
  local name="$1"
  local command="$2"
  shift 2
  local args=("$@")

  local config_file="$TEST_TMP/config-$name.json"
  local args_json=$(printf '%s\n' "${args[@]}" | jq -R . | jq -s .)

  cat > "$config_file" <<EOF
{
  "mcpServers": {
    "$name": {
      "command": "$command",
      "args": $args_json
    }
  }
}
EOF

  echo "$config_file"
}

# Create config for filesystem server (commonly used for stdio tests)
# Usage: create_fs_server_config [allowed_path]
create_fs_server_config() {
  local allowed_path="${1:-$TEST_TMP}"
  create_stdio_config "fs" "npx" "-y" "@modelcontextprotocol/server-filesystem" "$allowed_path"
}
