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
    
    # Start frontend (Vite will pick up VITE_* env set above)
    node_modules/.bin/vite dev --host > /tmp/vite_output.log 2>&1 &
    VITE_PID=$!
    animate_process_step "${WHITE}Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" "${WHITE}✔ Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" 1
    
    # Checks
    animate_process_step "${WHITE}Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
    animate_process_step "${WHITE}Checking to build wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" "${WHITE}✔ Checking to build wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" 1

    # Builds (async with spinner)
    npm run build:wasm > /tmp/wasm_build.log 2>&1 &
    WASM_PID=$!
    WASM_FAILED=0
    if ! wait_with_spinner $WASM_PID "${WHITE}Building (wasm_simd)...${RESET}" "${WHITE}✔ Building (wasm_simd)...${RESET}" "${RED}✗ Building (wasm_simd) failed${RESET}" 120; then
        WASM_FAILED=1
    fi
    # Count wasm warnings if any
    if [ -f /tmp/wasm_build.log ]; then
        WASM_WARNINGS=$(grep -c "warning:" /tmp/wasm_build.log || true)
        WARNING_COUNT=$((WARNING_COUNT + WASM_WARNINGS))
    fi
    
    cargo build --bin n-apt-backend > /tmp/cargo_build.log 2>&1 &
    CARGO_PID=$!
    CARGO_BUILD_STATUS=0
    if ! wait_with_spinner $CARGO_PID "${WHITE}Building (backend)... ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Building (backend)... ${ORANGE}Rust${RESET}.${RESET}" "${RED}✗ Building (backend) failed${RESET}" 90; then
        CARGO_BUILD_STATUS=$?
    fi
    CARGO_WARNINGS=$(grep -c "warning:" /tmp/cargo_build.log || true)
    WARNING_COUNT=$((WARNING_COUNT + CARGO_WARNINGS))
    if [ $CARGO_BUILD_STATUS -ne 0 ] || grep -q "error:" /tmp/cargo_build.log 2>/dev/null; then
        ERROR_COUNT=$((ERROR_COUNT + 1))
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
wait_with_spinner() {
    local pid=$1
    local label="$2"
    local success_line="$3"
    local fail_line="$4"
    local timeout_seconds=${5:-60}  # Default 60s timeout
    local count=0

    while kill -0 $pid 2>/dev/null && [ $count -lt $timeout_seconds ]; do
        local spinner=$(get_braille_spinner)
        printf "\r\033[K${GREY}%s${RESET} %b" "$spinner" "$label"
        sleep 0.1
        count=$((count + 1))
    done
    
    # Check if process is still running (timeout)
    if kill -0 $pid 2>/dev/null; then
        kill $pid 2>/dev/null || true  # Force kill
        wait $pid >/dev/null 2>&1 || true
        printf "\r\033[K${RED}✗ %s (timeout after %ds)${RESET}\n" "$label" "$timeout_seconds"
        ERROR_COUNT=$((ERROR_COUNT + 1))
        return 1
    fi
    
    # Process finished normally
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
        echo -e "${WHITE}└─────┘${RESET}"
        echo ""
        echo -e "${WHITE}N-APT${RESET} 🧠  ${BLUE}${APP_URL}${RESET} ${GREY}(site)${RESET}"
        echo -e "${GREY}           cmd + click to open in default browser${RESET}"
        echo ""
        echo -e "${ORANGE}${WEBSOCKETS_URL}${RESET} ${GREY}(websockets backend)${RESET}"
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
        local pid_col=" ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET} "
        print_box_line " │ n a │" "$pid_str" " ${WHITE}│ n a │${RESET}" "$pid_col"
        print_box_line " │ p t │" " Press Ctrl+C to stop all services" " ${WHITE}│ p t │${RESET}" " ${GREY}Press Ctrl+C to stop all services${RESET}"
        print_box_line " └─────┘" " " " ${WHITE}└─────┘${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line " N-APT 🧠  ${APP_URL} (site)" " " " ${WHITE}N-APT${RESET} 🧠  ${BLUE}${APP_URL}${RESET} ${GREY}(site)${RESET}" " "
        print_box_line "           cmd + click to open in default browser" " " "           ${GREY}cmd + click to open in default browser${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line "           ${WEBSOCKETS_URL} (websockets backend)" " " "           ${ORANGE}${WEBSOCKETS_URL}${RESET} ${GREY}(websockets backend)${RESET}" " "
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

# Show errors and warnings (moved before runtime status)
show_errors_warnings() {
    echo ""
    
    # Show warnings from cargo log if present
    if [ $WARNING_COUNT -gt 0 ] && [ -f /tmp/cargo_build.log ]; then
        WARN_NUMS=$(grep -n "warning:" /tmp/cargo_build.log | grep -v "generated .* warning" | grep -v "\`n-apt-backend\`" | head -n 3 | cut -d: -f1)
        while IFS= read -r num; do
            [ -z "$num" ] && continue
            warn_line=$(sed -n "${num}p" /tmp/cargo_build.log)
            next_line_num=$((num + 1))
            path_line=$(sed -n "${next_line_num}p" /tmp/cargo_build.log)
            echo -e "${YELLOW}▲${RESET} ${WHITE}${warn_line}${RESET}"
            if [ -n "$path_line" ]; then
                echo -e "    ${GREY}${path_line}${RESET}"
            fi
        done <<< "$WARN_NUMS"
    fi
    
    # Show errors from cargo log if present
    if [ $ERROR_COUNT -gt 0 ] && [ -f /tmp/cargo_build.log ]; then
        ERR_LINES=$(grep "error:" /tmp/cargo_build.log | head -n 3)
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            echo -e "${RED}✗${RESET} ${WHITE}${line}${RESET}"
        done <<< "$ERR_LINES"
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
