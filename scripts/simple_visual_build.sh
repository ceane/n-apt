#!/bin/bash

# Simple Visual Build Script for N-APT
# Focus on visual output matching the design

# Color definitions
WHITE='\033[37m'
BLUE='\033[34m'
ORANGE='\033[38;5;208m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
GREY='\033[38;5;145m'
RESET='\033[0m'

# Silence all output before the logo draws
exec 3>&1 4>&2
exec >/dev/null 2>&1

# Start time
START_TIME=$(date +%s)
START_TIME_MS=$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)

format_duration() {
    local now_ms=$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
    )
    local diff=$((now_ms - START_TIME_MS))
    if [ $diff -lt 0 ]; then
        diff=0
    fi
    awk -v ms="$diff" 'BEGIN { printf "%.2f", ms/1000 }'
}

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
        printf "\r\033[K${GREY}%s${RESET} %b" "$spinner" "$spinner_label"
        sleep 0.1
    done

    printf "\r\033[K%b\n" "$final_line"
}

# Clear screen for clean output
# Restore stdout/stderr now that we're ready to render
exec 1>&3 2>&4
clear

# Logo
echo -e "${WHITE}┌─────┐"
echo -e "${WHITE}│ n a │"
echo -e "${WHITE}│ p t │"
echo -e "${WHITE}└─────┘${RESET}"
echo "(c) 2026 🇺🇸 Made in the USA"
echo ""

animate_process_step "${WHITE}Killing any blocking processes.${RESET}" "${WHITE}✔ Killing any blocking processes.${RESET}" 1
animate_process_step "${WHITE}Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" "${WHITE}✔ Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" 1
animate_process_step "${WHITE}Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
animate_process_step "${WHITE}Checking to wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" "${WHITE}✔ Checking to wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" 1
animate_process_step "${WHITE}Building (dev-fast)...${RESET}" "${WHITE}✔ Building (dev-fast)...${RESET}" 1
animate_process_step "${WHITE}Building (wasm_simd)...${RESET}" "${WHITE}✔ Building (wasm_simd)...${RESET}" 1
animate_process_step "${WHITE}Starting to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Starting to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
echo ""
echo ""

