# Data Processing Scripts

This folder contains data processing and database management scripts for the n-apt project.

## 🗄️ Database Scripts

### **Redis Scripts**
- `redis_persistent_manager.sh` - Redis persistent data management
- `setup_redis.sh` - Redis setup and configuration
- `load_towers_to_redis.cjs` - Load tower data to Redis
- `load_region_towers.cjs` - Load regional tower data
- `load_local_radius_towers.cjs` - Load local radius tower data
- `load_all_towers_to_redis.cjs` - Load all tower data to Redis

### **OpenCellID Scripts**
- `process_opencellid.cjs` - Process OpenCellID data
- `download_opencellid_cached.cjs` - Download cached OpenCellID data

### **Data Management**
- `tower_db_manager.cjs` - Tower database management
- `load_sample_states.cjs` - Load sample states data
- `load_towers_to_redis.cjs` - Load tower data to Redis
- `load_region_towers.cjs` - Load regional tower data
- `load_local_radius_towers.cjs` - Load local radius tower data
- `load_all_towers_to_redis.cjs` - Load all tower data to Redis

## 🚀 Usage

```bash
# Setup Redis
./setup_redis.sh

# Load tower data
node load_towers_to_redis.cjs

# Process OpenCellID data
node process_opencellid.cjs

# Manage tower database
node tower_db_manager.cjs
```

## 📋 Data Categories

| Category | Scripts | Purpose |
|----------|---------|---------|
| Redis | `redis_*.sh`, `load_*.cjs` | Redis data management |
| OpenCellID | `process_opencellid.cjs`, `download_opencellid_cached.cjs` | Cell tower data |
| Tower DB | `tower_db_manager.cjs`, `load_*.cjs` | Tower database operations |
| Utilities | `cleanEntities.cjs`, `extract_ongoing.cjs` | Data processing |

## 🔧 Configuration

Data scripts use configuration from:
- Redis configuration files
- Environment variables for database connections
- Data files in `redis/` and data directories
