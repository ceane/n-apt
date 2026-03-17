#!/usr/bin/env node

/**
 * Dynamic Local Tower Loading Script
 * 
 * Loads towers within a specified radius of user coordinates
 * Shards towers from the total nationwide tower database into a local cache
 * Stores results in Redis DB 4 with geospatial indexing
 */

const redis = require('redis');

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const BATCH_SIZE = 100;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// US State boundaries from existing system
const STATE_BOUNDARIES = {
  'AL': { minLat: 30.2, maxLat: 35.0, minLon: -88.5, maxLon: -84.9 },
  'AK': { minLat: 51.2, maxLat: 71.4, minLon: -179.1, maxLon: -129.9 },
  'AZ': { minLat: 31.3, maxLat: 37.0, minLon: -114.8, maxLon: -109.0 },
  'AR': { minLat: 33.0, maxLat: 36.5, minLon: -94.6, maxLon: -89.6 },
  'CA': { minLat: 32.5, maxLat: 42.0, minLon: -124.4, maxLon: -114.1 },
  'CO': { minLat: 37.0, maxLat: 41.0, minLon: -109.1, maxLon: -102.0 },
  'CT': { minLat: 40.9, maxLat: 42.0, minLon: -73.7, maxLon: -71.8 },
  'DE': { minLat: 38.4, maxLat: 39.8, minLon: -75.8, maxLon: -75.0 },
  'FL': { minLat: 24.4, maxLat: 31.0, minLon: -87.6, maxLon: -79.8 },
  'GA': { minLat: 30.4, maxLat: 35.0, minLon: -85.6, maxLon: -80.8 },
  'HI': { minLat: 18.9, maxLat: 22.2, minLon: -160.3, maxLon: -154.8 },
  'ID': { minLat: 41.9, maxLat: 49.0, minLon: -117.2, maxLon: -111.0 },
  'IL': { minLat: 37.0, maxLat: 42.5, minLon: -91.5, maxLon: -87.5 },
  'IN': { minLat: 37.8, maxLat: 41.8, minLon: -88.1, maxLon: -84.8 },
  'IA': { minLat: 40.4, maxLat: 43.5, minLon: -96.6, maxLon: -90.1 },
  'KS': { minLat: 37.0, maxLat: 40.0, minLon: -102.1, maxLon: -94.6 },
  'KY': { minLat: 36.5, maxLat: 39.1, minLon: -89.6, maxLon: -81.9 },
  'LA': { minLat: 28.9, maxLat: 33.0, minLon: -94.0, maxLon: -88.8 },
  'ME': { minLat: 43.1, maxLat: 47.5, minLon: -71.1, maxLon: -66.9 },
  'MD': { minLat: 37.9, maxLat: 39.7, minLon: -79.5, maxLon: -75.0 },
  'MA': { minLat: 41.2, maxLat: 42.9, minLon: -73.5, maxLon: -69.9 },
  'MI': { minLat: 41.7, maxLat: 48.1, minLon: -90.4, maxLon: -82.4 },
  'MN': { minLat: 43.5, maxLat: 49.4, minLon: -97.2, maxLon: -89.5 },
  'MS': { minLat: 30.2, maxLat: 35.0, minLon: -91.7, maxLon: -88.1 },
  'MO': { minLat: 36.0, maxLat: 40.6, minLon: -95.8, maxLon: -89.1 },
  'MT': { minLat: 44.4, maxLat: 49.0, minLon: -116.1, maxLon: -104.0 },
  'NE': { minLat: 40.0, maxLat: 43.0, minLon: -104.1, maxLon: -95.3 },
  'NV': { minLat: 35.0, maxLat: 42.0, minLon: -120.0, maxLon: -114.0 },
  'NH': { minLat: 42.7, maxLat: 45.3, minLon: -72.6, maxLon: -70.6 },
  'NJ': { minLat: 38.9, maxLat: 41.4, minLon: -75.6, maxLon: -73.9 },
  'NM': { minLat: 31.3, maxLat: 37.0, minLon: -109.1, maxLon: -103.0 },
  'NY': { minLat: 40.5, maxLat: 45.0, minLon: -79.8, maxLon: -71.8 },
  'NC': { minLat: 33.8, maxLat: 36.6, minLon: -84.3, maxLon: -75.4 },
  'ND': { minLat: 45.9, maxLat: 49.0, minLon: -104.1, maxLon: -96.6 },
  'OH': { minLat: 38.4, maxLat: 42.1, minLon: -84.8, maxLon: -80.5 },
  'OK': { minLat: 33.6, maxLat: 37.0, minLon: -103.0, maxLon: -94.4 },
  'OR': { minLat: 41.9, maxLat: 46.3, minLon: -124.7, maxLon: -116.5 },
  'PA': { minLat: 39.7, maxLat: 42.5, minLon: -80.5, maxLon: -74.7 },
  'RI': { minLat: 41.1, maxLat: 42.0, minLon: -71.9, maxLon: -71.1 },
  'SC': { minLat: 32.0, maxLat: 35.2, minLon: -83.4, maxLon: -78.5 },
  'SD': { minLat: 42.5, maxLat: 45.9, minLon: -104.1, maxLon: -96.4 },
  'TN': { minLat: 34.9, maxLat: 36.7, minLon: -90.3, maxLon: -81.6 },
  'TX': { minLat: 25.8, maxLat: 36.5, minLon: -106.6, maxLon: -93.5 },
  'UT': { minLat: 37.0, maxLat: 42.0, minLon: -114.1, maxLon: -109.0 },
  'VA': { minLat: 36.5, maxLat: 39.5, minLon: -83.7, maxLon: -75.2 },
  'VT': { minLat: 42.7, maxLat: 45.0, minLon: -73.4, maxLon: -71.5 },
  'WA': { minLat: 45.5, maxLat: 49.0, minLon: -125.0, maxLon: -116.9 },
  'WI': { minLat: 42.5, maxLat: 47.1, minLon: -92.9, maxLon: -86.3 },
  'WV': { minLat: 37.2, maxLat: 40.6, minLon: -82.6, maxLon: -77.7 },
  'WY': { minLat: 40.9, maxLat: 45.0, minLon: -111.3, maxLon: -104.1 }
};

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Generate geohash for location-based caching
 */
