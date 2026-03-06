#!/bin/bash
# Test: HTTPS_PROXY / HTTP_PROXY environment variable support

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/env-proxy"

start_test_server
start_proxy_server

# =============================================================================
# HTTP_PROXY routes requests through proxy
# =============================================================================

test_case "HTTP_PROXY routes requests through proxy"
SESSION=$(session_name "proxy-http")
HTTP_PROXY="$PROXY_URL" run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true"
assert_success "connect with HTTP_PROXY should succeed"
_SESSIONS_CREATED+=("$SESSION")
run_mcpc "$SESSION" tools-list
assert_success
assert_contains "$STDOUT" "echo"
run_mcpc "$SESSION" close >/dev/null 2>&1
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")
test_pass

# =============================================================================
# HTTPS_PROXY does not affect HTTP connections (scheme-specific proxy selection)
# =============================================================================

test_case "HTTPS_PROXY does not affect HTTP connections"
# HTTPS_PROXY points to a dead port; HTTP_PROXY points to working proxy
# Since MCP server URL is HTTP, only HTTP_PROXY should be used — should succeed
SESSION=$(session_name "proxy-https")
HTTPS_PROXY="http://127.0.0.1:1" HTTP_PROXY="$PROXY_URL" run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$SESSION")
run_mcpc "$SESSION" tools-list
assert_success
assert_contains "$STDOUT" "echo"
run_mcpc "$SESSION" close >/dev/null 2>&1
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")
test_pass

# =============================================================================
# Invalid proxy causes connection failure (proves requests are actually proxied)
# =============================================================================

test_case "invalid proxy causes connection failure"
SESSION=$(session_name "proxy-broken")
HTTP_PROXY="http://127.0.0.1:1" run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true"
if [[ $EXIT_CODE -eq 0 ]]; then
  # Connect might succeed (session created, bridge started), but tools-list should fail
  run_xmcpc "$SESSION" tools-list
  assert_failure
  run_mcpc "$SESSION" close 2>/dev/null || true
else
  # Connect itself failed due to proxy — also a valid failure
  assert_failure
fi
test_pass

test_done
