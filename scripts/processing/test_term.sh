#!/bin/bash
echo "COLUMNS: $COLUMNS"
echo "tput cols: $(tput cols 2>/dev/null)"
echo "tput cols < /dev/tty: $(tput cols < /dev/tty 2>/dev/null)"
echo "stty size: $(stty size 2>/dev/null)"
echo "stty size < /dev/tty: $(stty size < /dev/tty 2>/dev/null)"
echo "node process.stdout.columns: $(node -e 'console.log(process.stdout.columns)' 2>/dev/null)"
