#!/bin/bash
# Test: Output invariants (--verbose, --json behavior)

source "$(dirname "$0")/../../lib/framework.sh"
test_init "basic/output-invariants"

# Test: --verbose doesn't change stdout for --help
test_case "--verbose doesn't change stdout for --help"
run_mcpc --help
stdout_normal="$STDOUT"

run_mcpc --help --verbose
stdout_verbose="$STDOUT"

assert_eq "$stdout_normal" "$stdout_verbose" "--verbose should not change stdout"
test_pass

# Test: --verbose doesn't change stdout for session list
test_case "--verbose doesn't change stdout for session list"
run_mcpc
stdout_normal="$STDOUT"

run_mcpc --verbose
stdout_verbose="$STDOUT"

assert_eq "$stdout_normal" "$stdout_verbose" "--verbose should not change stdout"
test_pass

# Test: --json returns valid JSON for session list
test_case "--json returns valid JSON for session list"
run_mcpc --json
assert_success
assert_json_valid "$STDOUT"
test_pass

# Test: --json has expected structure
test_case "--json has expected structure"
run_mcpc --json
assert_json "$STDOUT" '.sessions'
assert_json "$STDOUT" '.profiles'
test_pass

# Test: -j is alias for --json
test_case "-j is alias for --json"
run_mcpc -j
assert_success
assert_json_valid "$STDOUT"
test_pass

# Test: --json on error returns JSON or nothing
test_case "--json on error returns JSON or nothing"
run_mcpc @nonexistent-session-$RANDOM tools-list --json
assert_failure
# If there's stdout, it should be valid JSON
if [[ -n "$STDOUT" ]]; then
  assert_json_valid "$STDOUT" "--json should return valid JSON even on error"
fi
test_pass

# Test: xmcpc invariant check works (use --version which is deterministic)
# Note: Session list is non-deterministic in parallel test runs
test_case "xmcpc validates invariants automatically"
run_xmcpc --version
assert_success
test_pass

# Test: session creation with --json returns only valid JSON to stdout
test_case "session create --json returns only valid JSON"
SESSION=$(session_name "json-test")
run_mcpc --config "$(create_fs_config "$TEST_TMP")" fs session "$SESSION" --json
assert_success
_SESSIONS_CREATED+=("$SESSION")
assert_json_valid "$STDOUT" "session create --json should return only valid JSON to stdout"
test_pass

# Test: session close with --json returns only valid JSON to stdout
test_case "session close --json returns only valid JSON"
run_mcpc "$SESSION" close --json
assert_success
_SESSIONS_CREATED=("${_SESSIONS_CREATED[@]/$SESSION}")
assert_json_valid "$STDOUT" "session close --json should return only valid JSON to stdout"
# Verify JSON structure
assert_json "$STDOUT" '.sessionName' "should have sessionName field"
assert_json "$STDOUT" '.closed' "should have closed field"
test_pass

test_done
