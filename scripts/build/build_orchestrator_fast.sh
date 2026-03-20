#!/bin/bash

# N-APT Fast Build Orchestrator - Optimized for speed
# Fixes hanging issues with faster startup detection

set -e

# Shared env defaults
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/env.sh" ]; then
    source "$SCRIPT_DIR/env.sh"
fi

# Export for child processes
export APP_URL WEBSOCKETS_URL WASM_BUILD_PATH
export VITE_BACKEND_URL=${VITE_BACKEND_URL:-$WEBSOCKETS_URL}
export VITE_WS_URL=${VITE_WS_URL:-$WEBSOCKETS_URL}

# Color definitions
WHITE="\033[37m"
BLUE="\033[34m"
ORANGE="\033[38;5;208m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
GREY="\033[38;5;145m"
RESET="\033[0m"

# Global variables
START_TIME=$(date +%s)
VITE_PID=""
RUST_PID=""
APP_URL=${APP_URL:-${SITE_URL:-http://localhost:5173}}
WEBSOCKETS_URL=${WEBSOCKETS_URL:-${BACKEND_URL:-http://localhost:8765}}
WASM_BUILD_PATH=${WASM_BUILD_PATH:-${WASM_OUT:-packages/n_apt_canvas}}

# Fast logo
show_header() {
    echo -e "${WHITE}┌─────┐"
    echo -e "${WHITE}│ n a │"
    echo -e "${WHITE}│ p t │"
    echo -e "${WHITE}└─────┘${RESET}"
    echo "(c) 2026 🇺🇸 Made in the USA"
    echo ""
}

# Fast spinner
get_spinner() {
    local spinners=("⠁" "⠃" "⠉" "⠙" "⠑" "⠋" "⠛" "⠓")
    local current_time=$(date +%s)
    local spinner_index=$((current_time % ${#spinners[@]}))
    echo "${spinners[$spinner_index]}"
}

# Fast wait with timeout
wait_with_timeout() {
    local pid=$1
    local timeout_seconds=${2:-30}
    local label="$3"
    
    local count=0
    while kill -0 $pid 2>/dev/null && [ $count -lt $timeout_seconds ]; do
        local spinner=$(get_spinner)
        printf "\r\033[K${GREY}%s${RESET} %s" "$spinner" "$label"
        sleep 0.1
        count=$((count + 1))
    done
    
    if kill -0 $pid 2>/dev/null; then
        # Process still running, kill it
        kill $pid 2>/dev/null || true
        wait $pid 2>/dev/null || true
        printf "\r\033[K${RED}✗ %s (timeout after %ds)${RESET}\n" "$label" "$timeout_seconds"
        return 1
    else
        # Process finished
        wait $pid >/dev/null 2>&1 || true
        printf "\r\033[K${GREEN}✓ %s${RESET}\n" "$label"
        return 0
    fi
}

# Fast backend readiness check
wait_for_backend_fast() {
    local pid=$1
    local max_checks=50  # Reduced from 150
    local check_interval=0.1  # Faster checking
    
    for i in $(seq 1 $max_checks); do
        if ! kill -0 $pid 2>/dev/null; then
            printf "\r\033[K${RED}✗ Backend process died${RESET}\n"
            return 1
        fi
        
        # Fast check: use lsof instead of TCP test (more reliable)
        if lsof -ti:8765 >/dev/null 2>&1; then
            printf "\r\033[K${GREEN}✓ Backend ready on port 8765${RESET}\n"
            return 0
        fi
        
        local spinner=$(get_spinner)
        printf "\r\033[K${GREY}%s${RESET} Starting backend server..." "$spinner"
        sleep $check_interval
    done
    
    printf "\r\033[K${RED}✗ Backend startup timeout${RESET}\n"
    return 1
}

# Cleanup function
cleanup_on_exit() {
    if [ -n "$VITE_PID" ]; then
        kill $VITE_PID 2>/dev/null || true
    fi
    if [ -n "$RUST_PID" ]; then
        kill $RUST_PID 2>/dev/null || true
    fi
}

trap cleanup_on_exit EXIT

# Main function
main() {
    show_header
    echo -e "${WHITE}Fast Development Build - Optimized for speed${RESET}"
    echo ""
    
    # Kill any existing processes
    echo -e "${GREY}Cleaning up existing processes...${RESET}"
    scripts/kill_blockers.sh >/dev/null 2>&1 || true
    
    # Start frontend first (takes time to initialize)
    echo -e "${BLUE}Starting frontend server...${RESET}"
    npm run dev > /tmp/vite_output.log 2>&1 &
    VITE_PID=$!
    
    # Build WASM in parallel
    echo -e "${BLUE}Building WASM module...${RESET}"
    npm run build:wasm > /tmp/wasm_build.log 2>&1 &
    WASM_PID=$!
    
    # Wait for WASM build with timeout
    if ! wait_with_timeout $WASM_PID 60 "Building WASM module..."; then
        echo -e "${RED}WASM build failed or timed out${RESET}"
        # Continue anyway - don't hang the whole process
    fi
    
    # Build backend
    echo -e "${BLUE}Building backend server...${RESET}"
    cargo build --bin n-apt-backend > /tmp/cargo_build.log 2>&1
    if [ $? -ne 0 ]; then
        echo -e "${RED}Backend build failed${RESET}"
        if [ -f /tmp/cargo_build.log ]; then
            tail -10 /tmp/cargo_build.log
        fi
        exit 1
    fi
    echo -e "${GREEN}✓ Backend built successfully${RESET}"
    
    # Start backend
    echo -e "${BLUE}Starting backend server...${RESET}"
    cargo run --bin n-apt-backend > /tmp/rust_output.log 2>&1 &
    RUST_PID=$!
    
    # Wait for backend with fast check
    if ! wait_for_backend_fast $RUST_PID; then
        echo -e "${RED}Backend startup failed${RESET}"
        if [ -f /tmp/rust_output.log ]; then
            tail -10 /tmp/rust_output.log
        fi
        exit 1
    fi
    
    # Show final status
    echo ""
    echo -e "${GREEN}🚀 All services started successfully!${RESET}"
    echo ""
    echo -e "${WHITE}┌─────┐${RESET} ${GREEN}✔ Running${RESET}"
    echo -e "${WHITE}│ n a │${RESET} ${BLUE}Frontend:${RESET} ${APP_URL}"
    echo -e "${WHITE}│ p t │${RESET} ${ORANGE}Backend:${RESET}  ${WEBSOCKETS_URL}"
    echo -e "${WHITE}└─────┘${RESET}"
    echo ""
    echo -e "${GREY}Press Ctrl+C to stop all services${RESET}"
    echo ""
    
    # Keep running
    if [ -n "$VITE_PID" ] && [ -n "$RUST_PID" ]; then
        while true; do
            if ! ps -p $VITE_PID > /dev/null 2>&1 || ! ps -p $RUST_PID > /dev/null 2>&1; then
                echo -e "${RED}One or more services stopped${RESET}"
                break
            fi
            sleep 5
        done
    fi
}

main "$@"
