#!/bin/bash
# Common utilities for E2E tests
# Source this at the top of every test file

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
export MCPC="node $PROJECT_ROOT/dist/cli/index.js"

# All tests share one home dir (tests concurrent access & file locking)
export MCPC_HOME_DIR="${MCPC_HOME_DIR:-$HOME/.mcpc-e2e-test}"

# Test counters
_TESTS_RUN=0
_TESTS_PASSED=0
_TESTS_FAILED=0

# ============================================================================
# Setup and Cleanup
# ============================================================================

setup_test() {
  mkdir -p "$MCPC_HOME_DIR"

  # Unique identifiers to avoid collision with parallel tests
  export TEST_ID="$$-$RANDOM"
  export TEST_SESSION="@e2e-$TEST_ID"
  export TEST_PROFILE="e2e-profile-$TEST_ID"

  # Temp directory for test artifacts
  export TEST_TMP=$(mktemp -d)
}

cleanup_test() {
  local exit_code=$?

  # Close our session (ignore errors if already closed or doesn't exist)
  if [[ -n "${TEST_SESSION:-}" ]]; then
    $MCPC "$TEST_SESSION" close 2>/dev/null || true
  fi

  # Clean up temp directory
  if [[ -n "${TEST_TMP:-}" && -d "$TEST_TMP" ]]; then
    rm -rf "$TEST_TMP"
  fi

  return $exit_code
}

# For OAuth tests that need real pre-configured profiles
setup_test_real_auth() {
  unset MCPC_HOME_DIR  # Use real ~/.mcpc

  export TEST_ID="$$-$RANDOM"
  export TEST_SESSION="@e2e-$TEST_ID"

  export TEST_TMP=$(mktemp -d)
}

# ============================================================================
# Test Output (TAP-like format)
# ============================================================================

# Start a named test
begin_test() {
  _CURRENT_TEST="$1"
  ((_TESTS_RUN++)) || true
}

# Mark test as passed
pass() {
  local msg="${1:-$_CURRENT_TEST}"
  echo -e "${GREEN}ok${NC} $_TESTS_RUN - $msg"
  ((_TESTS_PASSED++)) || true
}

# Mark test as failed and exit
fail() {
  local msg="${1:-$_CURRENT_TEST}"
  local detail="${2:-}"
  echo -e "${RED}not ok${NC} $_TESTS_RUN - $msg"
  if [[ -n "$detail" ]]; then
    echo "# $detail"
  fi
  ((_TESTS_FAILED++)) || true
  exit 1
}

# Skip a test (not a failure)
skip() {
  local msg="${1:-$_CURRENT_TEST}"
  local reason="${2:-}"
  echo -e "${YELLOW}ok${NC} $_TESTS_RUN - $msg # SKIP${reason:+ $reason}"
  ((_TESTS_PASSED++)) || true
}

# Print test summary
print_summary() {
  echo ""
  echo "# Tests: $_TESTS_RUN, Passed: $_TESTS_PASSED, Failed: $_TESTS_FAILED"
  if [[ $_TESTS_FAILED -gt 0 ]]; then
    return 1
  fi
  return 0
}

# ============================================================================
# Assertions
# ============================================================================

# Assert two values are equal
assert_eq() {
  local actual="$1"
  local expected="$2"
  local msg="${3:-values should be equal}"

  if [[ "$actual" != "$expected" ]]; then
    fail "$msg" "Expected: '$expected', Got: '$actual'"
  fi
}

# Assert value is not empty
assert_not_empty() {
  local value="$1"
  local msg="${2:-value should not be empty}"

  if [[ -z "$value" ]]; then
    fail "$msg" "Got empty value"
  fi
}

# Assert value is empty
assert_empty() {
  local value="$1"
  local msg="${2:-value should be empty}"

  if [[ -n "$value" ]]; then
    fail "$msg" "Expected empty, got: '$value'"
  fi
}

# Assert string contains substring
assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-should contain substring}"

  if [[ "$haystack" != *"$needle"* ]]; then
    fail "$msg" "String does not contain: '$needle'"
  fi
}

# Assert string does NOT contain substring
assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-should not contain substring}"

  if [[ "$haystack" == *"$needle"* ]]; then
    fail "$msg" "String contains: '$needle'"
  fi
}

