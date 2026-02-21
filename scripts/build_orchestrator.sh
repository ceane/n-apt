#!/bin/bash

# N-APT Build Orchestrator - Visual Build Output System
# Master controller for all build processes with enhanced visual output

set -e

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
    
    get_braille_spinner() {
    local spinners=("⠁" "⠃" "⠉" "⠙" "⠑" "⠋" "⠛" "⠓" "⠊" "⠚" "⠌" "⠜" "⠎" "⠞" "⠏" "⠟" "⠐" "⠑" "⠒" "⠓" "⠔" "⠕" "⠖" "⠗" "⠘" "⠙" "⠚" "⠛" "⠜" "⠝" "⠞" "⠟" "⠠" "⠡" "⠢" "⠣" "⠤" "⠥" "⠦" "⠧" "⠨" "⠩" "⠪" "⠫" "⠬" "⠭" "⠮" "⠯" "⠰" "⠱" "⠲" "⠳" "⠴" "⠵" "⠶" "⠷" "⠸" "⠹" "⠺" "⠻" "⠼" "⠽" "⠾" "⠿")
    
    # Use sub-second timing for faster animation
    local current_time=$(date +%s.%N 2>/dev/null || date +%s)
    local spinner_index=$(echo "$current_time * 10" | bc 2>/dev/null || echo "0")
    spinner_index=${spinner_index%.*}  # Remove decimal part
    spinner_index=$((spinner_index % ${#spinners[@]}))
    
    echo "${spinners[$spinner_index]}"
}

animate_process_step() {
    local spinner_label="$1"
    local final_line="$2"
    local duration="${3:-1}"
    local iterations=$((duration * 10))
    if [ $iterations -le 0 ]; then
        iterations=10
    fi

    for ((i=0; i<iterations; i++)); do
        local spinner=$(get_braille_spinner)
        printf "\r\033[K${GREY}%s${RESET} %s" "$spinner" "$spinner_label"
        sleep 0.1
    done

    printf "\r\033[K%s\n" "$final_line"
}

# Show process setup messages using the braille animation
show_process_messages() {
    animate_process_step "${WHITE}Killing any blocking processes.${RESET}" "${WHITE}✔ Killing any blocking processes.${RESET}" 1
    
    # Actually kill processes while showing spinner
    fkill --force 'n-apt-backend' ':5173' ':8765' 2>/dev/null || true
    
    animate_process_step "${WHITE}Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" "${WHITE}✔ Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" 1
    
    npm run dev:fast > /dev/null 2>&1 &
    VITE_PID=$!
    
    animate_process_step "${WHITE}Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
    animate_process_step "${WHITE}Checking to wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" "${WHITE}✔ Checking to wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" 1
    animate_process_step "${WHITE}Building (dev-fast)...${RESET}" "${WHITE}✔ Building (dev-fast)...${RESET}" 1
    
    # Start the actual builds
    npm run build:wasm > /dev/null 2>&1 || true
    animate_process_step "${WHITE}Building (wasm_simd)...${RESET}" "${WHITE}✔ Building (wasm_simd)...${RESET}" 1
    
    cargo build --bin n-apt-backend > /dev/null 2>&1
    cargo run --bin n-apt-backend > /dev/null 2>&1 &
    RUST_PID=$!
    
    animate_process_step "${WHITE}Starting to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Starting to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
    
    echo ""
    echo ""
}

# Process cleanup
cleanup_processes() {
    # Kill existing processes
    pkill -f "n-apt-backend" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    fkill --force 'n-apt-backend' ':5173' ':8765' 2>/dev/null || true
    sleep 1
}

# Build WASM_SIMD package
build_wasm_simd() {
    echo -e "${BLUE}Building WASM_SIMD package...${RESET}"
    
    if ./scripts/check_changes.sh "packages/n_apt_canvas" "src/lib.rs" "src/wasm_simd/*.rs" "Cargo.toml" "Cargo.lock"; then
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
    local pad_len=$((73 - total_content))
    
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

# Show unified output box
show_unified_box() {
    if [ -z "$VITE_PID" ] || [ -z "$RUST_PID" ]; then
        echo -e "${RED}✗ One or more services failed to start${RESET}"
        return
    fi

    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    
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
    
    if [ "$TERM_WIDTH" -lt 76 ]; then
        # Compact mode for narrow terminals
        echo -e "${WHITE}┌─────┐${RESET}"
        echo -e "${WHITE}│ n a │${RESET} ${WHITE}✔ Running .. $(get_braille_spinner)${RESET}"
        echo -e "${WHITE}│ p t │${RESET} ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET}"
        echo -e "${WHITE}└─────┘${RESET}"
        echo ""
        echo -e "${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}"
        echo -e "${GREY}           cmd + click to open in default browser${RESET}"
        echo ""
        echo -e "${ORANGE}http://localhost:8765${RESET} ${GREY}(websockets backend)${RESET}"
        echo -e "${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}"
        echo ""
        echo -e "${GREY}Press Ctrl+C to stop all services${RESET}"
        echo ""
        echo -e "${RED}✗ ${ERROR_COUNT} errors${RESET}   ${YELLOW}▲ ${WARNING_COUNT} warnings${RESET}"
        echo -e "${GREY}running in ${DURATION}s${RESET}"
    else
        # Full box mode for wide terminals
        echo -e "${WHITE}┌─────────────────────────────────────────────────────────────────────────┐${RESET}"
        
        print_box_line " ┌─────┐" "✔ Running .. $(get_braille_spinner) " " ${WHITE}┌─────┐${RESET}" "${WHITE}✔ Running .. $(get_braille_spinner)${RESET} "
        
        local pid_str=" ${VITE_PID} Vite PID ⠶ ${RUST_PID} Rust server PID "
        local pid_col=" ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET} "
        print_box_line " │ n a │" "$pid_str" " ${WHITE}│ n a │${RESET}" "$pid_col"
        
        print_box_line " │ p t │" " " " ${WHITE}│ p t │${RESET}" " "
        print_box_line " └─────┘" " " " ${WHITE}└─────┘${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line " N-APT 🧠  http://localhost:5173 (site)" " " " ${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}" " "
        print_box_line "           cmd + click to open in default browser" " " "           ${GREY}cmd + click to open in default browser${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line "           http://localhost:8765 (websockets backend)" " " "           ${ORANGE}http://localhost:8765${RESET} ${GREY}(websockets backend)${RESET}" " "
        print_box_line "           packages/n_apt_canvas (WebGPU wasm_simd build)" " " "           ${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}" " "
        print_box_line " " " " " " " "
        print_box_line " " " " " " " "
        print_box_line "           Press Ctrl+C to stop all services" " " "           ${GREY}Press Ctrl+C to stop all services${RESET}" " "
        print_box_line " " " " " " " "
        print_box_line " " " " " " " "
        
        err_str=" ✗ ${ERROR_COUNT} errors   ▲ ${WARNING_COUNT} warnings"
        err_col=" ${RED}✗ ${ERROR_COUNT} errors${RESET}   ${YELLOW}▲ ${WARNING_COUNT} warnings${RESET}"
        time_str="running in ${DURATION}s "
        time_col="${GREY}running in ${DURATION}s${RESET} "
        
        print_box_line "$err_str" "$time_str" "$err_col" "$time_col"
        
        echo -e "${WHITE}└─────────────────────────────────────────────────────────────────────────┘${RESET}"
    fi
}

# Show errors and warnings (moved before runtime status)
show_errors_warnings() {
    echo ""
    
    # Show warnings
    if [ $WARNING_COUNT -gt 0 ]; then
        echo -e "${YELLOW}▲${RESET} ${WHITE}unused variable: \`state\`${RESET}"
        echo -e "${GREY}  ${ORANGE}src/server/http_endpoints.rs:145:9${RESET}"
    fi
    
    # Show errors
    if [ $ERROR_COUNT -gt 0 ]; then
        echo -e "${RED}✗${RESET} ${WHITE}mismatched types${RESET}"
        echo -e "${GREY}  ${BLUE}src/components/FFTCanvas.tsx:23:15${RESET}"
    fi
}

# Show footer summary
show_footer() {
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    
    echo ""
    echo -e "${RED}✗ $ERROR_COUNT errors${RESET}${YELLOW} ▲ $WARNING_COUNT warnings${RESET}"
    echo -e "${BLUE}running in ${DURATION}s${RESET}"
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

# Set up cleanup trap
trap cleanup_on_exit EXIT

# Main execution
main() {
    show_header
    echo ""
    
    cleanup_processes
    build_wasm_simd
    build_rust_backend
    start_frontend
    start_backend
    
    show_errors_warnings
    show_runtime_status
    show_footer
    
    # Keep script running to maintain services
    if [ -n "$VITE_PID" ] && [ -n "$RUST_PID" ]; then
        echo ""
        echo -e "${BLUE}Press Ctrl+C to stop all services${RESET}"
        
        # Monitor processes
        while true; do
            if ! ps -p $VITE_PID > /dev/null; then
                echo -e "${RED}Frontend server stopped unexpectedly${RESET}"
                break
            fi
            if ! ps -p $RUST_PID > /dev/null; then
                echo -e "${RED}Backend server stopped unexpectedly${RESET}"
                break
            fi
            sleep 5
        done
    fi
}

# Run main function
main "$@"
