#!/bin/bash
# Kill blocking N-APT processes and ports
set -e

# Kill N-APT backend processes without matching this shell itself.
pkill -9 -f '[n]-apt-backend' 2>/dev/null || true
pkill -9 -f '[t]arget/debug/n-apt-backend' 2>/dev/null || true
pkill -9 -f '[t]arget/release/n-apt-backend' 2>/dev/null || true

# Kill Vite and Redis processes without port probing.
pkill -9 -f '[v]ite' 2>/dev/null || true
pkill -9 -f 'node_modules/.bin/[v]ite' 2>/dev/null || true
pkill -9 -f '[r]edis-server' 2>/dev/null || true

# Wait a moment for processes to die
sleep 1
