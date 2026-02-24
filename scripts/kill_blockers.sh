#!/bin/bash
# Kill blocking N-APT processes and ports
set -e

pkill -f "n-apt-backend" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
fkill --force 'n-apt-backend' ':5173' ':8765' 2>/dev/null || true