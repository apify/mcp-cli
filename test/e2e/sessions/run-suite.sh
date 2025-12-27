#!/bin/bash
# Session tests suite runner
# Starts test server before running tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"
source "$SCRIPT_DIR/../lib/server.sh"

# Use unique port for this suite
export TEST_SERVER_PORT=13457

echo "# Starting test server for sessions suite..."
start_test_server $TEST_SERVER_PORT

# Run all tests in this suite
failed=0
for test_file in "$SCRIPT_DIR"/*.test.sh; do
  if [[ -f "$test_file" ]]; then
    echo ""
    echo "# Running $(basename "$test_file")..."
    if ! bash "$test_file"; then
      failed=1
    fi
  fi
done

stop_test_server

exit $failed
