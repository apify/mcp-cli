#!/bin/bash
# Test: --header flag on session commands sends headers per-request
# Headers must reach the server on the request that specifies them,
# and must NOT leak to subsequent requests without --header.

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/per-request-header"

start_test_server

SESSION=$(create_session "$TEST_SERVER_URL" "hdr")

# =============================================================================
# Test: --header is sent to the server on a session command
# =============================================================================

test_case "--header value reaches the server"
run_mcpc "$SESSION" tools-call echo message:=hello --header "X-Custom-Test: per-request-value-123"
assert_success
assert_contains "$STDOUT" "hello"

# Inspect the headers the server saw on the last MCP request
LAST_HEADERS=$(curl -s "$TEST_SERVER_URL/control/last-mcp-headers")
if ! echo "$LAST_HEADERS" | grep -q "per-request-value-123"; then
  test_fail "X-Custom-Test header not received by server. Got: $LAST_HEADERS"
fi
test_pass

# =============================================================================
# Test: headers do NOT leak to the next request without --header
# =============================================================================

test_case "headers do not leak to subsequent requests"
run_mcpc "$SESSION" ping
assert_success

LAST_HEADERS=$(curl -s "$TEST_SERVER_URL/control/last-mcp-headers")
if echo "$LAST_HEADERS" | grep -q "per-request-value-123"; then
  test_fail "X-Custom-Test header leaked to subsequent request! Got: $LAST_HEADERS"
fi
test_pass

# =============================================================================
# Test: multiple --header flags work together
# =============================================================================

test_case "multiple --header flags are sent"
run_mcpc "$SESSION" tools-list --header "X-First: aaa" --header "X-Second: bbb"
assert_success

LAST_HEADERS=$(curl -s "$TEST_SERVER_URL/control/last-mcp-headers")
if ! echo "$LAST_HEADERS" | grep -q "aaa"; then
  test_fail "X-First header not received by server"
fi
if ! echo "$LAST_HEADERS" | grep -q "bbb"; then
  test_fail "X-Second header not received by server"
fi
test_pass

# =============================================================================
# Test: --header with --json mode works
# =============================================================================

test_case "--header works with --json mode"
run_mcpc "$SESSION" --json tools-call echo message:=json-test --header "X-Json-Mode: yes"
assert_success
assert_json_valid "$STDOUT"

LAST_HEADERS=$(curl -s "$TEST_SERVER_URL/control/last-mcp-headers")
if ! echo "$LAST_HEADERS" | grep -q "X-Json-Mode"; then
  # Header names are lowercased by HTTP
  if ! echo "$LAST_HEADERS" | grep -q "x-json-mode"; then
    test_fail "X-Json-Mode header not received by server"
  fi
fi
test_pass

test_done
