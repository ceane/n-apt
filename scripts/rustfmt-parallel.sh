#!/bin/bash

# Parallel Rustfmt formatter
# Formats multiple files simultaneously for better performance

set -e

# Get list of Rust files
RUST_FILES=$(find . -name "*.rs" -not -path "./target/*" -not -path "./pkg/*")

# Count files
FILE_COUNT=$(echo "$RUST_FILES" | wc -l | tr -d ' ')

echo "Formatting $FILE_COUNT Rust files in parallel..."

# Use xargs to run rustfmt on multiple files in parallel
# -P flag specifies number of parallel processes (default to CPU count)
echo "$RUST_FILES" | xargs -P "$(nproc)" -n 10 rustfmt

echo "Formatting complete!"
