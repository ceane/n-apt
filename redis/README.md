# Redis Persistent Data Storage

This directory contains Redis configuration and data for the N-APT project's cell tower database.

## Directory Structure

```
redis/
├── redis.conf              # Redis configuration file
├── data/                   # Redis runtime data (gitignored)
│   ├── dump.rdb           # Database snapshot
│   └── appendonly.aof     # Append-only file
├── logs/                   # Redis logs (gitignored)
├── backups/               # Automatic snapshots (gitignored)
├── export/                 # Exported data for repository
│   ├── current/           # Latest export
│   └── README.md          # Export instructions
└── .gitignore             # Git ignore rules
```

## Quick Start

### 1. Start Redis with Persistence
```bash
npm run redis:persistent start
```

### 2. Load Tower Data
```bash
# Load all state data (606K+ towers)
npm run towers:load:all

# Or load specific regions
npm run towers:load:redis
```

### 3. Check Status
```bash
npm run redis:persistent status
```

## Available Commands

### Redis Management
- `npm run redis:persistent start` - Start Redis with persistent configuration
- `npm run redis:persistent stop` - Stop Redis
- `npm run redis:persistent restart` - Restart Redis
- `npm run redis:persistent status` - Show detailed status

### Data Management
- `npm run redis:snapshot` - Create data snapshot
- `npm run redis:export` - Export current data for repository
- `npm run redis:persistent restore <snapshot>` - Restore from snapshot

### Legacy Commands
- `npm run redis:start` - Start Redis (basic)
- `npm run redis:stop` - Stop Redis (basic)
- `npm run redis:status` - Basic status check

## Data Persistence

### Automatic Snapshots
Redis automatically saves data based on activity:
- After 15 minutes if 1+ keys changed
- After 5 minutes if 10+ keys changed  
- After 1 minute if 10,000+ keys changed

### Manual Snapshots
```bash
# Create snapshot
npm run redis:snapshot

# List available snapshots
ls redis/backups/

# Restore from snapshot
npm run redis:persistent restore snapshot_20260306_222415
```

## Repository Integration

### Exporting Data for Repository
```bash
npm run redis:export
```

This creates a snapshot in `redis/export/current/` that can be:
1. **Version controlled** - Share pre-loaded data
2. **Quickly restored** - Skip CSV processing
3. **Team shared** - Consistent data across developers

### Loading from Repository Export
```bash
# Stop Redis
npm run redis:stop

# Copy exported data to Redis data directory
cp redis/export/current/* redis/data/

# Start Redis (will load the data)
npm run redis:persistent start
```

## Current Data

As of the latest export:
- **Total Towers**: 606,531
- **States**: 56 (all 50 states + territories)
- **Technologies**: LTE (4G), NR (5G), UMTS (3G), GSM (2G)
- **Memory Usage**: ~447MB
- **Database Size**: 264MB (dump.rdb)

### Regional Distribution
- **West**: 152,268 towers (CA, WA, OR, etc.)
- **South**: 250,735 towers (TX, FL, GA, etc.)
- **Northeast**: 101,435 towers (NY, NJ, MA, etc.)
- **Midwest**: 101,229 towers (IL, OH, MI, etc.)
- **Territories**: 864 towers (PR, VI, GU, etc.)

## Performance

### Query Performance
- **Geospatial queries**: <10ms for typical bounds
- **Technology filtering**: <5ms
- **State/region queries**: <2ms

### Memory Configuration
- **Max Memory**: 2GB
- **Eviction Policy**: LRU (least recently used)
- **Persistence**: RDB + AOF (maximum durability)

## Troubleshooting

### Redis Won't Start
```bash
# Check for existing process
ps aux | grep redis

# Kill existing process
sudo killall redis-server

# Start fresh
npm run redis:persistent start
```

### Data Not Loading
```bash
# Check Redis logs
tail -f redis/logs/redis.log

# Verify data directory
ls -la redis/data/

# Check Redis connection
redis-cli ping
```

### Memory Issues
```bash
# Check memory usage
npm run redis:persistent status

# Clear all data (if needed)
redis-cli FLUSHALL
```

## Configuration

### Key Settings in `redis.conf`
- **Persistence**: RDB snapshots + AOF logging
- **Memory**: 2GB limit with LRU eviction
- **Network**: Localhost only (127.0.0.1:6379)
- **Security**: Disabled (development mode)

### Customization
Edit `redis/redis.conf` to modify:
- Memory limits
- Persistence frequency
- Network settings
- Security options

## API Integration

The Redis data is used by:
- **Backend API**: `/api/towers/bounds` endpoint
- **Frontend Map**: Real-time tower visualization
- **Geospatial Queries**: State, region, technology filtering

## Data Schema

### Redis Keys
```
towers:state:<STATE>        # Geospatial index by state
towers:region:<REGION>      # Geospatial index by region  
towers:tech:<TECHNOLOGY>    # Geospatial index by technology
towers:<STATE>:<TECH>       # Combined state+technology index
tower:<STATE>:<MNC>:<LAC>:<CELL>:<LAT>:<LON>  # Individual tower record
towers:meta                 # Global metadata
```

### Tower Record Structure
```
{
  "state": "CA",
  "region": "west", 
  "radio": "LTE",
  "mcc": "310",
  "mnc": "260",
  "lac": "14",
  "cell": "33881",
  "lon": -118.4972,
  "lat": 34.0106,
  "range": "0",
  "samples": "5506",
  "created": "1343770116",
  "updated": "1741492750",
  "tech": "lte"
}
```

## Development Tips

### Fast Development Cycle
1. Keep Redis running in persistent mode
2. Use `npm run redis:snapshot` before major changes
3. Export data after significant updates
4. Restore from snapshots if needed

### Data Updates
When updating tower data:
1. Stop Redis
2. Clear data directory: `rm redis/data/*`
3. Start Redis
4. Load new data: `npm run towers:load:all`
5. Export: `npm run redis:export`

### Performance Monitoring
```bash
# Real-time monitoring
redis-cli --latency-history

# Memory usage
redis-cli INFO memory

# Key statistics
redis-cli INFO keyspace
```
