#!/bin/bash

# Redis setup and management for N-APT tower data
set -e

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REDIS_PID=""
REDIS_PORT=6379
REDIS_DATA_DIR="$SCRIPT_DIR/../.redis_data"

# Colors
GREEN="\033[32m"
ORANGE="\033[38;5;208m"
RED="\033[31m"
GREY="\033[38;5;145m"
RESET="\033[0m"

# Check if Redis is installed
check_redis_installation() {
    if command -v redis-server &> /dev/null && command -v redis-cli &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Install Redis if not present
install_redis() {
    echo -e "${ORANGE}Redis not found. Installing Redis...${RESET}"
    
    if command -v brew &> /dev/null; then
        # macOS with Homebrew
        echo "Installing Redis via Homebrew..."
        brew install redis
    elif command -v apt-get &> /dev/null; then
        # Ubuntu/Debian
        echo "Installing Redis via apt..."
        sudo apt-get update
        sudo apt-get install -y redis-server
    elif command -v yum &> /dev/null; then
        # CentOS/RHEL
        echo "Installing Redis via yum..."
        sudo yum install -y redis
    else
        echo -e "${RED}Cannot automatically install Redis. Please install manually:${RESET}"
        echo "  macOS: brew install redis"
        echo "  Ubuntu: sudo apt-get install redis-server"
        echo "  CentOS: sudo yum install redis"
        exit 1
    fi
}

# Start Redis server
start_redis() {
    # Create data directory if it doesn't exist
    mkdir -p "$REDIS_DATA_DIR"
    
    # Check if Redis is already running on our port
    if lsof -ti:$REDIS_PORT > /dev/null 2>&1; then
        echo -e "${GREY}Redis is already running on port $REDIS_PORT${RESET}"
        REDIS_PID=$(lsof -ti:$REDIS_PORT)
        return 0
    fi
    
    echo -e "${ORANGE}Starting Redis server...${RESET}"
    
    # Start Redis with custom config
    redis-server --port $REDIS_PORT --dir "$REDIS_DATA_DIR" --daemonize yes --appendonly yes
    
    # Wait for Redis to start
    sleep 2
    
    # Check if Redis started successfully
    if lsof -ti:$REDIS_PORT > /dev/null 2>&1; then
        REDIS_PID=$(lsof -ti:$REDIS_PORT)
        echo -e "${GREEN}✓ Redis server started (PID: $REDIS_PID)${RESET}"
        return 0
    else
        echo -e "${RED}✗ Failed to start Redis server${RESET}"
        return 1
    fi
}

# Stop Redis server
stop_redis() {
    if [ -n "$REDIS_PID" ]; then
        echo -e "${ORANGE}Stopping Redis server...${RESET}"
        kill $REDIS_PID 2>/dev/null || true
        sleep 1
        
        # Force kill if still running
        if lsof -ti:$REDIS_PORT > /dev/null 2>&1; then
            lsof -ti:$REDIS_PORT | xargs kill -9 2>/dev/null || true
        fi
        
        echo -e "${GREEN}✓ Redis server stopped${RESET}"
    else
        # Try to stop any Redis process on our port
        if lsof -ti:$REDIS_PORT > /dev/null 2>&1; then
            echo -e "${ORANGE}Stopping existing Redis process...${RESET}"
            lsof -ti:$REDIS_PORT | xargs kill 2>/dev/null || true
            sleep 1
        fi
    fi
}

# Check Redis connection
check_redis_connection() {
    if redis-cli -p $REDIS_PORT ping > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Load tower data into Redis
load_tower_data() {
    echo -e "${ORANGE}Loading tower data into Redis...${RESET}"
    
    # Check if data files exist
    if [ ! -f "$SCRIPT_DIR/../data/opencellid/ongoing/bay_area_ca.csv" ] || [ ! -f "$SCRIPT_DIR/../data/opencellid/ongoing/miami_fl.csv" ]; then
        echo -e "${RED}✗ Tower data files not found in data/opencellid/ongoing/${RESET}"
        echo "Please ensure the following files exist:"
        echo "  - data/opencellid/ongoing/bay_area_ca.csv"
        echo "  - data/opencellid/ongoing/miami_fl.csv"
        return 1
    fi
    
    # Load data using the Node.js script
    cd "$SCRIPT_DIR/.."
    if npm run towers:load:redis; then
        echo -e "${GREEN}✓ Tower data loaded into Redis${RESET}"
        return 0
    else
        echo -e "${RED}✗ Failed to load tower data${RESET}"
        return 1
    fi
}

# Show Redis status
show_redis_status() {
    echo -e "${GREY}Redis Status:${RESET}"
    
    if check_redis_connection; then
        echo -e "  ${GREEN}● Connected${RESET} (port $REDIS_PORT)"
        
        # Show tower data info
        TOWER_COUNT=$(redis-cli -p $REDIS_PORT hget towers:meta total 2>/dev/null || echo "0")
        if [ "$TOWER_COUNT" != "0" ]; then
            echo -e "  ${GREEN}● Tower data loaded: $TOWER_COUNT towers${RESET}"
        else
            echo -e "  ${ORANGE}● No tower data loaded${RESET}"
        fi
    else
        echo -e "  ${RED}● Not connected${RESET}"
    fi
}

# Main function
main() {
    case "${1:-start}" in
        "install")
            install_redis
            ;;
        "start")
            if ! check_redis_installation; then
                install_redis
            fi
            start_redis
            ;;
        "stop")
            stop_redis
            ;;
        "restart")
            stop_redis
            sleep 1
            start_redis
            ;;
        "load")
            if ! check_redis_connection; then
                echo -e "${RED}Redis is not running. Starting it first...${RESET}"
                start_redis
            fi
            load_tower_data
            ;;
        "status")
            show_redis_status
            ;;
        "setup")
            # Full setup: install, start, and load data
            if ! check_redis_installation; then
                install_redis
            fi
            start_redis
            if check_redis_connection; then
                load_tower_data
            fi
            show_redis_status
            ;;
        *)
            echo "Usage: $0 {install|start|stop|restart|load|status|setup}"
            echo ""
            echo "Commands:"
            echo "  install  - Install Redis if not present"
            echo "  start    - Start Redis server"
            echo "  stop     - Stop Redis server"
            echo "  restart  - Restart Redis server"
            echo "  load     - Load tower data into Redis"
            echo "  status   - Show Redis status"
            echo "  setup    - Full setup (install + start + load data)"
            exit 1
            ;;
    esac
}

# Store PID for cleanup
if [ -n "$REDIS_PID" ]; then
    echo $REDIS_PID > "$REDIS_DATA_DIR/redis.pid"
fi

# Run main function
main "$@"