# Braille spinner animation
get_braille_spinner() {
    local spinners=("⠁" "⠃" "⠉" "⠙" "⠑" "⠋" "⠛" "⠓" "⠊" "⠚" "⠌" "⠜" "⠎" "⠞" "⠏" "⠟" "⠐" "⠑" "⠒" "⠓" "⠔" "⠕" "⠖" "⠗" "⠘" "⠙" "⠚" "⠛" "⠜" "⠝" "⠞" "⠟" "⠠" "⠡" "⠢" "⠣" "⠤" "⠥" "⠦" "⠧" "⠨" "⠩" "⠪" "⠫" "⠬" "⠭" "⠮" "⠯" "⠰" "⠱" "⠲" "⠳" "⠴" "⠵" "⠶" "⠷" "⠸" "⠹" "⠺" "⠻" "⠼" "⠽" "⠾" "⠿")
    
    # Use sub-second timing for faster animation
    local current_time=$(date +%s.%N 2>/dev/null || date +%s)
    local spinner_index=$(echo "$current_time * 10" | bc 2>/dev/null || echo "0")
    spinner_index=${spinner_index%.*}  # Remove decimal part
    spinner_index=$((spinner_index % ${#spinners[@]}))
    
    echo "${spinners[$spinner_index]}"
}

# Animated spinner display function
show_animated_spinner() {
    local duration=${1:-15}  # Default 15 seconds
    local end_time=$(($(date +%s) + duration))
    
    # Force terminal width to a specific value if provided via env var
    TERM_WIDTH=${FORCE_COLOR_WIDTH:-0}

    if [ "$TERM_WIDTH" -eq 0 ]; then
        # Prefer /dev/tty to get width even when piped through npm
        if STTY_SIZE=$(stty size < /dev/tty 2>/dev/null); then
            TERM_WIDTH=$(echo "$STTY_SIZE" | awk '{print $2}')
        elif STTY_SIZE=$(stty size 2>/dev/null); then
            TERM_WIDTH=$(echo "$STTY_SIZE" | awk '{print $2}')
        elif TPUT_COLS=$(tput cols 2>/dev/null); then
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
    
    # Save cursor and hide it to reduce flicker
    tput civis 2>/dev/null
    tput sc 2>/dev/null
    
    local runtime_label=$(format_duration)

    while [ $(date +%s) -lt $end_time ]; do
        # Restore cursor position instead of clearing entire screen
        tput rc 2>/dev/null

        if [ "$TERM_WIDTH" -lt 76 ]; then
            # Compact mode for narrow terminals
            echo ""
            echo -e "${WHITE}┌─────┐${RESET}"
            echo -e "${WHITE}│ n a │${RESET} ${GREY}✔${RESET} ${WHITE}Running${RESET}  ${GREY}$(get_braille_spinner)${RESET}"
            echo -e "${WHITE}│ p t │${RESET} ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET}"
            echo -e "${WHITE}└─────┘${RESET}"
            echo ""
            echo -e "${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}"
            echo -e "${GREY}            cmd + click to open in default browser${RESET}"
            echo ""
            echo -e "${GREY}http://localhost:8765 (websockets backend)${RESET}"
            echo -e "${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}"
            echo ""
            echo -e "${GREY}Press Ctrl+C to stop all services${RESET}"
            echo ""
            echo -e "${RED}✗ 2 errors${RESET}   ${YELLOW}▲ 107 warnings${RESET}"
            echo -e "${GREY}running in ${runtime_label}s${RESET}"
            echo ""
            echo -e "${GREY}Animation test - showing for ${duration}s... (width: $TERM_WIDTH)${RESET}"
        else
            # Full box mode for wide terminals
            echo ""
            echo -e "${WHITE}┌─────────────────────────────────────────────────────────────────────────┐${RESET}"

            print_box_line " ┌─────┐" "✔ Running  $(get_braille_spinner)  " " ${WHITE}┌─────┐${RESET}" "${GREY}✔${RESET} ${WHITE}Running${RESET}  ${GREY}$(get_braille_spinner)${RESET}  "
            
            pid_str="${VITE_PID} Vite PID ⠶ ${RUST_PID} Rust server PID "
            pid_col="${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET} "
            print_box_line " │ n a │" "$pid_str" " ${WHITE}│ n a │${RESET}" "$pid_col"
            print_box_line " │ p t │" " Press Ctrl+C to stop all services" " ${WHITE}│ p t │${RESET}" " ${GREY}Press Ctrl+C to stop all services${RESET}"
            print_box_line " └─────┘" " " " ${WHITE}└─────┘${RESET}" " "
            print_box_line " " " " " " " "
            
            print_box_line " N-APT 🧠  http://localhost:5173 (site)" " " " ${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}" " "
            print_box_line "           cmd + click to open in default browser" " " "           ${GREY}cmd + click to open in default browser${RESET}" " "
            print_box_line " " " " " " " "

            print_box_line "           http://localhost:8765 (websockets backend)" " " "           ${GREY}http://localhost:8765 (websockets backend)${RESET}" " "
            print_box_line "           packages/n_apt_canvas (WebGPU wasm_simd build)" " " "           ${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}" " "
            print_box_line " " " " " " " "
            print_box_line " " " " " " " "

            err_str=" ✗ 2 errors   ▲ 107 warnings"
            err_col=" ${RED}✗ 2 errors${RESET}   ${YELLOW}▲ 107 warnings${RESET}"
            time_str="running in ${runtime_label}s "
            time_col="${GREY}running in ${runtime_label}s${RESET} "

            print_box_line "$err_str" "$time_str" "$err_col" "$time_col"

            echo -e "${WHITE}└─────────────────────────────────────────────────────────────────────────┘${RESET}"
            echo ""
            echo -e "${GREY}Animation test - showing for ${duration}s... (width: $TERM_WIDTH)${RESET}"
        fi
        
        sleep 0.2
    done
    
    # Restore cursor visibility
    tput cnorm 2>/dev/null
}

# Helper to print a line in the box
print_box_line() {
    local left_plain="$1"
    local right_plain="$2"
    local left_colored="$3"
    local right_colored="$4"
    
    local total_len=73
    
    # Adjust for double-width emoji
    local visual_left_len=${#left_plain}
    if [[ "$left_plain" == *"🧠"* ]]; then
        visual_left_len=$((visual_left_len + 1))
    fi
    local content_len=$(( visual_left_len + ${#right_plain} ))

    while [ $content_len -gt $total_len ]; do
        if [[ "$right_plain" == *" " ]]; then
            right_plain="${right_plain% }"
            right_colored="${right_colored% }"
        elif [[ "$left_plain" == " "* ]]; then
            left_plain="${left_plain# }"
            left_colored="${left_colored# }"
        else
            # As a last resort trim from the end of the right segment
            right_plain="${right_plain%?}"
            right_colored="${right_colored%?}"
        fi

        visual_left_len=${#left_plain}
        if [[ "$left_plain" == *"🧠"* ]]; then
            visual_left_len=$((visual_left_len + 1))
        fi
        content_len=$(( visual_left_len + ${#right_plain} ))
    done

    local pad_len=$((total_len - content_len))
    local pad=""
    if [ $pad_len -gt 0 ]; then
        for ((i=0; i<pad_len; i++)); do pad+=" "; done
    fi
    
    echo -e "${WHITE}│${RESET}${left_colored}${pad}${right_colored}${WHITE}│${RESET}"
}

# Check for animation test mode
if [ "${1}" = "--animate" ]; then
    show_animated_spinner ${2:-15}
    exit 0
fi

# Runtime status (simulated PIDs)
VITE_PID=12345
RUST_PID=12346

END_TIME_MS=$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)

DURATION_MS=$((END_TIME_MS - START_TIME_MS))
if [ $DURATION_MS -lt 0 ]; then
    DURATION_MS=0
fi
DURATION=$(awk -v ms="$DURATION_MS" 'BEGIN { printf "%.2f", ms/1000 }')

# Error and warning messages (outside the box, before it)
echo ""
echo -e "${YELLOW}▲${RESET} ${WHITE}unused variable: \`state\`${RESET}"
echo -e "${GREY}  ${ORANGE}src/server/http_endpoints.rs:145:9${RESET}"
echo ""
echo -e "${RED}✗${RESET} ${WHITE}mismatched types${RESET}"
echo -e "${GREY}  ${BLUE}src/components/FFTCanvas.tsx:23:15${RESET}"

# Force terminal width to a specific value if provided via env var
TERM_WIDTH=${FORCE_COLOR_WIDTH:-0}

if [ "$TERM_WIDTH" -eq 0 ]; then
    # Prefer /dev/tty to get width even when piped through npm
    if STTY_SIZE=$(stty size < /dev/tty 2>/dev/null); then
        TERM_WIDTH=$(echo "$STTY_SIZE" | awk '{print $2}')
    elif STTY_SIZE=$(stty size 2>/dev/null); then
        TERM_WIDTH=$(echo "$STTY_SIZE" | awk '{print $2}')
    elif TPUT_COLS=$(tput cols 2>/dev/null); then
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
    echo -e "${WHITE}│ n a │${RESET} ${GREY}✔${RESET} ${WHITE}Running${RESET}  ${GREY}$(get_braille_spinner)${RESET}"
    echo -e "${WHITE}│ p t │${RESET} ${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET}"
    echo -e "${GREY}Press Ctrl+C to stop all services${RESET}"
    echo -e "${WHITE}└─────┘${RESET}"
    echo ""
    echo -e "${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}"
    echo -e "${GREY}           cmd + click to open in default browser${RESET}"
    echo ""
    echo -e "${GREY}http://localhost:8765 (websockets backend)${RESET}"
    echo -e "${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}"
    echo -e "${RED}✗ 2 errors${RESET}   ${YELLOW}▲ 107 warnings${RESET}"
    echo -e "${GREY}running in ${DURATION}s${RESET}"
else
    # Full box mode for wide terminals
    echo -e "${WHITE}┌─────────────────────────────────────────────────────────────────────────┐${RESET}"

    print_box_line " ┌─────┐" "✔ Running  $(get_braille_spinner) " " ${WHITE}┌─────┐${RESET}" "${GREY}✔${RESET} ${WHITE}Running${RESET}  ${GREY}$(get_braille_spinner)${RESET} "
    
    pid_str="${VITE_PID} Vite PID ⠶ ${RUST_PID} Rust server PID "
    pid_col="${GREY}${VITE_PID}${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ ${RUST_PID}${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET} "
    print_box_line " │ n a │" "$pid_str" " ${WHITE}│ n a │${RESET}" "$pid_col"
    print_box_line " │ p t │" " Press Ctrl+C to stop all services" " ${WHITE}│ p t │${RESET}" " ${GREY}Press Ctrl+C to stop all services${RESET}"
    print_box_line " └─────┘" " " " ${WHITE}└─────┘${RESET}" " "
    print_box_line " " " " " " " "
    
    print_box_line " N-APT 🧠  http://localhost:5173 (site)" " " " ${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}" " "
    print_box_line "          cmd + click to open in default browser" " " "          ${GREY}cmd + click to open in default browser${RESET}" " "
    print_box_line " " " " " " " "

    print_box_line "           http://localhost:8765 (websockets backend)" " " "           ${GREY}http://localhost:8765 (websockets backend)${RESET}" " "
    print_box_line "           packages/n_apt_canvas (WebGPU wasm_simd build)" " " "           ${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}" " "
    print_box_line " " " " " " " "
    print_box_line " " " " " " " "

    err_str=" ✗ 2 errors   ▲ 107 warnings"
    err_col=" ${RED}✗ 2 errors${RESET}   ${YELLOW}▲ 107 warnings${RESET}"
    time_str="running in ${DURATION}s "
    time_col="${GREY}running in ${DURATION}s${RESET} "

    print_box_line "$err_str" "$time_str" "$err_col" "$time_col"

    echo -e "${WHITE}└─────────────────────────────────────────────────────────────────────────┘${RESET}"
fi
