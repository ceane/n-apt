#!/bin/bash
# Indent and colorize server output line by line.
# The raw server output is piped here BEFORE concurrently adds its [N] prefix.
# env_logger may include its own ANSI codes; we strip them first so our
# coloring is the only source of color for each line.

strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

while IFS= read -r line; do
    clean=$(echo "$line" | strip_ansi)
    case "$clean" in
        *"No RTL-SDR devices found"*|*"RTL-SDR device disconnected"*)
            echo -e "  \033[31m${clean}\033[0m" ;;
        *"RTL-SDR device initialized"*|*"RTL-SDR device initialized (hotplug)"*)
            echo -e "  \033[32m${clean}\033[0m" ;;
        *"SDR processor initialized: Mock"*)
            echo -e "  \033[33m${clean}\033[0m" ;;
        *"SDR I/O thread started: Mock"*|*"Cancelling async read"*|*"rtlsdr_read_async returned error"*|*"Async reader thread exiting"*|*"Closing RTL-SDR device"*|*"demod"*|*"i2c"*|*"write_reg failed"*|*"Exact sample rate is"*|*"Invalid sample rate"*|*"Async reader starting"*|*"Found RTL-SDR device"*|*"Device #"*|*"Opened RTL-SDR device"*|*"Sample rate set to"*|*"Found Rafael"*|*"RTL-SDR Blog"*|*"RTL-SDR device closed"*)
            # Suppress these verbose messages
            ;;
        *)
            echo "  ${clean}" ;;
    esac
done
