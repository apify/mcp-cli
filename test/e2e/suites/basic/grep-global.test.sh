#!/bin/bash
# Test: Global grep command (search across all sessions)
# Tests mcpc grep <pattern> without a session target, searching all active sessions

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/grep-global"

# Start test server
start_test_server

# Generate unique session names
SESSION1=$(session_name "grep-g1")
SESSION2=$(session_name "grep-g2")

# =============================================================================
# Setup: create two sessions to the same test server
# =============================================================================

test_case "setup: create first session"
run_mcpc connect "$TEST_SERVER_URL" "$SESSION1" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$SESSION1")
test_pass

test_case "setup: create second session"
run_mcpc connect "$TEST_SERVER_URL" "$SESSION2" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$SESSION2")
test_pass

# =============================================================================
# Test: Global grep matches across sessions
# =============================================================================

test_case "global grep matches tools across sessions"
run_mcpc grep "echo"
assert_success
assert_contains "$STDOUT" "echo"
# Both sessions should appear in output
assert_contains "$STDOUT" "$SESSION1"
assert_contains "$STDOUT" "$SESSION2"
test_pass

test_case "global grep with no matches returns exit code 1"
run_mcpc grep "zzz_nonexistent_zzz"
assert_exit_code 1
test_pass

test_case "global grep matches tool by description"
run_mcpc grep "Returns the input"
assert_success
assert_contains "$STDOUT" "echo"
test_pass

# =============================================================================
# Test: Global grep with type flags
# =============================================================================

test_case "global grep default does not search resources"
run_mcpc grep "static"
assert_exit_code 1
test_pass

test_case "global grep --resources searches resources"
run_mcpc grep "static" --resources
assert_success
assert_contains "$STDOUT" "test://static/hello"
test_pass

test_case "global grep --prompts searches prompts"
run_mcpc grep "greeting" --prompts
assert_success
assert_contains "$STDOUT" "greeting"
test_pass

test_case "global grep --tools --resources searches both"
run_mcpc grep "echo" --tools --resources
assert_success
assert_contains "$STDOUT" "echo"
test_pass

# =============================================================================
# Test: Global grep with regex
# =============================================================================

test_case "global grep -E regex pattern matches"
run_mcpc grep -E "echo|add"
assert_success
assert_contains "$STDOUT" "echo"
assert_contains "$STDOUT" "add"
test_pass

# =============================================================================
# Test: Global grep case sensitivity
# =============================================================================

test_case "global grep is case-insensitive by default"
run_mcpc grep "ECHO"
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "global grep --case-sensitive respects case"
run_mcpc grep "ECHO" --case-sensitive
assert_exit_code 1
test_pass

# =============================================================================
# Test: Global grep JSON output
# =============================================================================

test_case "global grep --json returns valid JSON with results array"
run_mcpc --json grep "echo"
assert_success
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.results | length > 0'
assert_json "$STDOUT" '.totalMatches > 0'
test_pass

test_case "global grep --json results contain session names"
run_mcpc --json grep "echo"
assert_success
assert_json "$STDOUT" '.results[0].session != null'
assert_json "$STDOUT" '.results[0].tools | length > 0'
test_pass

test_case "global grep --json with no matches returns empty results"
run_mcpc --json grep "zzz_nonexistent_zzz"
assert_exit_code 1
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.results | length == 0'
assert_json "$STDOUT" '.totalMatches == 0'
test_pass

test_case "global grep --json --resources searches only resources"
run_mcpc --json grep "static" --resources
assert_success
assert_json "$STDOUT" '.results[0].resources | length > 0'
assert_json "$STDOUT" '.results[0].tools | length == 0'
test_pass

# =============================================================================
# Test: Global grep with --max-results
# =============================================================================

test_case "global grep -m limits results"
run_mcpc --json grep "e" --tools --resources --prompts -m 1
assert_success
# totalMatches should be > 1 but only 1 shown
assert_json "$STDOUT" '.totalMatches > 1'
# Count displayed items across all sessions
DISPLAYED=$(echo "$STDOUT" | jq '[.results[] | (.tools | length) + (.resources | length) + (.prompts | length)] | add')
assert_eq "$DISPLAYED" "1"
test_pass

# =============================================================================
# Test: Global grep with no sessions
# =============================================================================

test_case "cleanup: close both sessions"
run_mcpc "$SESSION1" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION1}")
run_mcpc "$SESSION2" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION2}")
test_pass

test_case "global grep with no sessions returns exit code 1"
run_mcpc grep "echo"
assert_exit_code 1
test_pass

test_case "global grep --json with no sessions returns empty"
run_mcpc --json grep "echo"
# No sessions means no matches — exit code 1 but valid JSON
assert_exit_code 1
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.results | length == 0'
assert_json "$STDOUT" '.totalMatches == 0'
test_pass

test_done
