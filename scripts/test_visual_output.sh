#!/bin/bash

# Test script for visual build output

# Color definitions
WHITE="\033[37m"
BLUE="\033[34m"
ORANGE="\033[38;5;208m"
GREEN="\033[32m"
YELLOW='\033[33m'
RED='\033[31m'
GREY='\033[38;5;145m'
RESET='\033[0m'

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
    
    animate_process_step "${WHITE}Killing any blocking processes.${RESET}" "${WHITE}✔ Killing any blocking processes.${RESET}" 1
    animate_process_step "${WHITE}Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" "${WHITE}✔ Starting frontend server. ${BLUE}Vite${RESET}.${RESET}" 1
    animate_process_step "${WHITE}Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Checking to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
    animate_process_step "${WHITE}Checking to wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" "${WHITE}✔ Checking to wasm_simd package. ${ORANGE}Rust${RESET} -> ${ORANGE}wasm_simd${RESET}.${RESET}" 1
    animate_process_step "${WHITE}Building (dev-fast)...${RESET}" "${WHITE}✔ Building (dev-fast)...${RESET}" 1
    animate_process_step "${WHITE}Building (wasm_simd)...${RESET}" "${WHITE}✔ Building (wasm_simd)...${RESET}" 1
    animate_process_step "${WHITE}Starting to build backend server. ${ORANGE}Rust${RESET}.${RESET}" "${WHITE}✔ Starting to build backend server. ${ORANGE}Rust${RESET}.${RESET}" 1
    echo ""
}

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
    # Force terminal width to a specific value if provided via env var
    TERM_WIDTH=${FORCE_COLOR_WIDTH:-0}

    if [ "$TERM_WIDTH" -eq 0 ]; then
        # Try to get the real terminal width even when piped through npm
        # stty size seems to be the most reliable across npm pipes on macOS
        if STTY_SIZE=$(stty size 2>/dev/null); then
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
        echo -e "${WHITE}│ p t │${RESET} ${GREY}12345${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ 12346${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET}"
        echo -e "${WHITE}└─────┘${RESET}"
        echo ""
        echo -e "${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}"
        echo -e "${GREY}           cmd + click to open in default browser${RESET}"
        echo ""
        echo -e "${GREY}http://localhost:8765 (websockets backend)${RESET}"
        echo -e "${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}"
        echo ""
        echo -e "${GREY}Press Ctrl+C to stop all services${RESET}"
        echo ""
        echo -e "${RED}✗ 2 errors${RESET}   ${YELLOW}▲ 107 warnings${RESET}"
        echo -e "${GREY}running in 1.2s${RESET}"
    else
        # Full box mode for wide terminals
        echo -e "${WHITE}┌─────────────────────────────────────────────────────────────────────────┐${RESET}"
        
        print_box_line " ┌─────┐" "✔ Running $(get_braille_spinner)  " " ${WHITE}┌─────┐${RESET}" "${GREY}✔${RESET} ${WHITE}Running${RESET} ${GREY}$(get_braille_spinner)${RESET}  "
        
        local pid_str="  12345 Vite PID ⠶ 12346 Rust server PID"
        local pid_col="  ${GREY}12345${RESET} ${BLUE}Vite${RESET} ${GREY}PID ⠶ 12346${RESET} ${ORANGE}Rust${RESET} ${GREY}server PID${RESET}"
        print_box_line " │ n a │" "$pid_str" " ${WHITE}│ n a │${RESET}" "$pid_col"
        
        print_box_line " │ p t │" " " " ${WHITE}│ p t │${RESET}" " "
        print_box_line " └─────┘" " " " ${WHITE}└─────┘${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line " N-APT 🧠  http://localhost:5173 (site)" " " " ${WHITE}N-APT${RESET} 🧠  ${BLUE}http://localhost:5173${RESET} ${GREY}(site)${RESET}" " "
        print_box_line "          cmd + click to open in default browser" " " "          ${GREY}cmd + click to open in default browser${RESET}" " "
        print_box_line " " " " " " " "
        
        print_box_line "           http://localhost:8765 (websockets backend)" " " "           ${GREY}http://localhost:8765 (websockets backend)${RESET}" " "
        print_box_line "           packages/n_apt_canvas (WebGPU wasm_simd build)" " " "           ${GREY}packages/n_apt_canvas (WebGPU wasm_simd build)${RESET}" " "
        print_box_line " " " " " " " "
        print_box_line " " " " " " " "
        print_box_line "           Press Ctrl+C to stop all services" " " "           ${GREY}Press Ctrl+C to stop all services${RESET}" " "
        print_box_line " " " " " " " "
        print_box_line " " " " " " " "

        err_str=" ✗ 2 errors   ▲ 107 warnings"
        err_col=" ${RED}✗ 2 errors${RESET}   ${YELLOW}▲ 107 warnings${RESET}"
        time_str="running in 1.2s "
        time_col="${GREY}running in 1.2s${RESET} "

        print_box_line "$err_str" "$time_str" "$err_col" "$time_col"

        echo -e "${WHITE}└─────────────────────────────────────────────────────────────────────────┘${RESET}"
    fi
}
}

# Main execution
main() {
    show_header
    
    # Error and warning messages (outside the box, before it)
    echo ""
    echo -e "${YELLOW}▲${RESET} ${WHITE}unused variable: \`state\`${RESET}"
    echo -e "${GREY}  ${ORANGE}src/server/http_endpoints.rs:145:9${RESET}"
    echo ""
    echo -e "${RED}✗${RESET} ${WHITE}mismatched types${RESET}"
    echo -e "${GREY}  ${BLUE}src/components/FFTCanvas.tsx:23:15${RESET}"
    
    show_unified_box
}

# Run main function
main "$@"
