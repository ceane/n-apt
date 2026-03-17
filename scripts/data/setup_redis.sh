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

# Load tower data into Redis (permanent app data)
load_tower_data() {
    echo -e "${ORANGE}Loading fast select towers (for UI)...${RESET}"
    
    # Check if Redis already has tower data in PERMANENT databases (db2, db3)
    if check_redis_connection; then
        FAST_DB_TOWERS=$(redis-cli -p $REDIS_PORT -n 2 keys "tower:*" 2>/dev/null | wc -l || echo "0")
        COMPLETE_DB_TOWERS=$(redis-cli -p $REDIS_PORT -n 3 keys "tower:*" 2>/dev/null | wc -l || echo "0")
        
        if [ "$FAST_DB_TOWERS" != "0" ] && [ "$COMPLETE_DB_TOWERS" != "0" ]; then
            echo -e "${GREEN}✓ Fast select towers loaded: $FAST_DB_TOWERS towers (ready for UI)${RESET}"
            return 0
        fi
    fi
    
    # Check if Redis data files exist (from previous export) with tower data
    if [ -f "$SCRIPT_DIR/../redis/data/dump.rdb" ]; then
        echo -e "${GREY}Found Redis data file, checking for tower data...${RESET}"
        
        # Try to load and check for tower data in permanent databases
        if check_redis_connection; then
            FAST_DB_TOWERS=$(redis-cli -p $REDIS_PORT -n 2 keys "tower:*" 2>/dev/null | wc -l || echo "0")
            COMPLETE_DB_TOWERS=$(redis-cli -p $REDIS_PORT -n 3 keys "tower:*" 2>/dev/null | wc -l || echo "0")
            
            if [ "$FAST_DB_TOWERS" != "0" ] && [ "$COMPLETE_DB_TOWERS" != "0" ]; then
                echo -e "${GREEN}✓ Fast select towers loaded from Redis dump: $FAST_DB_TOWERS towers (ready for UI)${RESET}"
                return 0
            else
                echo -e "${ORANGE}Redis dump missing tower data, reloading with new system...${RESET}"
            fi
        fi
    fi
    
    # If no tower data found, load tower data using new OpenCellID system into PERMANENT databases
    echo -e "${ORANGE}No tower data found, loading from OpenCellID...${RESET}"
    echo -e "${GREY}Note: Tower data will be stored in permanent databases (db2, db3)${RESET}"
    cd "$SCRIPT_DIR/.."
    
    # Try the new cached download system first (API with 1-week cache + CSV fallback)
    if npm run towers:download:cached; then
        echo -e "${GREEN}✓ Tower data loaded from OpenCellID API/CSV with caching${RESET}"
        # Move tower data from temporary databases to permanent ones
        echo -e "${ORANGE}Moving tower data to permanent databases...${RESET}"
        redis-cli -p $REDIS_PORT swapdb 0 2 >/dev/null
        redis-cli -p $REDIS_PORT swapdb 1 3 >/dev/null
        echo -e "${GREEN}✓ Tower data moved to permanent databases (db2, db3)${RESET}"
        return 0
    else
        # Fallback to processing existing CSV files
        echo -e "${ORANGE}Cached download failed, trying direct CSV processing...${RESET}"
        if npm run towers:process:opencellid; then
            echo -e "${GREEN}✓ Tower data loaded from CSV files${RESET}"
            # Move tower data from temporary databases to permanent ones
            echo -e "${ORANGE}Moving tower data to permanent databases...${RESET}"
            redis-cli -p $REDIS_PORT swapdb 0 2 >/dev/null
            redis-cli -p $REDIS_PORT swapdb 1 3 >/dev/null
            echo -e "${GREEN}✓ Tower data moved to permanent databases (db2, db3)${RESET}"
            return 0
        else
            echo -e "${RED}✗ Failed to load tower data${RESET}"
            echo -e "${GREY}Try running: npm run towers:download:cached${RESET}"
            return 1
        fi
    fi
}

# Show Redis status
show_redis_status() {
    echo -e "${GREY}Redis Status:${RESET}"
    
    if check_redis_connection; then
        echo -e "  ${GREEN}● Connected${RESET} (port $REDIS_PORT)"
        
        # Show user/session data info (databases 0, 1)
        USER_DB_KEYS=$(redis-cli -p $REDIS_PORT -n 0 dbsize 2>/dev/null || echo "0")
        SESSION_DB_KEYS=$(redis-cli -p $REDIS_PORT -n 1 dbsize 2>/dev/null || echo "0")
        
        # Show tower data info (permanent databases 2, 3)
        FAST_DB_KEYS=$(redis-cli -p $REDIS_PORT -n 2 dbsize 2>/dev/null || echo "0")
        COMPLETE_DB_KEYS=$(redis-cli -p $REDIS_PORT -n 3 dbsize 2>/dev/null || echo "0")
        
        # Get actual unique tower counts from permanent databases
        FAST_DB_TOWERS=$(redis-cli -p $REDIS_PORT -n 2 keys "tower:*" 2>/dev/null | wc -l || echo "0")
        COMPLETE_DB_TOWERS=$(redis-cli -p $REDIS_PORT -n 3 keys "tower:*" 2>/dev/null | wc -l || echo "0")
        
        # Show user/session data
        if [ "$USER_DB_KEYS" != "0" ] || [ "$SESSION_DB_KEYS" != "0" ]; then
            echo -e "  ${GREEN}● User/Session data: ${USER_DB_KEYS} users, ${SESSION_DB_KEYS} sessions${RESET}"
        else
            echo -e "  ${GREY}● No user/session data${RESET}"
        fi
        
        # Show tower data (permanent)
        if [ "$FAST_DB_TOWERS" != "0" ]; then
            echo -e "  ${GREEN}● Fast select towers: ${FAST_DB_TOWERS} towers (ready for UI)${RESET}"
            
            # Show region breakdown if available
            BAY_AREA_COUNT=$(redis-cli -p $REDIS_PORT -n 2 get "region:bay_area:meta" 2>/dev/null | grep -o '"towerCount":[0-9]*' | cut -d: -f2 || echo "0")
            MIAMI_COUNT=$(redis-cli -p $REDIS_PORT -n 2 get "region:miami:meta" 2>/dev/null | grep -o '"towerCount":[0-9]*' | cut -d: -f2 || echo "0")
            
            if [ "$BAY_AREA_COUNT" != "0" ]; then
                echo -e "  ${GREEN}● Bay Area: $BAY_AREA_COUNT towers${RESET}"
            fi
            if [ "$MIAMI_COUNT" != "0" ]; then
                echo -e "  ${GREEN}● Miami: $MIAMI_COUNT towers${RESET}"
            fi
        else
            echo -e "  ${ORANGE}● No tower data loaded (permanent databases)${RESET}"
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
