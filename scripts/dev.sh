#!/bin/bash

# Development launcher for N-APT with enhanced visual build output
# This script uses the new build orchestrator for professional output

set -e

# Change to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"

echo -e "\033[36m📋 Development Features:\033[0m"
echo "  • Enhanced visual build output"
echo "  • Incremental compilation enabled"
echo ""

# Start the enhanced development server
echo -e "\033[32mStarting enhanced development server...\033[0m"
echo "Press Ctrl+C to stop"
echo ""

# Use the new build orchestrator
exec ./scripts/build_orchestrator.sh
