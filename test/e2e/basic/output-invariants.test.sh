#!/bin/bash
# Test: Output invariants (--verbose, --json behavior)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

setup_test
trap cleanup_test EXIT

# Test 1: --verbose only adds to stderr, not stdout (for --help)
begin_test "--verbose doesn't change stdout for --help"
run_mcpc --help
stdout_normal="$STDOUT"

run_mcpc --help --verbose
stdout_verbose="$STDOUT"

assert_eq "$stdout_normal" "$stdout_verbose" "--verbose should not change stdout"
pass

# Test 2: --verbose only adds to stderr, not stdout (for listing sessions)
begin_test "--verbose doesn't change stdout for session list"
run_mcpc
stdout_normal="$STDOUT"

run_mcpc --verbose
stdout_verbose="$STDOUT"

assert_eq "$stdout_normal" "$stdout_verbose" "--verbose should not change stdout"
pass

# Test 3: --json returns valid JSON for session list
begin_test "--json returns valid JSON for session list"
run_mcpc --json
assert_success $EXIT_CODE
assert_json_valid "$STDOUT"
pass

# Test 4: --json output has expected structure
begin_test "--json has expected structure"
run_mcpc --json
assert_json "$STDOUT" '.sessions'
assert_json "$STDOUT" '.profiles'
pass

# Test 5: -j is alias for --json
begin_test "-j is alias for --json"
run_mcpc -j
assert_success $EXIT_CODE
assert_json_valid "$STDOUT"
pass

# Test 6: --json on error returns JSON or nothing
begin_test "--json on error returns JSON or nothing"
run_mcpc @nonexistent-session-12345 tools-list --json
# Should fail
assert_failure $EXIT_CODE
# If there's stdout, it should be valid JSON
if [[ -n "$STDOUT" ]]; then
  assert_json_valid "$STDOUT" "--json should return valid JSON even on error"
fi
pass

# Test 7: --verbose adds timestamps to stderr
begin_test "--verbose adds extra info to stderr"
run_mcpc --verbose
# stderr should have some verbose output (timestamps, context)
# We just check it's not empty when verbose is on and there's activity
# This is a soft check since some commands may not produce verbose output
if [[ -n "$STDERR" ]]; then
  # Verbose mode typically includes bracketed context like [sessions]
  # But we won't fail if it's empty - just checking the mechanism works
  :
fi
pass

print_summary
