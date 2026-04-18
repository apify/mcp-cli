#!/bin/bash
# Test: OAuth client_credentials grant (machine-to-machine authentication)
#
# Verifies that:
# 1. mcpc login --grant client-credentials discovers the token endpoint and obtains a token
# 2. The resulting profile has authType: oauth-client-credentials
# 3. Sessions using the profile can authenticate and call tools
# 4. --json mode returns the expected structure
# 5. Validation rejects bad flag combinations
# 6. Credentials don't leak in verbose output

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/client-credentials" --isolated

# Start test server with auth required (enables /token and /.well-known endpoints)
start_test_server REQUIRE_AUTH=true

# =============================================================================
# Test: login with client_credentials grant
# =============================================================================

test_case "login --grant client-credentials succeeds"
run_mcpc login "$TEST_SERVER_URL" \
  --grant client-credentials \
  --client-id test-client \
  --client-secret test-secret
assert_success
assert_contains "$STDOUT" "Authentication successful"
test_pass

test_case "login --grant client-credentials creates oauth-client-credentials profile"
profiles_file="$MCPC_HOME_DIR/profiles.json"
if [[ ! -f "$profiles_file" ]]; then
  test_fail "profiles.json not found"
  exit 1
fi
auth_type=$(jq -r '.profiles["localhost:'"$TEST_SERVER_PORT"'"].default.authType // empty' "$profiles_file")
if [[ "$auth_type" != "oauth-client-credentials" ]]; then
  test_fail "Expected authType 'oauth-client-credentials', got '$auth_type'"
  exit 1
fi
# Verify token endpoint was cached
token_ep=$(jq -r '.profiles["localhost:'"$TEST_SERVER_PORT"'"].default.tokenEndpoint // empty' "$profiles_file")
if [[ -z "$token_ep" ]]; then
  test_fail "tokenEndpoint should be cached in profile"
  exit 1
fi
test_pass

test_case "login --grant client-credentials JSON output"
run_mcpc login "$TEST_SERVER_URL" \
  --grant client-credentials \
  --client-id test-client \
  --client-secret test-secret \
  --json
assert_success
assert_json_valid "$STDOUT"
grant=$(echo "$STDOUT" | jq -r '.grant // empty')
if [[ "$grant" != "client-credentials" ]]; then
  test_fail "Expected grant 'client-credentials' in JSON output, got '$grant'"
  exit 1
fi
test_pass

# =============================================================================
# Test: connect and use session with client_credentials profile
# =============================================================================

test_case "session using client_credentials profile can list tools"
SESSION=$(session_name "cc-sess")
run_mcpc connect "$TEST_SERVER_URL" "$SESSION"
assert_success
_SESSIONS_CREATED+=("$SESSION")

# Wait for bridge to be ready
wait_for "$MCPC $SESSION ping >/dev/null 2>&1"

run_mcpc "$SESSION" tools-list
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "session using client_credentials profile can call tools"
run_mcpc "$SESSION" tools-call echo message:=hello
assert_success
assert_contains "$STDOUT" "hello"
test_pass

# =============================================================================
# Test: --grant client-credentials with scope
# =============================================================================

test_case "login --grant client-credentials with --scope"
run_mcpc login "$TEST_SERVER_URL" \
  --grant client-credentials \
  --client-id test-client \
  --client-secret test-secret \
  --scope "tools:read tools:write" \
  --profile scoped
assert_success
# Check profile has scopes
scopes=$(jq -r '.profiles["localhost:'"$TEST_SERVER_PORT"'"].scoped.scopes // [] | join(" ")' "$profiles_file")
if [[ "$scopes" != "tools:read tools:write" ]]; then
  test_fail "Expected scopes 'tools:read tools:write', got '$scopes'"
  exit 1
fi
test_pass

# =============================================================================
# Test: validation errors
# =============================================================================

test_case "login --grant client-credentials without --client-id fails"
run_mcpc login "$TEST_SERVER_URL" --grant client-credentials --client-secret sec
assert_failure
assert_contains "$STDERR" "requires both --client-id and --client-secret"
test_pass

test_case "login --grant client-credentials without --client-secret fails"
run_mcpc login "$TEST_SERVER_URL" --grant client-credentials --client-id cid
assert_failure
assert_contains "$STDERR" "requires both --client-id and --client-secret"
test_pass

test_case "login --grant invalid is rejected"
run_mcpc login "$TEST_SERVER_URL" --grant foo
assert_failure
assert_contains "$STDERR" "Invalid --grant"
test_pass

test_case "login --token-endpoint without --grant client-credentials is rejected"
run_mcpc login "$TEST_SERVER_URL" --token-endpoint https://example.com/token
assert_failure
assert_contains "$STDERR" "--token-endpoint is only supported with --grant client-credentials"
test_pass

test_case "login --grant client-credentials with --client-metadata-url is rejected"
run_mcpc login "$TEST_SERVER_URL" \
  --grant client-credentials \
  --client-id cid \
  --client-secret sec \
  --client-metadata-url https://example.com/meta.json
assert_failure
assert_contains "$STDERR" "not supported with --grant client-credentials"
test_pass

# =============================================================================
# Test: wrong credentials fail
# =============================================================================

test_case "login --grant client-credentials with wrong secret fails"
run_mcpc login "$TEST_SERVER_URL" \
  --grant client-credentials \
  --client-id test-client \
  --client-secret wrong-secret \
  --profile bad
assert_failure
assert_contains "$STDERR" "invalid"
test_pass

# =============================================================================
# Test: credentials don't leak in verbose output
# =============================================================================

test_case "client secret does not appear in verbose output"
run_mcpc login "$TEST_SERVER_URL" \
  --grant client-credentials \
  --client-id test-client \
  --client-secret test-secret \
  --verbose
assert_success
# The secret should never appear in stderr (verbose logs go to stderr)
if echo "$STDERR" | grep -q "test-secret"; then
  test_fail "Client secret leaked in verbose output"
  exit 1
fi
test_pass

# =============================================================================
# Test: --help documents --grant flag
# =============================================================================

test_case "login --help documents --grant client-credentials"
run_mcpc help login
assert_success
assert_contains "$STDOUT" "--grant"
assert_contains "$STDOUT" "client-credentials"
assert_contains "$STDOUT" "--token-endpoint"
test_pass

test_done
