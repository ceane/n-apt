#!/bin/bash

# Development script for N-APT with hot reloading
# This script starts the server in dev mode and provides commands for testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo -e "\033[38;5;208mN-APT Development Server with Hot Reload\033[0m"
echo "======================================="
echo ""

# Check if mock_signals.yaml exists
if [ ! -f "mock_signals.yaml" ]; then
    echo -e "\033[33m⚠ mock_signals.yaml not found. Creating default configuration...\033[0m"
    # The file should already exist from our implementation
fi

# Start the server in dev mode
echo -e "\033[32mStarting server in development mode...\033[0m"
echo "Hot reload enabled for mock_signals.yaml"
echo ""
echo "Commands while running:"
echo "  - Edit mock_signals.yaml to reload configuration"
echo "  - Send WebSocket message: {\"type\":\"reload_config\"}"
echo "  - Press Ctrl+C to stop"
echo ""

./start_server.sh --dev
