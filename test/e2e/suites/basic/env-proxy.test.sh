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
HTTP_PROXY="$PROXY_URL" run_mcpc "$TEST_SERVER_URL" tools-list
assert_success
assert_contains "$STDOUT" "echo"
test_pass

# =============================================================================
# HTTPS_PROXY does not affect HTTP connections (scheme-specific proxy selection)
# =============================================================================

test_case "HTTPS_PROXY does not affect HTTP connections"
# HTTPS_PROXY points to a dead port; HTTP_PROXY points to working proxy
# Since MCP server URL is HTTP, only HTTP_PROXY should be used — should succeed
HTTPS_PROXY="http://127.0.0.1:1" HTTP_PROXY="$PROXY_URL" run_mcpc "$TEST_SERVER_URL" tools-list
assert_success
assert_contains "$STDOUT" "echo"
test_pass

# =============================================================================
# Invalid proxy causes connection failure (proves requests are actually proxied)
# =============================================================================

test_case "invalid proxy causes connection failure"
HTTP_PROXY="http://127.0.0.1:1" run_xmcpc "$TEST_SERVER_URL" tools-list
assert_failure
test_pass

test_done
