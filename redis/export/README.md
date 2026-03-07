# Redis Data Export

This directory contains Redis database snapshots for the N-APT project.

## ⚠️ Large Data Files

**Note**: The Redis dump files (`dump.rdb`) are too large for GitHub (263MB+). They are excluded from version control but can be regenerated.

## Current Export: current/

Contains the latest Redis database snapshot with:
- `dump.rdb`: Redis database snapshot (263MB - excluded from git)
- `appendonly.aof`: Append-only file (if exists)
- `metadata.json`: Export metadata

## Loading Data

### Option 1: Regenerate from Tower Data (Recommended)
```bash
# Load fresh tower data to Redis
npm run redis:persistent start
npm run towers:load:region -- --state NY --tech lte

# Create new export
npm run redis:export
```

### Option 2: Load from Existing Export
```bash
# Stop Redis
npm run redis:persistent stop

# Copy data to Redis data directory (if you have the files)
cp redis/export/current/* redis/data/

# Start Redis
npm run redis:persistent start
```

## Available Datasets

Use sharding to generate specific datasets:

```bash
# Minimal (9.5MB)
npm run towers:load:region -- --state NY --tech lte

# Regional (120MB)  
npm run towers:load:region -- --region west

# Full US (447MB)
npm run towers:load:all
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

## Git Strategy

- **Included**: Directory structure, metadata, README
- **Excluded**: Large `.rdb` and `.aof` files (>100MB)
- **Regeneration**: Data can be regenerated from tower sources
