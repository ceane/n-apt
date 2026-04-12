# Redis Tower Data Integration

This document explains how Redis is integrated with the N-APT backend for efficient cell tower querying on the `/map-endpoints` route.

## Overview

The Redis integration provides:
- **Geospatial indexing** for fast coordinate-based tower queries
- **Technology-specific indexes** (LTE, 5G, 3G, 2G) for filtering
- **Automatic data loading** from OpenCellID CSV files
- **Bounds-based queries** for map visualization

## Architecture

### Redis Data Structure

```
# Region-based geospatial indexes
towers:bay_area    -> GEOADD (lon, lat, tower_id)
towers:miami       -> GEOADD (lon, lat, tower_id)

# Technology-specific indexes  
towers:lte         -> GEOADD (lon, lat, tower_id)
towers:nr          -> GEOADD (lon, lat, tower_id)
towers:umts        -> GEOADD (lon, lat, tower_id)
towers:gsm         -> GEOADD (lon, lat, tower_id)

# Individual tower records
tower:bay_area:310:260:275:20441:37.6955:-122.4709 -> HSET (radio, mcc, mnc, lac, cell, range, lon, lat, samples, created, updated, averageSignal, region)

# Metadata
towers:meta -> HSET (loadedAt, total, bayArea, miami)
```

### Query Flow

1. **Frontend** sends map bounds + filters to `/api/towers/bounds`
2. **Backend** calculates search radius and queries appropriate Redis indexes
3. **Redis** returns tower IDs within radius using `GEORADIUS`
4. **Backend** fetches full tower details and applies rectangle filtering
5. **Frontend** renders tower markers with technology-specific styling

## Usage

### Development Workflow

The Redis server is automatically started and loaded when you run the main dev script:

```bash
npm run dev
```

This will:
1. Start Redis server on port 6379
2. Load tower data from `data/opencellid/ongoing/`
3. Display Redis status in the service dashboard

### Manual Redis Management

```bash
# Full setup (install + start + load data)
npm run redis:setup

# Individual operations
npm run redis:start
npm run redis:stop  
npm run redis:status

# Load/reload tower data
npm run towers:load:redis
```

### Data Loading

The Redis loader processes these files:
- `data/opencellid/ongoing/bay_area_ca.csv`
- `data/opencellid/ongoing/miami_fl.csv`

Each tower is stored with:
- Geospatial indexing for fast location queries
- Technology indexing for filtering
- Complete metadata for display

## API Endpoint

### GET /api/towers/bounds

Query parameters:
- `ne_lat`, `ne_lng` - Northeast bounds (required)
- `sw_lat`, `sw_lng` - Southwest bounds (required)  
- `zoom` - Map zoom level (optional)
- `tech` - Technology filter CSV (optional, e.g., "LTE,NR")
- `range` - Accuracy filter CSV (optional, e.g., "0,-1")

Example:
```
GET /api/towers/bounds?ne_lat=37.8&ne_lng=-122.3&sw_lat=37.6&sw_lng=-122.5&zoom=12&tech=LTE,NR
```

Response:
```json
{
  "towers": [
    {
      "id": "tower:bay_area:310:260:275:20441:37.6955:-122.4709",
      "radio": "LTE",
      "mcc": "310",
      "mnc": "260", 
      "lac": "275",
      "cell": "20441",
      "range": "1000",
      "lon": -122.4709,
      "lat": 37.6955,
      "samples": "45",
      "created": "2023-01-15",
      "updated": "2023-01-20"
    }
  ],
  "count": 247,
  "zoom": 12
}
```

## Frontend Integration

The `/map-endpoints` route automatically:
- Queries towers when map bounds change (debounced)
- Displays technology filter checkboxes (LTE/5G/3G/2G)
- Shows tower count and loading status
- Renders towers with color-coded markers:
  - **LTE**: Green circles
  - **5G (NR)**: Blue squares
  - **3G (UMTS)**: Yellow triangles
  - **2G (GSM)**: Red diamonds

## Performance

- **Query time**: <100ms for typical map bounds
- **Indexing**: O(log n) geospatial queries
- **Memory**: ~1MB per 10K towers
- **Caching**: Frontend caches results by bounds+filters

## Troubleshooting

### Redis Not Running
```bash
npm run redis:status
npm run redis:start
```

### No Tower Data
```bash
npm run towers:load:redis
```

### Backend Can't Connect
Check that Redis is on port 6379:
```bash
lsof -ti:6379
```

### Data Files Missing
Ensure these files exist:
- `data/opencellid/ongoing/bay_area_ca.csv`
- `data/opencellid/ongoing/miami_fl.csv`

## Configuration

Redis connection can be configured via environment variable:
```bash
export REDIS_URL=redis://localhost:6379/
```

Default: `redis://127.0.0.1/`

## Data Sources

The tower data comes from OpenCellID:
- **Bay Area, CA**: Towers within 38.44°N to 37.29°N, -123.0°W to -121.81°W
- **Miami, FL**: Towers within 25.95°N to 25.70°N, -80.30°W to -80.10°W

Data is extracted using the `extract_ongoing.cjs` script from the OpenCellID processing pipeline.
