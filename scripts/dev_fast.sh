#!/bin/bash

# Fast Development Launcher for N-APT
# Uses the optimized build orchestrator to prevent hanging

set -e

# Change to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"

echo -e "\033[36m🚀 Fast Development Mode${RESET}"
echo "  • Optimized build process"
echo "  • Faster startup detection"
echo "  • Timeout protection"
echo ""

# Use the fast build orchestrator
exec ./scripts/build_orchestrator_fast.sh
