#!/bin/bash
# Test: Grep command (search tools, resources, prompts)
# Tests grep with default flags, --tools, --resources, --prompts, --json, and regex

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/grep"

# Start test server
start_test_server

# Generate unique session name for this test
SESSION=$(session_name "grep")

# Create session for testing
test_case "setup: create session"
run_mcpc connect "$TEST_SERVER_URL" "$SESSION" --header "X-Test: true"
assert_success
_SESSIONS_CREATED+=("$SESSION")
test_pass

# =============================================================================
# Test: Default grep (tools only)
# =============================================================================

test_case "grep matches tool by name"
run_mcpc "$SESSION" grep "echo"
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "grep matches tool by description"
run_mcpc "$SESSION" grep "Returns the input"
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "grep with no matches returns exit code 1"
run_mcpc "$SESSION" grep "zzz_nonexistent_zzz"
assert_exit_code 1
test_pass

test_case "grep default does not search resources"
run_mcpc "$SESSION" grep "static"
# 'static' appears in resource URIs/names but not in tool names/descriptions
assert_exit_code 1
test_pass

test_case "grep default does not search prompts"
run_mcpc "$SESSION" grep "greeting"
# 'greeting' is a prompt name but not a tool name/description
assert_exit_code 1
test_pass

# =============================================================================
# Test: --resources flag (searches resources only, not tools)
# =============================================================================

test_case "grep --resources searches resources"
run_mcpc "$SESSION" grep "static" --resources
assert_success
assert_contains "$STDOUT" "test://static/hello"
test_pass

test_case "grep --resources does not search tools"
run_mcpc "$SESSION" grep "echo" --resources
# 'echo' only matches a tool, not a resource
assert_exit_code 1
test_pass

# =============================================================================
# Test: --prompts flag (searches prompts only, not tools)
# =============================================================================

test_case "grep --prompts searches prompts"
run_mcpc "$SESSION" grep "greeting" --prompts
assert_success
assert_contains "$STDOUT" "greeting"
test_pass

test_case "grep --prompts does not search tools"
run_mcpc "$SESSION" grep "echo" --prompts
# 'echo' only matches a tool, not a prompt
assert_exit_code 1
test_pass

# =============================================================================
# Test: --tools flag (explicit)
# =============================================================================

test_case "grep --tools searches tools explicitly"
run_mcpc "$SESSION" grep "echo" --tools
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "grep --tools does not search resources"
run_mcpc "$SESSION" grep "static" --tools
assert_exit_code 1
test_pass

# =============================================================================
# Test: Combined flags
# =============================================================================

test_case "grep --tools --resources searches both"
run_mcpc "$SESSION" grep "echo" --tools --resources
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "grep --tools --prompts searches both"
run_mcpc "$SESSION" grep "greeting" --tools --prompts
assert_success
assert_contains "$STDOUT" "greeting"
test_pass

test_case "grep --resources --prompts does not search tools"
run_mcpc "$SESSION" grep "echo" --resources --prompts
assert_exit_code 1
test_pass

test_case "grep --tools --resources --prompts searches everything"
run_mcpc "$SESSION" grep "e" --tools --resources --prompts
assert_success
assert_not_empty "$STDOUT"
test_pass

# =============================================================================
# Test: Regex search
# =============================================================================

test_case "grep -E regex pattern matches"
run_mcpc "$SESSION" grep -E "echo|add"
assert_success
assert_contains "$STDOUT" "echo"
assert_contains "$STDOUT" "add"
test_pass

# =============================================================================
# Test: Case sensitivity
# =============================================================================

test_case "grep is case-insensitive by default"
run_mcpc "$SESSION" grep "ECHO"
assert_success
assert_contains "$STDOUT" "echo"
test_pass

test_case "grep --case-sensitive respects case"
run_mcpc "$SESSION" grep "ECHO" --case-sensitive
assert_exit_code 1
test_pass

# =============================================================================
# Test: JSON output
# =============================================================================

test_case "grep --json returns valid JSON with tools"
run_mcpc --json "$SESSION" grep "echo"
assert_success
assert_json_valid "$STDOUT"
assert_json "$STDOUT" '.tools | length > 0'
assert_json "$STDOUT" '.tools[0].name == "echo"'
test_pass

test_case "grep --json returns empty resources/prompts by default"
run_mcpc --json "$SESSION" grep "echo"
assert_success
assert_json "$STDOUT" '.resources | length == 0'
assert_json "$STDOUT" '.prompts | length == 0'
test_pass

test_case "grep --json --resources searches only resources"
run_mcpc --json "$SESSION" grep "static" --resources
assert_success
assert_json "$STDOUT" '.resources | length > 0'
assert_json "$STDOUT" '.tools | length == 0'
test_pass

test_case "grep --json --tools --resources searches both"
run_mcpc --json "$SESSION" grep "echo" --tools --resources
assert_success
assert_json "$STDOUT" '.tools | length > 0'
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
