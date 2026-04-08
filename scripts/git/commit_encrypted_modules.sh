#!/bin/bash

echo "🔐 Committing encrypted modules..."

# Add all tmp/ files
git add -f src/encrypted-modules/tmp/

# Check what's staged
echo "📋 Staged files:"
git status --porcelain

# Commit with initial commit message
git commit -m "Initial commit

Add encrypted modules with maximum obfuscation

Features:
- Completely unrecognizable function/struct names (e.g., __obf_fn_execute_0x8d2f)
- Helpful comments with original names for development
- Clean tmp/ folder structure with no duplicates
- Maximum privacy protection while maintaining maintainability
- Branch-specific gitignore rules (tmp/ allowed only in encrypted-modules)

Security: This branch is configured with pushRemote=no_push to prevent accidental pushes"

echo "✅ Encrypted modules committed!"
echo ""
echo "📋 Commit details:"
git log --oneline -1
