#!/bin/bash
# Test: mcpc --help and basic CLI behavior

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

setup_test
trap cleanup_test EXIT

# Test 1: --help shows usage
begin_test "--help shows usage"
run_mcpc --help
assert_success $EXIT_CODE
assert_contains "$STDOUT" "Usage:"
assert_contains "$STDOUT" "mcpc"
pass

# Test 2: -h is alias for --help
begin_test "-h is alias for --help"
run_mcpc -h
assert_success $EXIT_CODE
assert_contains "$STDOUT" "Usage:"
pass

# Test 3: help without target shows usage hint
begin_test "bare mcpc shows usage hint"
run_mcpc
# Should succeed (lists sessions) and mention --help
assert_success $EXIT_CODE
assert_contains "$STDOUT" "--help"
pass

# Test 4: --version shows version
begin_test "--version shows version"
run_mcpc --version
assert_success $EXIT_CODE
# Should match semver pattern
if [[ ! "$STDOUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  fail "--version should show semver" "Got: $STDOUT"
fi
pass

# Test 5: version matches package.json
begin_test "version matches package.json"
run_mcpc --version
pkg_version=$(node -p "require('$PROJECT_ROOT/package.json').version")
assert_eq "$STDOUT" "$pkg_version" "version should match package.json"
pass

# Test 6: unknown options are ignored (passed through)
begin_test "unknown options are ignored"
run_mcpc --some-unknown-option
# mcpc ignores unknown global options (for flexibility)
assert_success $EXIT_CODE
pass

print_summary