# Assert exit code matches expected
assert_exit_code() {
  local actual="$1"
  local expected="$2"
  local msg="${3:-exit code should match}"

  if [[ "$actual" -ne "$expected" ]]; then
    fail "$msg" "Expected exit code $expected, got $actual"
  fi
}

# Assert exit code is 0 (success)
assert_success() {
  local exit_code="$1"
  local msg="${2:-command should succeed}"

  assert_exit_code "$exit_code" 0 "$msg"
}

# Assert exit code is non-zero (failure)
assert_failure() {
  local exit_code="$1"
  local msg="${2:-command should fail}"

  if [[ "$exit_code" -eq 0 ]]; then
    fail "$msg" "Expected non-zero exit code, got 0"
  fi
}

# Assert output is valid JSON
assert_json_valid() {
  local json="$1"
  local msg="${2:-output should be valid JSON}"

  if ! echo "$json" | jq . >/dev/null 2>&1; then
    fail "$msg" "Invalid JSON: ${json:0:100}..."
  fi
}

# Assert JSON matches jq expression
assert_json() {
  local json="$1"
  local expr="$2"
  local msg="${3:-JSON should match expression}"

  if ! echo "$json" | jq -e "$expr" >/dev/null 2>&1; then
    fail "$msg" "JSON expression '$expr' did not match"
  fi
}

# Assert JSON field equals value
assert_json_eq() {
  local json="$1"
  local field="$2"
  local expected="$3"
  local msg="${4:-JSON field should equal value}"

  local actual
  actual=$(echo "$json" | jq -r "$field" 2>/dev/null) || fail "$msg" "Failed to extract $field"

  if [[ "$actual" != "$expected" ]]; then
    fail "$msg" "Field $field: expected '$expected', got '$actual'"
  fi
}

# Assert file exists
assert_file_exists() {
  local path="$1"
  local msg="${2:-file should exist}"

  if [[ ! -f "$path" ]]; then
    fail "$msg" "File not found: $path"
  fi
}

# Assert file does not exist
assert_file_not_exists() {
  local path="$1"
  local msg="${2:-file should not exist}"

  if [[ -f "$path" ]]; then
    fail "$msg" "File exists: $path"
  fi
}

# ============================================================================
# Command Execution Helpers
# ============================================================================

# Run mcpc and capture stdout, stderr, and exit code
# Usage: run_mcpc [args...]
# Sets: STDOUT, STDERR, EXIT_CODE
run_mcpc() {
  local stdout_file="$TEST_TMP/stdout.$$"
  local stderr_file="$TEST_TMP/stderr.$$"

  set +e
  $MCPC "$@" >"$stdout_file" 2>"$stderr_file"
  EXIT_CODE=$?
  set -e

  STDOUT=$(cat "$stdout_file")
  STDERR=$(cat "$stderr_file")

  rm -f "$stdout_file" "$stderr_file"
}

# Run mcpc with --json flag
run_mcpc_json() {
  run_mcpc --json "$@"
}

# ============================================================================
# Invariant Checks
# ============================================================================

# Check that --verbose only adds to stderr, not stdout
# Usage: check_verbose_invariant [args...]
check_verbose_invariant() {
  local stdout_normal stderr_normal
  local stdout_verbose stderr_verbose

  # Run without --verbose
  run_mcpc "$@"
  stdout_normal="$STDOUT"

  # Run with --verbose
  run_mcpc --verbose "$@"
  stdout_verbose="$STDOUT"

  # stdout should be identical
  if [[ "$stdout_normal" != "$stdout_verbose" ]]; then
    fail "--verbose should not change stdout" "stdout differs with --verbose"
  fi
}

# Check that --json returns valid JSON on success
# Usage: check_json_invariant [args...]
check_json_invariant() {
  run_mcpc --json "$@"

  if [[ $EXIT_CODE -eq 0 ]]; then
    # Success should return valid JSON
    assert_json_valid "$STDOUT" "--json should return valid JSON on success"
  else
    # Failure can return JSON error or nothing
    if [[ -n "$STDOUT" ]]; then
      assert_json_valid "$STDOUT" "--json should return valid JSON or nothing on error"
    fi
  fi
}