function getGeohash(lat, lng, precision = 4) {
  const latRange = [-90, 90];
  const lngRange = [-180, 180];
  let geohash = '';
  let latMin = latRange[0], latMax = latRange[1];
  let lngMin = lngRange[0], lngMax = lngRange[1];

  for (let i = 0; i < precision; i++) {
    const latMid = (latMin + latMax) / 2;
    const lngMid = (lngMin + lngMax) / 2;

    if (lng <= lngMid) {
      geohash += '0';
      lngMax = lngMid;
    } else {
      geohash += '1';
      lngMin = lngMid;
    }

    if (lat <= latMid) {
      geohash += '0';
      latMax = latMid;
    } else {
      geohash += '1';
      latMin = latMid;
    }
  }

  return geohash;
}

/**
 * Determine which states intersect with a radius around a point
 */
function getStatesInRadius(centerLat, centerLng, radiusKm) {
  const latDelta = radiusKm / 111; // ~111km per degree latitude
  const lngDelta = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));
  
  const bounds = {
    minLat: centerLat - latDelta,
    maxLat: centerLat + latDelta,
    minLng: centerLng - lngDelta,
    maxLng: centerLng + lngDelta
  };
  
  const statesInRadius = [];
  for (const [state, stateBounds] of Object.entries(STATE_BOUNDARIES)) {
    // Check if bounding boxes intersect
    if (bounds.maxLat >= stateBounds.minLat && bounds.minLat <= stateBounds.maxLat &&
        bounds.maxLng >= stateBounds.minLon && bounds.minLng <= stateBounds.maxLon) {
      statesInRadius.push(state);
    }
  }
  
  return statesInRadius;
}

/**
 * Load towers for specific states and filter by distance
 */
async function loadLocalTowers(centerLat, centerLng, radiusKm = 25) {
  log(`Loading towers within ${radiusKm}km of (${centerLat}, ${centerLng})`, 'cyan');
  
  // 1. Determine which states are in the radius
  const states = getStatesInRadius(centerLat, centerLng, radiusKm);
  log(`Found ${states.length} states in radius: ${states.join(', ')}`, 'blue');
  
  // 2. Load towers from Redis DB 3 (total nationwide tower database)
  const allTowers = [];
  
  // Connect to Redis DB 3 for total tower data
  const towerClient = redis.createClient({ url: REDIS_URL });
  await towerClient.connect();
  
  try {
    // Get all tower keys from DB 3
    await towerClient.select(3);
    const towerKeys = await towerClient.keys('tower:*');
    
    log(`Found ${towerKeys.length} total towers in Redis DB 3`, 'blue');
    
    // Process towers in batches
    for (let i = 0; i < towerKeys.length; i += BATCH_SIZE) {
      const batch = towerKeys.slice(i, i + BATCH_SIZE);
      
      for (const towerKey of batch) {
        try {
          // Get tower data as JSON string
          const towerJson = await towerClient.get(towerKey);
          if (!towerJson) continue;
          
          const towerData = JSON.parse(towerJson);
          
          // Extract coordinates
          const lat = towerData.lat;
          const lon = towerData.lon;

          // Skip if coordinates are invalid
          if (!lat || !lon || lat === 0 || lon === 0) {
            continue;
          }
          
          // Convert to expected format
          const tower = {
            id: towerKey,
            radio: towerData.type || 'UNKNOWN',
            mcc: towerData.mcc?.toString() || '',
            mnc: towerData.mnc?.toString() || '',
            lac: towerData.lac?.toString() || '',
            cell: towerData.cellId?.toString() || '',
            range: towerData.range?.toString() || '0',
            lon: lon, // Keep as lon for consistency
            lat: lat,
            samples: towerData.samples?.toString() || '0',
            created: towerData.created?.toString() || '',
            updated: towerData.updated?.toString() || '',
            state: 'Unknown', // Could be derived from coordinates
            tech: towerData.type || 'UNKNOWN'
          };
          
          allTowers.push(tower);
        } catch (error) {
          // Skip invalid tower records
          continue;
        }
      }
      
      if (i % (BATCH_SIZE * 10) === 0) {
        log(`Processed ${Math.min(i + BATCH_SIZE, towerKeys.length)} of ${towerKeys.length} towers...`, 'blue');
      }
    }
    
    log(`Loaded ${allTowers.length} towers from Redis DB 3`, 'green');
    
  } catch (error) {
    log(`Error loading towers from Redis: ${error.message}`, 'red');
  } finally {
    await towerClient.quit();
  }
  
  // 3. Filter by actual distance from center
  const localTowers = allTowers.filter(tower => {
    const distance = calculateDistance(centerLat, centerLng, tower.lat, tower.lon);
    return distance <= radiusKm;
  });
  
  log(`Filtered to ${localTowers.length} towers within ${radiusKm}km`, 'green');
  
  // 4. Store in Redis DB 4
  await storeLocalTowers(localTowers, centerLat, centerLng, radiusKm);
  
  return {
    loaded: localTowers.length,
    radius: radiusKm,
    center: [centerLat, centerLng], // Return as array/tuple instead of object
    states: states.length,
    cached: false
  };
}

