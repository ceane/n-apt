#!/bin/bash

# Parallel Rustfmt formatter
# Formats multiple files simultaneously for better performance

set -e

# Get list of Rust files
RUST_FILES=$(find . -name "*.rs" -not -path "./target/*" -not -path "./pkg/*" -not -path "./src/encrypted-modules/*")

# Count files
FILE_COUNT=$(echo "$RUST_FILES" | wc -l | tr -d ' ')

echo "Formatting $FILE_COUNT Rust files in parallel..."

# Use xargs to run rustfmt on multiple files in parallel
# -P flag specifies number of parallel processes (default to CPU count)
# Use sysctl for macOS compatibility
CPU_COUNT=$(sysctl -n hw.ncpu 2>/dev/null || echo "4")
echo "$RUST_FILES" | xargs -P "$CPU_COUNT" -n 10 rustfmt

echo "Formatting complete!"
