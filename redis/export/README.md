# Redis Data Export

This directory contains Redis database snapshots for the N-APT project.

## Current Export: current/

Contains the latest Redis database snapshot with:
- `dump.rdb`: Redis database snapshot
- `appendonly.aof`: Append-only file (if exists)
- `metadata.json`: Export metadata

## Loading Data

To load this data into Redis:

```bash
# Stop Redis
npm run redis:stop

# Copy data to Redis data directory
cp redis/export/current/* redis/data/

# Start Redis
npm run redis:start
```

## Metadata

```json
{
  "created_at": "2026-03-06T22:39:03-08:00",
  "redis_version": "8.6.1",
  "total_keys": "14144",
  "memory_used": "9.73M",
  "tower_keys": "4"
}
```

Exported: Fri Mar  6 22:39:03 PST 2026
