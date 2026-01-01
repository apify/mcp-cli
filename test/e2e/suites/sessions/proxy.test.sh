#!/bin/bash
# Test: Proxy server for AI isolation
# Tests the --proxy option that creates a secondary MCP server
# that forwards requests without exposing original auth tokens

source "$(dirname "$0")/../../lib/framework.sh"
test_init "sessions/proxy"

# Start test server
start_test_server

# Generate unique session names
SESSION_UPSTREAM=$(session_name "proxy-upstream")
SESSION_DOWNSTREAM=$(session_name "proxy-downstream")

# Find an available port for proxy
PROXY_PORT=$((8100 + RANDOM % 100))

# Test: connect with --proxy option creates session with proxy server
test_case "connect with --proxy creates session"
run_mcpc "$TEST_SERVER_URL" connect "$SESSION_UPSTREAM" --proxy "$PROXY_PORT"
assert_success "connect with --proxy should succeed"
assert_contains "$STDOUT" "created"
_SESSIONS_CREATED+=("$SESSION_UPSTREAM")
test_pass

# Wait for proxy server to start
sleep 1

# Test: session shows proxy info
test_case "session shows proxy info in list"
run_mcpc --json
assert_success
session_info=$(json_get ".sessions[] | select(.name == \"$SESSION_UPSTREAM\")")
assert_not_empty "$session_info" "session should exist"
proxy_host=$(echo "$session_info" | jq -r '.proxyConfig.host // empty')
proxy_port=$(echo "$session_info" | jq -r '.proxyConfig.port // empty')
assert_eq "$proxy_host" "127.0.0.1" "proxy host should be 127.0.0.1"
assert_eq "$proxy_port" "$PROXY_PORT" "proxy port should match"
test_pass

# Test: proxy health endpoint works
test_case "proxy health endpoint responds"
health_response=$(curl -s "http://127.0.0.1:$PROXY_PORT/health" 2>/dev/null || echo "CURL_FAILED")
if [[ "$health_response" == "CURL_FAILED" ]]; then
  test_fail "could not connect to proxy health endpoint"
  exit 1
fi
assert_contains "$health_response" "ok" "health endpoint should return ok"
test_pass

# Test: can connect to proxy as MCP server (localhost defaults to http://)
test_case "connect to proxy server"
run_mcpc "127.0.0.1:$PROXY_PORT" connect "$SESSION_DOWNSTREAM"
assert_success "connect to proxy should succeed"
_SESSIONS_CREATED+=("$SESSION_DOWNSTREAM")
test_pass

# Test: tools-list works through proxy
test_case "tools-list works via proxy"
run_mcpc "$SESSION_DOWNSTREAM" tools-list
assert_success
assert_contains "$STDOUT" "echo"
test_pass

# Test: tools-call works through proxy
test_case "tools-call works via proxy"
run_mcpc "$SESSION_DOWNSTREAM" tools-call echo 'message:=proxied message'
assert_success
assert_contains "$STDOUT" "proxied message"
test_pass

# Test: close downstream session
test_case "close downstream session"
run_mcpc "$SESSION_DOWNSTREAM" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION_DOWNSTREAM}")
test_pass

# Test: close upstream session (also stops proxy)
test_case "close upstream session"
run_mcpc "$SESSION_UPSTREAM" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION_UPSTREAM}")
test_pass

# Test: proxy no longer available after upstream close
test_case "proxy unavailable after close"
health_response=$(curl -s --max-time 2 "http://127.0.0.1:$PROXY_PORT/health" 2>/dev/null || echo "CURL_FAILED")
assert_eq "$health_response" "CURL_FAILED" "proxy should be unavailable after close"
test_pass

test_done
