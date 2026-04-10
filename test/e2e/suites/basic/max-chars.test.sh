#!/bin/bash
# Test: --max-chars option (output truncation)
# Tests that --max-chars truncates human output and is ignored in JSON mode

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/max-chars"

# Start test server
start_test_server

# Generate unique session name for this test
SESSION=$(session_name "maxch")

# Create session for testing
test_case "setup: create session"
run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$SESSION")
test_pass

# =============================================================================
# Test: --max-chars truncates tools-call output
# =============================================================================

test_case "tools-call output is truncated with --max-chars"
run_mcpc "$SESSION" tools-call echo 'message:=The quick brown fox jumps over the lazy dog' --max-chars 20
assert_success
assert_contains "$STDOUT" "output truncated"
assert_contains "$STDOUT" "--max-chars"
test_pass

test_case "tools-call shows first N chars when truncated"
run_mcpc "$SESSION" tools-call echo 'message:=ABCDEFGHIJ' --max-chars 5
assert_success
# The truncated output should start with the beginning of the formatted output
assert_contains "$STDOUT" "output truncated"
assert_contains "$STDOUT" "showing first 5 chars"
test_pass

test_case "tools-call not truncated when output fits within --max-chars"
run_mcpc "$SESSION" tools-call echo 'message:=Hi' --max-chars 10000
assert_success
assert_contains "$STDOUT" "Hi"
assert_not_contains "$STDOUT" "output truncated"
test_pass

# =============================================================================
# Test: --max-chars truncates tools-list output
# =============================================================================

test_case "tools-list output is truncated with small --max-chars"
run_mcpc "$SESSION" tools-list --max-chars 30
assert_success
assert_contains "$STDOUT" "output truncated"
test_pass

test_case "tools-list not truncated with large --max-chars"
run_mcpc "$SESSION" tools-list --max-chars 100000
assert_success
assert_not_contains "$STDOUT" "output truncated"
test_pass

# =============================================================================
# Test: --max-chars truncates resources-list output
# =============================================================================

test_case "resources-list output is truncated with small --max-chars"
run_mcpc "$SESSION" resources-list --max-chars 30
assert_success
assert_contains "$STDOUT" "output truncated"
test_pass

# =============================================================================
# Test: --max-chars truncates resources-read output
# =============================================================================

test_case "resources-read output is truncated with small --max-chars"
run_mcpc "$SESSION" resources-read "test://static/hello" --max-chars 5
assert_success
assert_contains "$STDOUT" "output truncated"
test_pass

test_case "resources-read not truncated with large --max-chars"
run_mcpc "$SESSION" resources-read "test://static/hello" --max-chars 100000
assert_success
assert_not_contains "$STDOUT" "output truncated"
assert_contains "$STDOUT" "Hello, World!"
test_pass

# =============================================================================
# Test: --max-chars truncates prompts-list output
# =============================================================================

test_case "prompts-list output is truncated with small --max-chars"
run_mcpc "$SESSION" prompts-list --max-chars 30
assert_success
assert_contains "$STDOUT" "output truncated"
test_pass

# =============================================================================
# Test: --max-chars truncates prompts-get output
# =============================================================================

test_case "prompts-get output is truncated with small --max-chars"
run_mcpc "$SESSION" prompts-get greeting name:=Alice --max-chars 10
assert_success
assert_contains "$STDOUT" "output truncated"
test_pass

# =============================================================================
# Test: --max-chars is ignored in --json mode
# =============================================================================

test_case "tools-call --json ignores --max-chars"
run_mcpc --json "$SESSION" tools-call echo 'message:=Hello World' --max-chars 5
assert_success
assert_json_valid "$STDOUT"
assert_not_contains "$STDOUT" "output truncated"
test_pass

test_case "tools-list --json ignores --max-chars"
run_mcpc --json "$SESSION" tools-list --max-chars 5
assert_success
assert_json_valid "$STDOUT"
assert_not_contains "$STDOUT" "output truncated"
test_pass

test_case "resources-list --json ignores --max-chars"
run_mcpc --json "$SESSION" resources-list --max-chars 5
assert_success
assert_json_valid "$STDOUT"
assert_not_contains "$STDOUT" "output truncated"
test_pass

test_case "prompts-list --json ignores --max-chars"
run_mcpc --json "$SESSION" prompts-list --max-chars 5
assert_success
assert_json_valid "$STDOUT"
assert_not_contains "$STDOUT" "output truncated"
test_pass

# =============================================================================
# Test: --max-chars truncation notice shows total size
# =============================================================================

test_case "truncation notice shows KB for large output"
run_mcpc "$SESSION" tools-list --full --max-chars 10
assert_success
assert_contains "$STDOUT" "output truncated"
assert_contains "$STDOUT" "KB total"
test_pass

test_case "truncation notice shows chars for small output"
run_mcpc "$SESSION" tools-call echo 'message:=Short' --max-chars 3
assert_success
assert_contains "$STDOUT" "output truncated"
assert_contains "$STDOUT" "chars"
test_pass

# =============================================================================
# Test: --max-chars validation (invalid values)
# =============================================================================

test_case "--max-chars rejects zero"
run_mcpc "$SESSION" tools-list --max-chars 0
assert_failure
assert_contains "$STDERR" "Invalid --max-chars"
test_pass

test_case "--max-chars rejects negative values"
run_mcpc "$SESSION" tools-list --max-chars -5
assert_failure
assert_contains "$STDERR" "Invalid --max-chars"
test_pass

test_case "--max-chars rejects non-numeric values"
run_mcpc "$SESSION" tools-list --max-chars abc
assert_failure
assert_contains "$STDERR" "Invalid --max-chars"
test_pass

# =============================================================================
# Cleanup
# =============================================================================

test_case "cleanup: close session"
run_mcpc "$SESSION" close
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")
test_pass

test_done
