#!/bin/bash
# Kill blocking N-APT processes and ports
set -e

# Kill N-APT backend processes
pkill -f "n-apt-backend" 2>/dev/null || true
pkill -f "target/debug/n-apt-backend" 2>/dev/null || true
pkill -f "target/release/n-apt-backend" 2>/dev/null || true
pkill -f "target/dev-fast/n-apt-backend" 2>/dev/null || true

# Kill Vite processes
pkill -f "vite" 2>/dev/null || true
pkill -f "node_modules/.bin/vite" 2>/dev/null || true

# Kill processes using specific ports
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
lsof -ti:8765 | xargs kill -9 2>/dev/null || true

# Wait a moment for processes to die
sleep 1