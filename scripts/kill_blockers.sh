#!/bin/bash
# Kill blocking N-APT processes and ports
set -e

fkill --force 'n-apt-backend' ':5173' ':8765' 2>/dev/null || true
