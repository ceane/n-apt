#!/bin/bash

# N-APT Build Orchestrator - Visual Build Output System
# Master controller for all build processes with enhanced visual output

set -e

# Shared env defaults
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/env.sh" ]; then
    source "$SCRIPT_DIR/env.sh"
fi

# Export for child processes (cargo, vite)
export APP_URL WEBSOCKETS_URL WASM_BUILD_PATH
export VITE_BACKEND_URL=${VITE_BACKEND_URL:-$WEBSOCKETS_URL}
export VITE_WS_URL=${VITE_WS_URL:-$WEBSOCKETS_URL}
NO_BOX_ANIM=${NO_BOX_ANIM:-1}
STOP_ANIM=0

# Color definitions
WHITE="\033[37m"
BLUE="\033[34m"
ORANGE="\033[38;5;208m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
GREY="\033[38;5;145m"
RESET="\033[0m"

# Global variables for tracking
ERROR_COUNT=0
WARNING_COUNT=0
START_TIME=$(date +%s)
VITE_PID=""
RUST_PID=""
REDIS_PID=""
BOX_WIDTH=61
INNER_WIDTH=$((BOX_WIDTH - 2))
APP_URL=${APP_URL:-${SITE_URL:-http://localhost:5173}}
WEBSOCKETS_URL=${WEBSOCKETS_URL:-${BACKEND_URL:-http://localhost:8765}}
WASM_BUILD_PATH=${WASM_BUILD_PATH:-${WASM_OUT:-packages/n_apt_canvas}}

# Logo rendering function
render_logo() {
    echo -e "${WHITE}┌─────┐"
    echo -e "${WHITE}│ n a │"
    echo -e "${WHITE}│ p t │"
    echo -e "${WHITE}└─────┘${RESET}"
}

# Header section
show_header() {
    render_logo
    echo "(c) 2026 🇺🇸 Made in the USA"
    echo ""
}

# Braille spinner animation
get_braille_spinner() {
    local spinners=("⠁" "⠃" "⠉" "⠙" "⠑" "⠋" "⠛" "⠓" "⠊" "⠚" "⠌" "⠜" "⠎" "⠞" "⠏" "⠟" "⠐" "⠑" "⠒" "⠓" "⠔" "⠕" "⠖" "⠗" "⠘" "⠙" "⠚" "⠛" "⠜" "⠝" "⠞" "⠟" "⠠" "⠡" "⠢" "⠣" "⠤" "⠥" "⠦" "⠧" "⠨" "⠩" "⠪" "⠫" "⠬" "⠭" "⠮" "⠯" "⠰" "⠱" "⠲" "⠳" "⠴" "⠵" "⠶" "⠷" "⠸" "⠹" "⠺" "⠻" "⠼" "⠽" "⠾" "⠿")
    local current_time=$(date +%s.%N 2>/dev/null || date +%s)
    local spinner_index=$(echo "$current_time * 10" | bc 2>/dev/null || echo "0")
    spinner_index=${spinner_index%.*}
    spinner_index=$((spinner_index % ${#spinners[@]}))
    echo "${spinners[$spinner_index]}"
}

animate_process_step() {
    local spinner_label="$1"
    local final_line="$2"
    local duration_tenths="${3:-1}"  # tenths of a second, integer
    if ! [[ "$duration_tenths" =~ ^[0-9]+$ ]]; then
        duration_tenths=1
    fi
    local iterations=$duration_tenths
    if [ $iterations -le 0 ]; then
        iterations=1
    fi

    # If not a TTY (e.g., npm piping), skip animation to avoid multiline spinner noise
    if [ ! -t 1 ]; then
        printf "%b\n" "$spinner_label"
        printf "%b\n" "$final_line"
        return
    fi

    for ((i=0; i<iterations; i++)); do
        local spinner=$(get_braille_spinner)
        printf "\r\033[K${GREY}%s${RESET} %b" "$spinner" "$spinner_label"
        sleep 0.1
    done

    printf "\r\033[K%b\n" "$final_line"
}
# Show process setup messages using the braille animation
show_process_messages() {
    # Kill blockers first, then quick confirm
    ./scripts/kill_blockers.sh
    animate_process_step "${WHITE}Cleaning up existing processes...${RESET}" "${WHITE}✔ Cleaning up existing processes.${RESET}" 2
    
    # Start Redis server and load tower data
    animate_process_step "${WHITE}Starting Redis server...${RESET}" "${WHITE}✔ Starting Redis server...${RESET}" 1
    if ./scripts/setup_redis.sh start; then
        REDIS_PID=$(lsof -ti:6379 2>/dev/null || echo "")
        animate_process_step "${WHITE}Loading tower data into Redis...${RESET}" "${WHITE}✔ Loading tower data into Redis...${RESET}" 2
        ./scripts/setup_redis.sh load
    else
        echo -e "${RED}✗ Failed to start Redis server${RESET}"
        REDIS_PID=""
    fi
    
    # Start frontend (Vite will pick up VITE_* env set above)
    rm -rf node_modules/.vite node_modules/.cache/vite 2>/dev/null || true
    node_modules/.bin/vite dev --host > /tmp/vite_output.log 2>&1 &
    VITE_PID=$!
    animate_process_step "${WHITE}Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" "${WHITE}✔ Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" 1
    
    # Checks
    animate_process_step "${WHITE}Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
    animate_process_step "${WHITE}Checking to build wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" "${WHITE}✔ Checking to build wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" 1

    # Build WASM with smart retry (no timeout — waits until finished)
    smart_wasm_build /tmp/wasm_build.log &
    WASM_PID=$!
    WASM_FAILED=0
    if ! wait_with_spinner $WASM_PID "${WHITE}Building (wasm_simd)...${RESET}" "${WHITE}✔ Building (wasm_simd)...${RESET}" "${RED}✗ Building (wasm_simd) failed${RESET}" 0; then
        WASM_FAILED=1
    fi
    # Count wasm warnings/errors
    if [ -f /tmp/wasm_build.log ]; then
        WASM_WARNINGS=$(grep -c "warning\[" /tmp/wasm_build.log 2>/dev/null || true)
        WASM_ERRORS=$(grep -c "error\[" /tmp/wasm_build.log 2>/dev/null || true)
        WARNING_COUNT=$((WARNING_COUNT + WASM_WARNINGS))
        if [ "$WASM_ERRORS" -gt 0 ] 2>/dev/null; then
            ERROR_COUNT=$((ERROR_COUNT + WASM_ERRORS))
            WASM_FAILED=1
        fi
    fi
    
    # Build backend with smart retry (no timeout — waits until finished)
    smart_cargo_build /tmp/cargo_build.log build --bin n-apt-backend &
    CARGO_PID=$!
    CARGO_BUILD_STATUS=0
    if ! wait_with_spinner $CARGO_PID "${WHITE}Building (backend)... ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Building (backend)... ${ORANGE}Rust${RESET}.${RESET}" "${RED}✗ Building (backend) failed${RESET}" 0; then
        CARGO_BUILD_STATUS=1
    fi
    # Count backend warnings/errors from log
    if [ -f /tmp/cargo_build.log ]; then
        CARGO_WARNINGS=$(grep -c "warning\[" /tmp/cargo_build.log 2>/dev/null || true)
        CARGO_ERRORS=$(grep -c "error\[" /tmp/cargo_build.log 2>/dev/null || true)
        WARNING_COUNT=$((WARNING_COUNT + CARGO_WARNINGS))
        if [ "$CARGO_ERRORS" -gt 0 ] 2>/dev/null; then
            ERROR_COUNT=$((ERROR_COUNT + CARGO_ERRORS))
        fi
    fi
    if [ $CARGO_BUILD_STATUS -ne 0 ] || grep -q "^error" /tmp/cargo_build.log 2>/dev/null; then
        BUILD_FAILED=1
    else
        BUILD_FAILED=0
    fi

    if [ $BUILD_FAILED -eq 0 ] && [ $WASM_FAILED -eq 0 ]; then
        cargo run --bin n-apt-backend > /tmp/rust_output.log 2>&1 &
        RUST_PID=$!
        if ! wait_for_backend_ready $RUST_PID "${WHITE}Starting backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Starting backend server. ${ORANGE}Rust${RESET}.${RESET}" "${RED}✗ Starting backend server failed${RESET}"; then
            RUST_PID=""
        fi
    else
        RUST_PID=""
    fi
    
    echo ""
    echo ""
}

# Build WASM_SIMD package
build_wasm_simd() {
    echo -e "${BLUE}Building WASM_SIMD package...${RESET}"
    
    if ./scripts/check_changes.sh "packages/n_apt_canvas" "src/rs/lib.rs" "src/rs/wasm_simd/*.rs" "Cargo.toml" "Cargo.lock"; then
        echo -e "${ORANGE}📦 Building WASM_SIMD SIMD module with optimizations...${RESET}"
        mkdir -p packages/n_apt_canvas
        
        # Capture WASM_SIMD build output for warnings/errors
        WASM_SIMD_OUTPUT=$(RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir packages/n_apt_canvas --dev 2>&1 || true)
        
        if echo "$WASM_SIMD_OUTPUT" | grep -q "error:"; then
            echo -e "${RED}✗ WASM_SIMD build failed${RESET}"
            ERROR_COUNT=$((ERROR_COUNT + 1))
        else
            echo -e "${GREEN}✓ WASM_SIMD SIMD module built successfully!${RESET}"
        fi
        
        # Count warnings
        WASM_SIMD_WARNINGS=$(echo "$WASM_SIMD_OUTPUT" | grep -c "warning:" || true)
        WARNING_COUNT=$((WARNING_COUNT + WASM_SIMD_WARNINGS))
    else
        echo -e "${GREEN}✅ WASM_SIMD SIMD module is up to date, skipping build...${RESET}"
    fi
}

# Build Rust backend
build_rust_backend() {
    echo -e "${BLUE}Building Rust backend server...${RESET}"
    
    # Check if port 8765 is in use and kill existing process
    if lsof -ti:8765 > /dev/null 2>&1; then
        echo -e "${YELLOW}  Port 8765 is in use. Killing existing process...${RESET}"
        lsof -ti:8765 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    # Build in dev-fast mode
    echo -e "${ORANGE}Building Rust backend server (dev-fast profile)...${RESET}"
    
    # Capture Rust build output
    RUST_OUTPUT=$(cargo build --profile dev-fast 2>&1 || true)
    
    if echo "$RUST_OUTPUT" | grep -q "error:"; then
        echo -e "${RED}✗ Rust server build failed${RESET}"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    else
        echo -e "${GREEN}✓ Rust server built successfully (dev mode)${RESET}"
        BINARY_PATH="target/dev-fast/n-apt-backend"
    fi
    
    # Count warnings
    RUST_WARNINGS=$(echo "$RUST_OUTPUT" | grep -c "warning:" || true)
    WARNING_COUNT=$((WARNING_COUNT + RUST_WARNINGS))
}

# Start frontend server
start_frontend() {
    echo -e "${BLUE}Starting frontend server...${RESET}"
    
    # Clear Vite cache
    rm -rf node_modules/.vite node_modules/.cache/vite 2>/dev/null || true
    
    # Start Vite in background and capture PID
    npm run dev > /tmp/vite_output.log 2>&1 &
    VITE_PID=$!
    
    # Wait for Vite to start
    sleep 3
    
    # Check if Vite is running
    if ps -p $VITE_PID > /dev/null; then
        echo -e "${GREEN}✓ Frontend server started (PID: $VITE_PID)${RESET}"
    else
        echo -e "${RED}✗ Frontend server failed to start${RESET}"
        ERROR_COUNT=$((ERROR_COUNT + 1))
        VITE_PID=""
    fi
}

# Start backend server
start_backend() {
    echo -e "${BLUE}Starting backend server...${RESET}"
    
    if [ -n "$BINARY_PATH" ] && [ -f "$BINARY_PATH" ]; then
        # Start backend in background
        RUST_LOG=info ./"$BINARY_PATH" > /tmp/rust_output.log 2>&1 &
        RUST_PID=$!
        
        # Wait for backend to start
        sleep 2
        
        # Check if backend is running
        if ps -p $RUST_PID > /dev/null; then
            echo -e "${GREEN}✓ Backend server started (PID: $RUST_PID)${RESET}"
        else
            echo -e "${RED}✗ Backend server failed to start${RESET}"
            ERROR_COUNT=$((ERROR_COUNT + 1))
            RUST_PID=""
        fi
    else
        echo -e "${RED}✗ Backend binary not found${RESET}"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
}

# Helper to print a line in the box
print_box_line() {
    local left_str="$1"
    local right_str="$2"
    local left_colored="$3"
    local right_colored="$4"
    
    local left_len=${#left_str}
    # Compensate for emoji double-width rendering
    if [[ "$left_str" == *"🧠"* ]]; then
        left_len=$((left_len + 1))
    fi
    local right_len=${#right_str}
    local total_content=$((left_len + right_len))
    local pad_len=$((INNER_WIDTH - total_content))
    
    local pad=""
    if [ $pad_len -gt 0 ]; then
        for ((i=0; i<pad_len; i++)); do pad+=" "; done
    fi
    
    echo -e "${WHITE}│${RESET}${left_colored}${pad}${right_colored}${WHITE}│${RESET}"
}

# Braille spinner animation
get_braille_spinner() {
    local spinners=("⠁" "⠃" "⠉" "⠙" "⠑" "⠋" "⠛" "⠓" "⠊" "⠚" "⠌" "⠜" "⠎" "⠞" "⠏" "⠟" "⠐" "⠑" "⠒" "⠓" "⠔" "⠕" "⠖" "⠗" "⠘" "⠙" "⠚" "⠛" "⠜" "⠝" "⠞" "⠟" "⠠" "⠡" "⠢" "⠣" "⠤" "⠥" "⠦" "⠧" "⠨" "⠩" "⠪" "⠫" "⠬" "⠭" "⠮" "⠯" "⠰" "⠱" "⠲" "⠳" "⠴" "⠵" "⠶" "⠷" "⠸" "⠹" "⠺" "⠻" "⠼" "⠽" "⠾" "⠿")
    local current_time=$(date +%s)
    local spinner_index=$((current_time % ${#spinners[@]}))
    echo "${spinners[$spinner_index]}"
}

# Spinner wrapper for async commands
# timeout_seconds=0 means wait indefinitely (never kill the build)
wait_with_spinner() {
    local pid=$1
    local label="$2"
    local success_line="$3"
    local fail_line="$4"
    local timeout_seconds=${5:-0}  # Default 0 = wait forever

    while kill -0 $pid 2>/dev/null; do
        # If timeout is set and exceeded, kill the process
        if [ $timeout_seconds -gt 0 ]; then
            local elapsed=$(( $(date +%s) - START_TIME ))
            if [ $elapsed -ge $timeout_seconds ]; then
                kill $pid 2>/dev/null || true
                wait $pid >/dev/null 2>&1 || true
                printf "\r\033[K${RED}✗ %s (timeout after %ds)${RESET}\n" "$label" "$timeout_seconds"
                ERROR_COUNT=$((ERROR_COUNT + 1))
                return 1
            fi
        fi
        local spinner=$(get_braille_spinner)
        printf "\r\033[K${GREY}%s${RESET} %b" "$spinner" "$label"
        sleep 0.2
    done
    
    # Process finished naturally
    local status=0
    wait $pid >/dev/null 2>&1 || status=$?
    if [ $status -eq 0 ]; then
        printf "\r\033[K%b\n" "$success_line"
    else
        printf "\r\033[K%b\n" "$fail_line"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
    return $status
}

# Smart cargo build: detects stale incremental artifacts and auto-cleans
# Usage: smart_cargo_build <log_file> <cargo_args...>
# Note: all build commands use "|| true" to prevent set -e from killing
# the script before retry logic can run
smart_cargo_build() {
    local log_file="$1"
    shift
    local cargo_args=("$@")
    
    # First attempt (|| true prevents set -e exit)
    local status=0
    cargo "${cargo_args[@]}" > "$log_file" 2>&1 || status=$?
    
    if [ $status -ne 0 ] && [ -f "$log_file" ]; then
        # Check for linker errors (stale .rlib files) — needs full cargo clean
        if grep -qiE "(linking with.*cc.*failed|symbol.*not found|linker command failed|undefined symbols? for architecture)" "$log_file" 2>/dev/null; then
            printf "\r\033[K${YELLOW}⟳ Fixing linking errors... running full cargo clean and retrying${RESET}\n"
            cargo clean 2>/dev/null || true
            status=0
            cargo "${cargo_args[@]}" > "$log_file" 2>&1 || status=$?
        # Check for stale incremental compilation patterns — package-level clean
        elif grep -qiE "(found possibly newer version of crate|incremental compilation|failed to load dep-info|could not compile.*aborting|internal compiler error|fingerprint.*mismatch|query result|broken MIR)" "$log_file" 2>/dev/null; then
            printf "\r\033[K${YELLOW}⟳ Stale build artifacts detected, running cargo clean and retrying...${RESET}\n"
            cargo clean -p n-apt-backend 2>/dev/null || cargo clean 2>/dev/null || true
            status=0
            cargo "${cargo_args[@]}" > "$log_file" 2>&1 || status=$?
        fi
    fi
    
    return $status
}

# Smart wasm build: detects stale artifacts and auto-cleans
# Note: all build commands use "|| true" to prevent set -e from killing
# the script before retry logic can run
smart_wasm_build() {
    local log_file="$1"
    local wasm_out="${WASM_BUILD_PATH:-packages/n_apt_canvas}"
    
    # First attempt (|| true prevents set -e exit)
    local status=0
    RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir "$wasm_out" --dev > "$log_file" 2>&1 || status=$?
    
    if [ $status -ne 0 ] && [ -f "$log_file" ]; then
        # Check for linker errors first
        if grep -qiE "(linking with.*cc.*failed|symbol.*not found|linker command failed|undefined symbols? for architecture)" "$log_file" 2>/dev/null; then
            printf "\r\033[K${YELLOW}⟳ Fixing WASM linking errors... running full clean and retrying${RESET}\n"
            cargo clean 2>/dev/null || true
            rm -rf "$wasm_out" 2>/dev/null || true
            mkdir -p "$wasm_out"
            status=0
            RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir "$wasm_out" --dev > "$log_file" 2>&1 || status=$?
        # Check for stale incremental compilation patterns
        elif grep -qiE "(found possibly newer version of crate|incremental compilation|failed to load dep-info|could not compile.*aborting|internal compiler error|fingerprint.*mismatch|query result|broken MIR)" "$log_file" 2>/dev/null; then
            printf "\r\033[K${YELLOW}⟳ Stale WASM artifacts detected, cleaning and retrying...${RESET}\n"
            cargo clean --target wasm32-unknown-unknown 2>/dev/null || cargo clean 2>/dev/null || true
            rm -rf "$wasm_out" 2>/dev/null || true
            mkdir -p "$wasm_out"
            status=0
            RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir "$wasm_out" --dev > "$log_file" 2>&1 || status=$?
        fi
    fi
    
    return $status
}

# Wait for backend readiness by watching log while spinning
wait_for_backend_ready() {
    local pid=$1
    local label="$2"
    local success_line="$3"
    local fail_line="$4"
    local max_checks=50

    # Derive host/port from WEBSOCKETS_URL for faster readiness detection
    local ws_url=${WEBSOCKETS_URL:-http://localhost:8765}
    local hp=${ws_url#*//}
    hp=${hp%%/*}
    local ws_host=${hp%:*}
    local ws_port=${hp#*:}
    [ -z "$ws_host" ] && ws_host="127.0.0.1"
    [[ "$ws_port" == "$ws_host" ]] && ws_port=8765

    for i in $(seq 1 $max_checks); do
        if ! kill -0 $pid 2>/dev/null; then
            printf "\r\033[K%b\n" "$fail_line"
            ERROR_COUNT=$((ERROR_COUNT + 1))
            return 1
        fi
        # Success if log is present or port is listening (use lsof instead of TCP test)
        if grep -q "Starting server on" /tmp/rust_output.log 2>/dev/null || lsof -ti:8765 >/dev/null 2>&1; then
            printf "\r\033[K%b\n" "$success_line"
            return 0
        fi
        local spinner=$(get_braille_spinner)
        printf "\r\033[K${GREY}%s${RESET} %b" "$spinner" "$label"
        sleep 0.2
    done
    printf "\r\033[K%b\n" "$fail_line"
    ERROR_COUNT=$((ERROR_COUNT + 1))
    return 1
}

# Show unified output box
render_unified_box_frame() {
    local spinner="$1"
    local skip_leading_newline="${2:-0}"

    if [ -z "$VITE_PID" ] || [ -z "$RUST_PID" ]; then
        echo -e "${RED}✗ One or more services failed to start${RESET}"
        return
    fi

    # Use a locked duration if set (from show_unified_box) so the timer stops ticking during animation
    if [ -n "$BOX_DURATION" ]; then
        DURATION=$BOX_DURATION
    else
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))
    fi
    
    # Force terminal width to a specific value if provided via env var
    TERM_WIDTH=${FORCE_COLOR_WIDTH:-0}

    if [ "$TERM_WIDTH" -eq 0 ]; then
        # Try to get the real terminal width even when piped through npm
        # Reading from /dev/tty bypasses npm's stdout redirection
        if STTY_SIZE=$(stty size < /dev/tty 2>/dev/null); then
            TERM_WIDTH=$(echo "$STTY_SIZE" | awk '{print $2}')
        elif TPUT_COLS=$(tput cols < /dev/tty 2>/dev/null); then
            TERM_WIDTH=$TPUT_COLS
        elif [ -n "$COLUMNS" ]; then
            TERM_WIDTH=$COLUMNS
        else
            TERM_WIDTH=80
        fi
    fi

    # Ensure it's a valid number, default to 80 if not
    if ! [[ "$TERM_WIDTH" =~ ^[0-9]+$ ]] || [ "$TERM_WIDTH" -eq 0 ]; then
        TERM_WIDTH=80
    fi
    
    echo ""
    
    if [ "$TERM_WIDTH" -lt "$BOX_WIDTH" ]; then
        # Compact mode for narrow terminals
        echo -e "${WHITE}┌─────┐${RESET}"
        echo -e "${WHITE}│ n a │${RESET} ${WHITE}✔ Running ${spinner}${RESET}"
        echo -e "${WHITE}│ p t │${RESET} ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET}"
        if [ -n "$REDIS_PID" ]; then
            echo -e "${WHITE}│     │${RESET} ${GREY}${REDIS_PID}${RESET} ${GREEN}Redis${RESET} ${GREY}PID${RESET}"
        fi
        echo -e "${WHITE}└─────┘${RESET}"
        echo ""
        echo -e "${WHITE}N-APT${RESET} 🧠  ${BLUE}${APP_URL}${RESET} ${GREY}(site)${RESET}"
        echo -e "${GREY}           cmd + click to open in default browser${RESET}"
        echo ""
        echo -e "${ORANGE}${WEBSOCKETS_URL}${RESET} ${GREY}(websockets backend)${RESET}"
        echo -e "${GREEN}redis://localhost:6379${RESET} ${GREY}(tower data)${RESET}"
        echo -e "${GREY}${WASM_BUILD_PATH} (WebGPU wasm_simd build)${RESET}"
        echo -e "${GREY}/tmp/rust_output.log (Rust logs)${RESET}"
        echo ""
        echo -e "${GREY}Press Ctrl+C to stop all services${RESET}"
        echo ""
        echo -e "${RED}✗ ${ERROR_COUNT} errors${RESET}   ${YELLOW}▲ ${WARNING_COUNT} warnings${RESET}"
        echo -e "${GREY}running in ${DURATION}s${RESET}"
    else
        # Full box mode for wide terminals
        local border_line=$(printf '─%.0s' {1..59})
        echo -e "${WHITE}┌${border_line}┐${RESET}"
        
        print_box_line " ┌─────┐" "✔ Running ${spinner} " " ${WHITE}┌─────┐${RESET}" "${WHITE}✔ Running ${spinner}${RESET} "
        
        local pid_str=" ${VITE_PID} Vite PID ⠶ ${RUST_PID} Rust server PID "
        if [ -n "$REDIS_PID" ]; then
            pid_str=" ${VITE_PID} Vite PID ⠶ ${RUST_PID} Rust server PID ⠶ ${REDIS_PID} Redis PID "
        fi
        local pid_col=" ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET} "
        if [ -n "$REDIS_PID" ]; then
            pid_col=" ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID ⠶ ${REDIS_PID}${RESET} ${GREEN}Redis${RESET} ${GREY}PID${RESET} "
        fi
        print_box_line " │ n a │" "$pid_str" " ${WHITE}│ n a │${RESET}" "$pid_col"
        print_box_line " │ p t │" " Press Ctrl+C to stop all services" " ${WHITE}│ p t │${RESET}" " ${GREY}Press Ctrl+C to stop all services${RESET}"
        print_box_line " └─────┘" " " " ${WHITE}└─────┘${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line " N-APT 🧠  ${APP_URL} (site)" " " " ${WHITE}N-APT${RESET} 🧠  ${BLUE}${APP_URL}${RESET} ${GREY}(site)${RESET}" " "
        print_box_line "           cmd + click to open in default browser" " " "           ${GREY}cmd + click to open in default browser${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line "           ${WEBSOCKETS_URL} (websockets backend)" " " "           ${ORANGE}${WEBSOCKETS_URL}${RESET} ${GREY}(websockets backend)${RESET}" " "
        print_box_line "           redis://localhost:6379 (tower data)" " " "           ${GREEN}redis://localhost:6379${RESET} ${GREY}(tower data)${RESET}" " "
        print_box_line "           ${WASM_BUILD_PATH} (WebGPU wasm_simd build)" " " "           ${GREY}${WASM_BUILD_PATH} (WebGPU wasm_simd build)${RESET}" " "
        print_box_line "           /tmp/rust_output.log (Rust logs)" " " "           ${GREY}/tmp/rust_output.log (Rust logs)${RESET}" " "
        print_box_line " " " " " " " "
        print_box_line " " " " " " " "
        
        err_str=" ✗ ${ERROR_COUNT} errors   ▲ ${WARNING_COUNT} warnings"
        err_col=" ${RED}✗ ${ERROR_COUNT} errors${RESET}   ${YELLOW}▲ ${WARNING_COUNT} warnings${RESET}"
        time_str="running in ${DURATION}s "
        time_col="${GREY}running in ${DURATION}s${RESET} "
        
        print_box_line "$err_str" "$time_str" "$err_col" "$time_col"
        
        echo -e "${WHITE}└${border_line}┘${RESET}"
    fi
}

show_unified_box() {
    # Always render once to avoid stacking frames or terminal artifacts
    BOX_DURATION=$(( $(date +%s) - START_TIME ))
    render_unified_box_frame "$(get_braille_spinner)"
}

# Extract and display a full compiler diagnostic block from a log file
# Usage: show_diagnostic_block <log_file> <pattern> <prefix_icon> <prefix_color> <max_blocks>
show_diagnostic_blocks() {
    local log_file="$1"
    local pattern="$2"         # "error" or "warning"
    local icon="$3"            # "✗" or "▲"
    local color="$4"           # RED or YELLOW escape code
    local max_blocks=${5:-5}
    local block_count=0
    local in_block=0
    local is_first_line=0
    local blank_count=0
    
    [ ! -f "$log_file" ] && return
    
    while IFS= read -r line; do
        # Skip summary lines like "warning: `n-apt-backend` ... generated 5 warnings"
        if echo "$line" | grep -qE "^warning:.*generated [0-9]+ warning"; then
            continue
        fi
        # Skip "aborting due to" summary
        if echo "$line" | grep -qE "^(error|warning): aborting due to"; then
            continue
        fi
        # Skip "could not compile" summary
        if echo "$line" | grep -qE "^error: could not compile"; then
            continue
        fi
        
        # Detect start of a new diagnostic block
        if echo "$line" | grep -qE "^${pattern}(\[E[0-9]+\])?: "; then
            # End previous block if any
            if [ $in_block -eq 1 ]; then
                echo ""
            fi
            
            block_count=$((block_count + 1))
            if [ $block_count -gt $max_blocks ]; then
                break
            fi
            
            in_block=1
            is_first_line=1
            blank_count=0
            
            # Format the header line: extract the message and file path
            # Rust format: "error[E0425]: cannot find value `x` in this scope"
            #          or: "warning: unused variable: `state`"
            # Followed by: "  --> src/server/http_endpoints.rs:145:9"
            echo -e "${color}${icon}${RESET} ${color}${line}${RESET}"
            continue
        fi
        
        if [ $in_block -eq 1 ]; then
            # Track blank lines - 2 consecutive blanks signals end of block
            if [ -z "$(echo "$line" | tr -d '[:space:]')" ]; then
                blank_count=$((blank_count + 1))
                if [ $blank_count -ge 2 ]; then
                    in_block=0
                    echo ""
                    continue
                fi
                echo ""
                continue
            else
                blank_count=0
            fi
            
            # Format the --> file path line
            if echo "$line" | grep -qE "^\s*-->\s"; then
                local file_ref=$(echo "$line" | sed 's/.*--> //')
                echo -e "${color}${icon}${RESET} ${color}${pattern}:${RESET} ${WHITE}${file_ref}${RESET}"
                continue
            fi
            
            # Format = note: and = help: lines
            if echo "$line" | grep -qE "^\s*= (note|help):"; then
                echo -e "    ${GREY}${line}${RESET}"
                continue
            fi
            
            # Code context lines (with line numbers, pipes, carets)
            echo -e "    ${GREY}${line}${RESET}"
        fi
    done < "$log_file"
    
    # Close last block
    if [ $in_block -eq 1 ]; then
        echo ""
    fi
    
    return 0
}

# Show errors and warnings with rich formatting
show_errors_warnings() {
    local has_errors=0
    local has_warnings=0
    
    # Check all log files for errors/warnings
    for log_file in /tmp/cargo_build.log /tmp/wasm_build.log; do
        if [ -f "$log_file" ]; then
            if grep -qE "^error(\[E[0-9]+\])?: " "$log_file" 2>/dev/null; then
                has_errors=1
            fi
            if grep -E "^warning(\[E[0-9]+\])?: " "$log_file" 2>/dev/null | grep -qv "generated .* warning" 2>/dev/null; then
                has_warnings=1
            fi
        fi
    done
    
    # Display errors section
    if [ $has_errors -eq 1 ] || [ $ERROR_COUNT -gt 0 ]; then
        echo ""
        echo -e "${RED}✗ Errors${RESET}"
        for log_file in /tmp/cargo_build.log /tmp/wasm_build.log; do
            show_diagnostic_blocks "$log_file" "error" "✗" "$RED" 5
        done
    fi
    
    # Display warnings section
    if [ $has_warnings -eq 1 ] || [ $WARNING_COUNT -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}▲ Warnings${RESET}"
        for log_file in /tmp/cargo_build.log /tmp/wasm_build.log; do
            show_diagnostic_blocks "$log_file" "warning" "▲" "$YELLOW" 5
        done
    fi
}

# Cleanup function on exit
cleanup_on_exit() {
    if [ -n "$VITE_PID" ]; then
        kill $VITE_PID 2>/dev/null || true
    fi
    if [ -n "$RUST_PID" ]; then
        kill $RUST_PID 2>/dev/null || true
    fi
    if [ -n "$REDIS_PID" ]; then
        echo -e "${GREY}Stopping Redis server...${RESET}"
        kill $REDIS_PID 2>/dev/null || true
    fi
}

# Set up cleanup trap and stop animation on Ctrl+C
trap cleanup_on_exit EXIT
trap 'STOP_ANIM=1' INT

# Main execution
main() {
    show_header
    echo ""
    
    show_process_messages

    show_errors_warnings
    show_unified_box
    
    # Keep script running to maintain services
    if [ -n "$VITE_PID" ] && [ -n "$RUST_PID" ]; then
        while true; do
            if ! ps -p $VITE_PID > /dev/null 2>&1 || ! ps -p $RUST_PID > /dev/null 2>&1; then
                break
            fi
            sleep 5
        done
    fi
}

# Run main function
main "$@"
