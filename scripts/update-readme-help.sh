#!/bin/bash
# Updates the Usage section in README.md with output from "mcpc --help"

set -e

README="README.md"
TEMP_HELP=$(mktemp)
TEMP_README=$(mktemp)

# Get help output, remove the "Full docs:" line at the end
mcpc --help | sed '/^Full docs:/d' > "$TEMP_HELP"

# Use awk to replace content between the TODO marker's code block
awk '
    /<!-- Generate this automatically from "mcpc --help"/ {
        print
        todo_found = 1
        next
    }
    todo_found && /^```$/ && in_code {
        # End of code block - insert new content
        print "```"
        while ((getline line < "'"$TEMP_HELP"'") > 0) {
            print line
        }
        print "```"
        todo_found = 0
        in_code = 0
        next
    }
    todo_found && /^```/ {
        # Start of code block after TODO
        in_code = 1
        next
    }
    todo_found && in_code {
        # Skip old content inside code block
        next
    }
    { print }
' "$README" > "$TEMP_README"

mv "$TEMP_README" "$README"
rm -f "$TEMP_HELP"

echo "Updated Usage section in README.md"
