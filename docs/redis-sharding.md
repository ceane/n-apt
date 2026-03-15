# Redis Sharding Guide

## Memory Optimization Strategies

Reduce Redis memory usage from 447MB (606K towers) to as low as 12MB by loading only the data you need.

## 🎯 Sharding Options

### **Option 1: Geographic Sharding** (Recommended)

Load specific regions or states instead of all 600K+ towers.

```bash
# Single state (most memory efficient)
npm run towers:load:region -- --state CA     # 98K towers ~80MB
npm run towers:load:region -- --state NY     # 17K towers ~15MB

# Regional loading
npm run towers:load:region -- --region west      # 152K towers ~120MB
npm run towers:load:region -- --region northeast  # 101K towers ~80MB

# Multiple regions
npm run towers:load:region -- --region west --region california
```

### **Option 2: Technology Sharding**

Load only specific technologies (5G, 4G, etc.).

```bash
# 5G towers only
npm run towers:load:region -- --region west --tech nr    # 20K towers ~20MB

# 4G/LTE only  
npm run towers:load:region -- --region west --tech lte   # 128K towers ~100MB
```

### **Option 3: Combined Sharding**

Mix geography + technology for maximum efficiency.

```bash
# California 5G only
npm run towers:load:region -- --state CA --tech nr       # 15K towers ~12MB

# Northeast 4G only
npm run towers:load:region -- --region northeast --tech lte  # 78K towers ~60MB
```

## 📊 Memory Usage Comparison

| Dataset | Towers | Memory | Use Case |
|---------|--------|--------|----------|
| **All States** | 606,531 | 447MB | Production/Full testing |
| **West Region** | 152,268 | 120MB | West coast development |
| **California** | 97,816 | 80MB | CA-focused development |
| **Single State** | 5K-98K | 5-80MB | State-specific work |
| **5G Only** | 115,000 | 90MB | 5G network analysis |
| **CA + 5G** | 14,744 | 12MB | Minimal testing |
| **NY + 4G** | 14,140 | 11MB | East coast 4G testing |

## 🚀 Quick Start Commands

### **Development (Recommended)**
```bash
# Start Redis
npm run redis:persistent start

# Load your region (example: California)
npm run towers:load:region -- --state CA

# Check memory usage
npm run redis:persistent status
```

### **Minimal Testing**
```bash
# Ultra-lightweight (12MB)
npm run towers:load:region -- --state CA --tech nr

# East coast 4G (11MB)  
npm run towers:load:region -- --state NY --tech lte
```

### **Regional Development**
```bash
# West coast (120MB)
npm run towers:load:region -- --region west

# Northeast (80MB)
npm run towers:load:region -- --region northeast

# South (160MB)
npm run towers:load:region -- --region south
```

## 🗺️ Available Regions

| Region | States | Tower Count | Memory |
|--------|--------|-------------|--------|
| **West** | 13 (WA, OR, CA, AZ, etc.) | 152K | ~120MB |
| **South** | 16 (TX, FL, GA, etc.) | 251K | ~160MB |
| **Northeast** | 9 (NY, NJ, MA, etc.) | 101K | ~80MB |
| **Midwest** | 12 (IL, OH, MI, etc.) | 101K | ~80MB |
| **Territories** | 6 (PR, VI, GU, etc.) | 864 | ~2MB |

## 📱 Technology Breakdown

| Technology | Tower Count | Memory | Description |
|------------|-------------|--------|-------------|
| **LTE** | 4G/LTE | ~400K | ~300MB | 4G networks |
| **NR** | 5G | ~115K | ~90MB | 5G networks |
| **UMTS** | 3G | ~8K | ~6MB | 3G networks |
| **GSM** | 2G | ~2K | ~2MB | 2G networks |

## 💡 Development Workflow

### **1. Start Development**
```bash
# Choose your shard based on what you're working on
npm run towers:load:region -- --state CA --tech nr  # CA 5G (12MB)

# Start backend
npm run dev
```

### **2. Switch Context**
```bash
# Working on East coast? Switch regions
npm run towers:load:region -- --region northeast --tech lte

# Testing 5G coverage?
npm run towers:load:region -- --region west --tech nr
```

### **3. Full Testing**
```bash
# Need full dataset for final testing?
npm run towers:load:all  # All 606K towers (447MB)
```

### **4. Save Configuration**
```bash
# Save your current shard configuration
npm run redis:export

# Creates redis/export/current/ with your sharded data
```

## 🔧 Advanced Sharding

### **Custom State Combinations**
```bash
# Multiple specific states
npm run towers:load:region -- --state CA --state NY --state TX

# Specific technology across states
npm run towers:load:region -- --state CA --state NY --tech nr
```

### **Development Profiles**

Create shell scripts for common development profiles:

```bash
# scripts/dev-ca-5g.sh
#!/bin/bash
echo "🌴 Loading CA 5G towers (12MB)..."
npm run redis:persistent restart
npm run towers:load:region -- --state CA --tech nr
npm run redis:persistent status

# scripts/dev-northeast-4g.sh  
#!/bin/bash
echo "🏛️ Loading Northeast 4G towers (60MB)..."
npm run redis:persistent restart
npm run towers:load:region -- --region northeast --tech lte
npm run redis:persistent status
```

## 🎯 Recommended Sharding Strategies

### **Frontend Development**
- **Single state + 5G**: 12MB (fastest load times)
- **Single state + 4G**: 15MB (good coverage)
- **Region + 5G**: 20MB (regional 5G testing)

### **Backend API Development**  
- **Single state**: 15-80MB (state-specific APIs)
- **Region**: 80-120MB (regional APIs)
- **Technology-specific**: 20-90MB (tech filtering)

### **Performance Testing**
- **West region**: 120MB (large dataset, manageable)
- **South region**: 160MB (high density testing)
- **Full dataset**: 447MB (production testing)

### **Minimal Testing**
- **NY + 5G**: 2.5K towers ~3MB
- **Single territory**: <100 towers ~1MB
- **Technology-only**: 20-90MB

## 🔄 Switching Between Shards

```bash
# Quick shard switching
redis-shard() {
    echo "🔄 Switching to $1..."
    npm run redis:persistent restart
    npm run towers:load:region -- $1
    npm run redis:persistent status
}

# Usage examples:
redis-shard "--state CA --tech nr"      # CA 5G
redis-shard "--region west"             # West region  
redis-shard "--state NY --tech lte"     # NY 4G
```

## 📈 Performance Benefits

1. **Faster Load Times**: 12MB loads in ~2 seconds vs 23 seconds for full dataset
2. **Lower Memory Usage**: 55% less memory usage with regional sharding
3. **Faster Queries**: Fewer towers = faster geospatial queries
4. **Better Development Experience**: Quicker restarts and testing cycles

## 🚨 Important Notes

- **Backend Compatibility**: All sharding is transparent to the backend API
- **Frontend Compatibility**: Map endpoints work with any shard size
- **Data Consistency**: Same data structure, just subset of towers
- **Switching Cost**: ~30 seconds to switch between shards
- **Export/Import**: Sharded data can be exported and shared

## 🎯 Recommendation

For most development work, **use regional sharding**:

```bash
# Default recommendation
npm run towers:load:region -- --region west
```

This gives you **152K towers** with **120MB memory usage** - perfect balance of coverage and performance for development!
