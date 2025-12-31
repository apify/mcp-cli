#!/bin/bash
# Test: OAuth authentication with remote MCP server (mcp.apify.com)
# Prerequisites: OAuth profiles must be set up (see test/README.md)
#   mcpc mcp.apify.com login --profile e2e-test1
#   mcpc mcp.apify.com login --profile e2e-test2

source "$(dirname "$0")/../../lib/framework.sh"
test_init "auth/oauth-remote"

# Remote server URL
REMOTE_SERVER="mcp.apify.com"
PROFILE1="e2e-test1"
PROFILE2="e2e-test2"

# =============================================================================
# Helper: Check if OAuth profile exists
# =============================================================================

check_profile_exists() {
  local profile="$1"
  # Check profiles.json for the profile
  local profiles_file="$HOME/.mcpc/profiles.json"
  if [[ ! -f "$profiles_file" ]]; then
    return 1
  fi

  # Check if profile exists for this server
  if jq -e ".profiles[\"https://$REMOTE_SERVER\"][\"$profile\"]" "$profiles_file" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# =============================================================================
# Prerequisite check: OAuth profiles must exist
# =============================================================================

test_case "prerequisite: check OAuth profile $PROFILE1 exists"
if ! check_profile_exists "$PROFILE1"; then
  # Write setup reminder file for the test runner to display
  mkdir -p "$_TEST_RUN_DIR"
  cat > "$_TEST_RUN_DIR/.setup_required" << EOF
OAuth E2E tests require authentication profiles to be configured.

To set up the required profiles, run:

  mcpc $REMOTE_SERVER login --profile $PROFILE1
  mcpc $REMOTE_SERVER login --profile $PROFILE2

You'll need a free Apify account: https://console.apify.com/sign-up
EOF

  test_skip "OAuth profile '$PROFILE1' not configured"

  # Skip all remaining tests
  test_case "prerequisite: check OAuth profile $PROFILE2 exists"
  test_skip "Skipped due to missing $PROFILE1"

  test_done
fi
test_pass

test_case "prerequisite: check OAuth profile $PROFILE2 exists"
if ! check_profile_exists "$PROFILE2"; then
  # Write setup reminder file for the test runner to display
  mkdir -p "$_TEST_RUN_DIR"
  cat > "$_TEST_RUN_DIR/.setup_required" << EOF
OAuth E2E tests require authentication profiles to be configured.

To set up the required profiles, run:

  mcpc $REMOTE_SERVER login --profile $PROFILE2

You'll need a free Apify account: https://console.apify.com/sign-up
EOF

  test_skip "OAuth profile '$PROFILE2' not configured"
  test_done
fi
test_pass

# =============================================================================
# Test: Direct connection with OAuth profile
# =============================================================================

test_case "direct connection with OAuth profile shows server info"
run_mcpc "$REMOTE_SERVER" --profile "$PROFILE1"
assert_success
assert_contains "$STDOUT" "Apify"
test_pass

test_case "tools-list with OAuth returns tools"
run_xmcpc "$REMOTE_SERVER" tools-list --profile "$PROFILE1"
assert_success
# Apify MCP server should have some tools
assert_not_empty "$STDOUT"
test_pass

test_case "tools-list --json returns valid JSON with tools array"
run_mcpc --json "$REMOTE_SERVER" tools-list --profile "$PROFILE1"
assert_success
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.tools'
assert_json "$STDOUT" '.tools | length > 0'
test_pass

# =============================================================================
# Test: Session with OAuth profile
# =============================================================================

test_case "create session with OAuth profile"
SESSION1=$(session_name "oauth1")
run_mcpc "$REMOTE_SERVER" session "$SESSION1" --profile "$PROFILE1"
assert_success
_SESSIONS_CREATED+=("$SESSION1")
test_pass

test_case "session tools-list works"
run_xmcpc "$SESSION1" tools-list
assert_success
assert_not_empty "$STDOUT"
test_pass

test_case "session ping works"
run_xmcpc "$SESSION1" ping
assert_success
test_pass

test_case "session info shows server capabilities"
run_mcpc "$SESSION1"
assert_success
assert_contains "$STDOUT" "Capabilities:"
test_pass

# =============================================================================
# Test: Different profiles create independent sessions
# =============================================================================

test_case "create second session with different profile"
SESSION2=$(session_name "oauth2")
run_mcpc "$REMOTE_SERVER" session "$SESSION2" --profile "$PROFILE2"
assert_success
_SESSIONS_CREATED+=("$SESSION2")
test_pass

test_case "both sessions work independently"
# Session 1
run_xmcpc "$SESSION1" ping
assert_success

# Session 2
run_xmcpc "$SESSION2" ping
assert_success
test_pass

test_case "session list shows both sessions"
run_mcpc --json
assert_success
assert_json_valid "$STDOUT"

# Check both sessions exist
sessions_json="$STDOUT"
session1_exists=$(echo "$sessions_json" | jq -r ".sessions[] | select(.name == \"$SESSION1\") | .name")
session2_exists=$(echo "$sessions_json" | jq -r ".sessions[] | select(.name == \"$SESSION2\") | .name")

if [[ "$session1_exists" != "$SESSION1" ]]; then
  test_fail "Session $SESSION1 not found in session list"
  exit 1
fi
if [[ "$session2_exists" != "$SESSION2" ]]; then
  test_fail "Session $SESSION2 not found in session list"
  exit 1
fi
test_pass

# =============================================================================
# Test: Session shows profile information
# =============================================================================

test_case "session info shows profile name"
run_mcpc --json "$SESSION1"
assert_success
assert_json_valid "$STDOUT"
# The session should reference the profile
profile_name=$(echo "$STDOUT" | jq -r '.profileName // empty')
if [[ "$profile_name" != "$PROFILE1" ]]; then
  # Profile might be shown differently, just check it's there somewhere
  if ! echo "$STDOUT" | grep -q "$PROFILE1"; then
    test_fail "Profile name $PROFILE1 not found in session info"
    exit 1
  fi
fi
test_pass

# =============================================================================
# Test: Close sessions
# =============================================================================

test_case "close first session"
run_mcpc "$SESSION1" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION1}")
test_pass

test_case "close second session"
run_mcpc "$SESSION2" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION2}")
test_pass

test_case "sessions no longer in list after close"
run_mcpc --json
assert_success
assert_json_valid "$STDOUT"

# Check sessions are gone
if echo "$STDOUT" | jq -e ".sessions[] | select(.name == \"$SESSION1\")" >/dev/null 2>&1; then
  test_fail "Session $SESSION1 still exists after close"
  exit 1
fi
if echo "$STDOUT" | jq -e ".sessions[] | select(.name == \"$SESSION2\")" >/dev/null 2>&1; then
  test_fail "Session $SESSION2 still exists after close"
  exit 1
fi
test_pass

test_done
