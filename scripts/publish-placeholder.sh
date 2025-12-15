#!/bin/bash

# Script to publish a placeholder package to npm to reserve the name
# This creates a minimal package without the full implementation

set -e

echo "📦 Publishing placeholder for 'mcpc' package to npm..."
echo ""

# Check if already logged in to npm
if ! npm whoami > /dev/null 2>&1; then
  echo "❌ Not logged in to npm. Please run: npm login"
  exit 1
fi

# Confirm with user
echo "This will publish mcpc@0.0.1 as a placeholder to reserve the package name."
echo "Repository: https://github.com/apify/mcpc"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 0
fi

# Create temporary directory
TEMP_DIR=$(mktemp -d)
echo "📁 Creating placeholder package in: $TEMP_DIR"

# Copy minimal files
cp package.json "$TEMP_DIR/"
cp LICENSE "$TEMP_DIR/" 2>/dev/null || echo "⚠️  No LICENSE file found"

# Create placeholder README
cat > "$TEMP_DIR/README.md" << 'EOF'
# mcpc

**🚧 Under Active Development**

Command-line client for the Model Context Protocol (MCP).

## Status

This package is currently under active development. The full release is coming soon.

**Features (Coming Soon):**
- Universal MCP client supporting HTTP and stdio transports
- Direct connection to remote MCP servers
- Persistent session management
- Interactive shell
- JSON output mode for scripting
- Configuration file support

## Repository

https://github.com/apify/mcpc

## Stay Updated

⭐ Star the repository to get notified when the full version is released!

---

_This is a placeholder release to reserve the package name. The full package will be published shortly._
EOF

# Create minimal dist directory with a placeholder
mkdir -p "$TEMP_DIR/dist"
cat > "$TEMP_DIR/dist/index.js" << 'EOF'
"use strict";
// This is a placeholder package
// Full implementation coming soon
// See: https://github.com/apify/mcpc
throw new Error('mcpc is not yet available. This is a placeholder release. See https://github.com/apify/mcpc for updates.');
EOF

# Update version in package.json manually to avoid triggering hooks
cd "$TEMP_DIR"
# Use node to update version without triggering lifecycle scripts
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '0.0.1';
// Remove scripts that would fail during publish
delete pkg.scripts.prepublishOnly;
delete pkg.scripts.prebuild;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

# Show what will be published
echo ""
echo "📋 Package contents:"
ls -la

echo ""
echo "📄 README.md preview:"
head -20 README.md
echo ""

# Publish
echo "🚀 Publishing to npm..."
npm publish --access public

echo ""
echo "✅ Placeholder published successfully!"
echo ""
echo "🔗 View at: https://www.npmjs.com/package/mcpc"
echo ""
echo "Next steps:"
echo "  1. When ready, update version in package.json (e.g., 0.1.0)"
echo "  2. Build the project: npm run build"
echo "  3. Publish the full version: npm publish"
echo ""

# Cleanup
rm -rf "$TEMP_DIR"
