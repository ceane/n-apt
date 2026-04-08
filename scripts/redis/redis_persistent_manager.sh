#!/bin/bash

# Redis Persistent Data Manager for N-APT
# Manages Redis data persistence in the /redis folder

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REDIS_DIR="$PROJECT_ROOT/redis"
REDIS_CONF="$REDIS_DIR/redis.conf"
REDIS_DATA_DIR="$REDIS_DIR/data"
REDIS_LOG="$REDIS_DIR/logs/redis.log"
REDIS_PID_FILE="$REDIS_DIR/redis.pid"
REDIS_BIN="/opt/homebrew/opt/redis/bin/redis-server"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================${NC}"
}

# Function to check if Redis is running
is_redis_running() {
    if [[ -f "$REDIS_PID_FILE" ]]; then
        local pid=$(cat "$REDIS_PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$REDIS_PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Function to start Redis with persistent config
start_redis() {
    if is_redis_running; then
        print_warning "Redis is already running"
        return 0
    fi

    print_status "Starting Redis with persistent configuration..."
    
    # Create directories if they don't exist
    mkdir -p "$REDIS_DATA_DIR" "$REDIS_DIR/logs" "$REDIS_DIR/backups"
    
    # Start Redis with custom config
    "$REDIS_BIN" "$REDIS_CONF" --daemonize yes --pidfile "$REDIS_PID_FILE"
    
    # Wait for Redis to start
    sleep 2
    
    if is_redis_running; then
        print_status "Redis started successfully (PID: $(cat "$REDIS_PID_FILE"))"
        print_status "Data directory: $REDIS_DATA_DIR"
        print_status "Log file: $REDIS_LOG"
    else
        print_error "Failed to start Redis"
        return 1
    fi
}

# Function to stop Redis
stop_redis() {
    if ! is_redis_running; then
        print_warning "Redis is not running"
        return 0
    fi

    local pid=$(cat "$REDIS_PID_FILE")
    print_status "Stopping Redis (PID: $pid)..."
    
    kill "$pid" 2>/dev/null || true
    
    # Wait for graceful shutdown
    for i in {1..10}; do
        if ! ps -p "$pid" > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    # Force kill if still running
    if ps -p "$pid" > /dev/null 2>&1; then
        print_warning "Force killing Redis..."
        kill -9 "$pid" 2>/dev/null || true
    fi
    
    rm -f "$REDIS_PID_FILE"
    print_status "Redis stopped"
}

# Function to create data snapshot
create_snapshot() {
    if ! is_redis_running; then
        print_error "Redis is not running"
        return 1
    fi

    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local snapshot_dir="$REDIS_DIR/backups/snapshot_$timestamp"
    
    print_status "Creating Redis data snapshot..."
    
    # Create snapshot directory
    mkdir -p "$snapshot_dir"
    
    # Force Redis to save current data
    redis-cli BGSAVE
    
    # Wait for background save to complete
    print_status "Waiting for background save to complete..."
    while [[ $(redis-cli LASTSAVE) -eq $(stat -c %Y "$REDIS_DATA_DIR/dump.rdb" 2>/dev/null || echo 0) ]]; do
        sleep 1
    done
    
    # Copy data files
    cp "$REDIS_DATA_DIR/dump.rdb" "$snapshot_dir/"
    if [[ -f "$REDIS_DATA_DIR/appendonly.aof" ]]; then
        cp "$REDIS_DATA_DIR/appendonly.aof" "$snapshot_dir/"
    fi
    
    # Create metadata
    cat > "$snapshot_dir/metadata.json" << EOF
{
  "created_at": "$(date -Iseconds)",
  "redis_version": "$(redis-cli INFO server | grep 'redis_version' | cut -d: -f2 | tr -d '\r')",
  "total_keys": "$(redis-cli DBSIZE)",
  "memory_used": "$(redis-cli INFO memory | grep 'used_memory_human' | cut -d: -f2 | tr -d '\r')",
  "tower_keys": "$(redis-cli EVAL "return redis.call('KEYS', 'towers:*')" 0 | wc -l | tr -d ' ')"
}
EOF
    
    print_status "Snapshot created: $snapshot_dir"
    print_status "Total keys: $(redis-cli DBSIZE)"
    print_status "Tower keys: $(redis-cli EVAL "return redis.call('KEYS', 'towers:*')" 0 | wc -l | tr -d ' ')"
}

# Function to restore from snapshot
restore_snapshot() {
    local snapshot_name="$1"
    
    if [[ -z "$snapshot_name" ]]; then
        print_error "Please specify a snapshot name"
        print_status "Available snapshots:"
        ls -1 "$REDIS_DIR/backups" | grep "^snapshot_" | sort -r
        return 1
    fi
    
    local snapshot_dir="$REDIS_DIR/backups/$snapshot_name"
    
    if [[ ! -d "$snapshot_dir" ]]; then
        print_error "Snapshot not found: $snapshot_name"
        return 1
    fi
    
    print_status "Stopping Redis for restore..."
    stop_redis
    
    # Backup current data
    if [[ -f "$REDIS_DATA_DIR/dump.rdb" ]]; then
        mv "$REDIS_DATA_DIR/dump.rdb" "$REDIS_DATA_DIR/dump.rdb.backup.$(date +%s)"
    fi
    if [[ -f "$REDIS_DATA_DIR/appendonly.aof" ]]; then
        mv "$REDIS_DATA_DIR/appendonly.aof" "$REDIS_DATA_DIR/appendonly.aof.backup.$(date +%s)"
    fi
    
    # Restore snapshot data
    cp "$snapshot_dir/dump.rdb" "$REDIS_DATA_DIR/"
    if [[ -f "$snapshot_dir/appendonly.aof" ]]; then
        cp "$snapshot_dir/appendonly.aof" "$REDIS_DATA_DIR/"
    fi
    
    print_status "Starting Redis with restored data..."
    start_redis
    
    print_status "Restore completed"
    
    # Show restored metadata
    if [[ -f "$snapshot_dir/metadata.json" ]]; then
        print_status "Snapshot metadata:"
        cat "$snapshot_dir/metadata.json" | jq '.'
    fi
}

# Function to show Redis status
show_status() {
    print_header "Redis Status"
    
    if is_redis_running; then
        local pid=$(cat "$REDIS_PID_FILE")
        print_status "Redis is running (PID: $pid)"
        
        if command -v redis-cli &> /dev/null; then
            print_status "Version: $(redis-cli INFO server | grep 'redis_version' | cut -d: -f2 | tr -d '\r')"
            print_status "Uptime: $(redis-cli INFO server | grep 'uptime_in_seconds' | cut -d: -f2 | tr -d '\r') seconds"
            print_status "Memory: $(redis-cli INFO memory | grep 'used_memory_human' | cut -d: -f2 | tr -d '\r')"
            print_status "Total keys: $(redis-cli DBSIZE)"
            
            # Show tower-specific info
            local tower_keys=$(redis-cli EVAL "return redis.call('KEYS', 'towers:*')" 0 | wc -l | tr -d ' ')
            print_status "Tower keys: $tower_keys"
            
            if [[ -n "$(redis-cli GET towers:meta)" ]]; then
                print_status "Tower metadata: $(redis-cli GET towers:meta | jq -r '.total // "unknown"') towers"
            fi
        fi
    else
        print_warning "Redis is not running"
    fi
    
    print_status "Data directory: $REDIS_DATA_DIR"
    print_status "Config file: $REDIS_CONF"
    
    # Show data files
    if [[ -d "$REDIS_DATA_DIR" ]]; then
        print_status "Data files:"
        ls -lh "$REDIS_DATA_DIR/" 2>/dev/null || print_warning "No data files found"
    fi
    
    # Show snapshots
    if [[ -d "$REDIS_DIR/backups" ]]; then
        local snapshots=$(ls -1 "$REDIS_DIR/backups" 2>/dev/null | grep "^snapshot_" | wc -l | tr -d ' ')
        if [[ "$snapshots" -gt 0 ]]; then
            print_status "Available snapshots: $snapshots"
            ls -1 "$REDIS_DIR/backups" | grep "^snapshot_" | sort -r | head -5
        else
            print_warning "No snapshots found"
        fi
    fi
}

# Function to clean up old snapshots
cleanup_snapshots() {
    local keep_count="${1:-5}"
    
    print_status "Cleaning up old snapshots (keeping latest $keep_count)..."
    
    cd "$REDIS_DIR/backups"
    local total=$(ls -1 snapshot_* 2>/dev/null | wc -l | tr -d ' ')
    
    if [[ "$total" -gt "$keep_count" ]]; then
        local to_delete=$((total - keep_count))
        ls -1 snapshot_* | sort -r | tail -"$to_delete" | xargs rm -rf
        print_status "Deleted $to_delete old snapshots"
    else
        print_status "No snapshots to delete (found $total, keeping $keep_count)"
    fi
}

# Function to export data for repository
export_for_repo() {
    print_status "Exporting Redis data for repository..."
    
    # Create current snapshot
    create_snapshot
    
    # Find latest snapshot
    local latest=$(ls -1 "$REDIS_DIR/backups" | grep "^snapshot_" | sort -r | head -1)
    local latest_dir="$REDIS_DIR/backups/$latest"
    
    # Export to repo directory
    local export_dir="$PROJECT_ROOT/redis/export"
    mkdir -p "$export_dir"
    
    # Copy latest snapshot
    cp -r "$latest_dir" "$export_dir/current"
    
    # Create README for exported data
    cat > "$export_dir/README.md" << EOF
# Redis Data Export

This directory contains Redis database snapshots for the N-APT project.

## Current Export: current/

Contains the latest Redis database snapshot with:
- \`dump.rdb\`: Redis database snapshot
- \`appendonly.aof\`: Append-only file (if exists)
- \`metadata.json\`: Export metadata

## Loading Data

To load this data into Redis:

\`\`\`bash
# Stop Redis
npm run redis:stop

# Copy data to Redis data directory
cp redis/export/current/* redis/data/

# Start Redis
npm run redis:start
\`\`\`

## Metadata

\`\`\`json
$(cat "$latest_dir/metadata.json")
\`\`\`

Exported: $(date)
EOF
    
    print_status "Data exported to: $export_dir/current/"
    print_status "README created: $export_dir/README.md"
}

# Main command handling
case "${1:-help}" in
    start)
        start_redis
        ;;
    stop)
        stop_redis
        ;;
    restart)
        stop_redis
        sleep 1
        start_redis
        ;;
    status)
        show_status
        ;;
    snapshot)
        create_snapshot
        ;;
    restore)
        restore_snapshot "$2"
        ;;
    export)
        export_for_repo
        ;;
    cleanup)
        cleanup_snapshots "$2"
        ;;
    help|*)
        echo "Redis Persistent Data Manager"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|snapshot|restore|export|cleanup|help}"
        echo ""
        echo "Commands:"
        echo "  start     - Start Redis with persistent configuration"
        echo "  stop      - Stop Redis"
        echo "  restart   - Restart Redis"
        echo "  status    - Show Redis status and data info"
        echo "  snapshot  - Create data snapshot"
        echo "  restore   - Restore from snapshot (requires snapshot name)"
        echo "  export    - Export current data for repository"
        echo "  cleanup   - Clean up old snapshots (default: keep 5)"
        echo "  help      - Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 snapshot"
        echo "  $0 restore snapshot_20260306_222000"
        echo "  $0 export"
        echo "  $0 cleanup 3"
        ;;
esac
