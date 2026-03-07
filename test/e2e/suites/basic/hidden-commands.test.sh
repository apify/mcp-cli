#!/bin/bash
# Test: hidden top-level commands (shell, close, restart)
# These commands are hidden from --help but must remain fully functional

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/hidden-commands"

start_test_server

# =============================================================================
# shell, close, restart are NOT shown in --help
# =============================================================================

test_case "shell not listed in --help"
run_mcpc --help
assert_success
assert_not_contains "$STDOUT" "  shell " "shell should be hidden from help"
test_pass

test_case "close not listed in --help"
run_mcpc --help
assert_not_contains "$STDOUT" "  close " "close should be hidden from help"
test_pass

test_case "restart not listed in --help"
run_mcpc --help
assert_not_contains "$STDOUT" "  restart " "restart should be hidden from help"
test_pass

# =============================================================================
# mcpc close @session  (top-level form)
# =============================================================================

test_case "mcpc close @session closes the session"
SESSION=$(session_name "close")
run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true"
assert_success
run_mcpc close "$SESSION"
assert_success
# Session should no longer exist
run_mcpc --json
assert_success
session_exists=$(echo "$STDOUT" | jq -r ".sessions[] | select(.name == \"$SESSION\") | .name")
assert_empty "$session_exists" "session should not exist after close"
test_pass

test_case "mcpc close missing @session errors"
run_mcpc close
assert_failure
test_pass

# =============================================================================
# mcpc restart @session  (top-level form)
# =============================================================================

test_case "mcpc restart @session restarts the session"
SESSION=$(session_name "restart")
run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$SESSION")
# Get initial PID
run_mcpc --json
INITIAL_PID=$(echo "$STDOUT" | jq -r ".sessions[] | select(.name == \"$SESSION\") | .pid")
assert_not_empty "$INITIAL_PID"
# Restart
run_mcpc restart "$SESSION"
assert_success
assert_contains "$STDOUT" "restarted"
# Bridge PID should change
run_mcpc --json
NEW_PID=$(echo "$STDOUT" | jq -r ".sessions[] | select(.name == \"$SESSION\") | .pid")
assert_not_empty "$NEW_PID"
if [[ "$INITIAL_PID" == "$NEW_PID" ]]; then
  test_fail "Bridge PID did not change after restart (still $INITIAL_PID)"
  exit 1
fi
test_pass

test_case "mcpc restart missing @session errors"
run_mcpc restart
assert_failure
test_pass

# =============================================================================
# mcpc shell @session  (top-level form)
# =============================================================================

test_case "mcpc shell @session exits cleanly on EOF"
SESSION2=$(session_name "shell")
run_mcpc connect "$TEST_SERVER_URL" "$SESSION2" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$SESSION2")
# Send EOF immediately; readline closes, shell exits 0
echo -n "" | run_mcpc shell "$SESSION2"
assert_success
test_pass

test_case "mcpc shell missing @session errors"
run_mcpc shell
assert_failure
test_pass

test_done