/**
 * Store local towers in Redis with memory-efficient encoding
 */
async function storeLocalTowers(towers, centerLat, centerLng, radiusKm) {
  const client = redis.createClient({ url: REDIS_URL });
  
  try {
    await client.connect();
    
    // Use DB 4 for local towers
    await client.select(4);
    
    // Generate cache key
    const geohash = getGeohash(centerLat, centerLng, 4);
    const cacheKey = `local:${geohash}:${radiusKm}`;
    
    log(`Storing towers in Redis: ${cacheKey}`, 'cyan');

    await client.del(cacheKey, `${cacheKey}:data`);
    
    // Store shard in smaller batches
    log(`Storing ${towers.length} towers in batches of ${BATCH_SIZE}`, 'blue');
    
    for (let i = 0; i < towers.length; i += BATCH_SIZE) {
      const batch = towers.slice(i, i + BATCH_SIZE);
      
      const operations = [];
      
      batch.forEach(tower => {
        // Skip towers with invalid coordinates
        if (!tower.lat || !tower.lon || tower.lat === 0 || tower.lon === 0) {
          return;
        }

        const fullTowerData = JSON.stringify({
          type: tower.radio,
          mcc: Number(tower.mcc) || 0,
          mnc: Number(tower.mnc) || 0,
          lac: Number(tower.lac) || 0,
          cellId: Number(tower.cell) || 0,
          range: Number(tower.range) || 0,
          lon: tower.lon,
          lat: tower.lat,
          samples: Number(tower.samples) || 0,
          created: Number(tower.created) || 0,
          updated: Number(tower.updated) || 0,
        });
        
        operations.push(
          client.setEx(tower.id, 6 * 3600, fullTowerData),
          client.geoAdd(cacheKey, { longitude: tower.lon, latitude: tower.lat, member: tower.id })
        );
      });
      
      operations.push(client.expire(cacheKey, 6 * 3600));
      
      try {
        await Promise.all(operations);
      } catch (error) {
        log(`Batch ${Math.floor(i/BATCH_SIZE) + 1} failed: ${error.message}`, 'red');
        throw error;
      }
    }
    
    log(`Stored ${towers.length} towers with 6-hour TTL`, 'green');
    
  } catch (error) {
    log(`Redis error: ${error.message}`, 'red');
    throw error;
  } finally {
    await client.disconnect();
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node load_local_radius_towers.cjs <latitude> <longitude> [radius_km]');
    console.log('Example: node load_local_radius_towers.cjs 37.7749 -122.4194 25');
    process.exit(1);
  }
  
  const latitude = parseFloat(args[0]);
  const longitude = parseFloat(args[1]);
  const radiusKm = args[2] ? parseInt(args[2]) : 25;
  
  if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusKm)) {
    log('Invalid coordinates or radius', 'red');
    process.exit(1);
  }
  
  if (radiusKm < 5 || radiusKm > 200) {
    log('Radius must be between 5km and 200km', 'red');
    process.exit(1);
  }
  
  try {
    const result = await loadLocalTowers(latitude, longitude, radiusKm);
    
    log('\n✅ Local tower loading complete!', 'green');
    log(`📍 Center: (${result.center[0]}, ${result.center[1]})`, 'blue');
    log(`📏 Radius: ${result.radius}km`, 'blue');
    log(`🗺️  States: ${result.states}`, 'blue');
    log(`📡 Towers loaded: ${result.loaded}`, 'green');
    
    // Output JSON result for API consumption
    console.log('\n' + JSON.stringify(result));
    
  } catch (error) {
    log(`❌ Failed to load local towers: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  loadLocalTowers,
  getStatesInRadius,
  calculateDistance,
  getGeohash
};
