#!/usr/bin/env node

/**
 * Test loader for a few small states to verify the all-states loader works
 */

const fs = require('fs');
const path = require('path');
const redis = require('redis');

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const STATES_DIR = path.join(__dirname, '../data/opencellid/states');

// Test with small states first
const TEST_STATES = ['RI', 'DE', 'VT', 'WY']; // Small states for testing

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

async function connectRedis() {
  try {
    const client = redis.createClient({ url: REDIS_URL });
    await client.connect();
    log('✓ Connected to Redis', 'green');
    return client;
  } catch (error) {
    log(`✗ Redis connection failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

function getRegionFromState(state) {
  const REGION_GROUPS = {
    'west': ['WA', 'OR', 'CA', 'NV', 'ID', 'MT', 'WY', 'UT', 'CO', 'AZ', 'NM', 'AK', 'HI'],
    'midwest': ['ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'IN', 'MI', 'OH'],
    'south': ['TX', 'OK', 'AR', 'LA', 'MS', 'AL', 'TN', 'KY', 'WV', 'VA', 'NC', 'SC', 'GA', 'FL', 'MD', 'DE'],
    'northeast': ['PA', 'NY', 'NJ', 'CT', 'RI', 'MA', 'VT', 'NH', 'ME'],
    'territories': ['PR', 'VI', 'GU', 'MP', 'AS', 'DC']
  };

  for (const [region, states] of Object.entries(REGION_GROUPS)) {
    if (states.includes(state)) {
      return region;
    }
  }
  return 'other';
}

function parseTowerRecord(line, state) {
  const fields = line.trim().split(',');
  if (fields.length < 11) return null;

  const [radio, mcc, mnc, lac, cell, lon, lat, range, samples, created, updated] = fields;
  
  // Validate coordinates
  const lonNum = parseFloat(lon);
  const latNum = parseFloat(lat);
  if (isNaN(lonNum) || isNaN(latNum) || lonNum === 0 || latNum === 0) {
    return null;
  }

  const techMapping = {
    'LTE': 'lte',
    'NR': 'nr',
    'UMTS': 'umts',
    'GSM': 'gsm',
    'CDMA': 'cdma',
    'UNKNOWN': 'unknown'
  };

  const tech = techMapping[radio] || 'unknown';
  const region = getRegionFromState(state);
  
  return {
    id: `tower:${state}:${mcc}:${mnc}:${lac}:${cell}:${lat}:${lon}`,
    state,
    region,
    radio,
    mcc,
    mnc,
    lac,
    cell,
    lon: lonNum,
    lat: latNum,
    range: range || '-1',
    samples: samples || '0',
    created: created || '',
    updated: updated || '',
    tech
  };
}

async function loadTestStates(client) {
  log(`\n🧪 Testing loader with ${TEST_STATES.length} small states...`, 'cyan');
  
  let totalTowers = 0;
  const startTime = Date.now();
  
  for (const state of TEST_STATES) {
    const stateFile = path.join(STATES_DIR, `${state}.csv`);
    
    if (!fs.existsSync(stateFile)) {
      log(`   ⚠️  ${state}.csv not found, skipping`, 'yellow');
      continue;
    }
    
    log(`\n📂 Loading ${state}...`, 'blue');
    
    try {
      const content = fs.readFileSync(stateFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      let valid = 0;
      const techCounts = {};
      
      for (const line of lines) {
        const tower = parseTowerRecord(line, state);
        if (!tower) continue;
        
        valid++;
        
        // Count by technology
        techCounts[tower.tech] = (techCounts[tower.tech] || 0) + 1;
        
        // Add to state geospatial index
        await client.geoAdd(`towers:state:${state}`, {
          longitude: tower.lon,
          latitude: tower.lat,
          member: tower.id
        });
        
        // Add to region geospatial index
        await client.geoAdd(`towers:region:${tower.region}`, {
          longitude: tower.lon,
          latitude: tower.lat,
          member: tower.id
        });
        
        // Add to technology geospatial index
        await client.geoAdd(`towers:tech:${tower.tech}`, {
          longitude: tower.lon,
          latitude: tower.lat,
          member: tower.id
        });
        
        // Store tower details
        await client.hSet(tower.id, {
          state: tower.state,
          region: tower.region,
          radio: tower.radio,
          mcc: tower.mcc,
          mnc: tower.mnc,
          lac: tower.lac,
          cell: tower.cell,
          lon: tower.lon.toString(),
          lat: tower.lat.toString(),
          range: tower.range,
          samples: tower.samples,
          created: tower.created,
          updated: tower.updated,
          tech: tower.tech
        });
      }
      
      totalTowers += valid;
      log(`   ✓ ${state}: ${valid.toLocaleString()} towers`, 'green');
      
      // Log technology breakdown
      const techBreakdown = Object.entries(techCounts)
        .map(([tech, count]) => `${tech}: ${count.toLocaleString()}`)
        .join(', ');
      log(`   📊 Technologies: ${techBreakdown}`, 'cyan');
      
    } catch (error) {
      log(`   ✗ Error loading ${state}: ${error.message}`, 'red');
    }
  }
  
  // Update test metadata
  const metadata = {
    loadedAt: new Date().toISOString(),
    total: totalTowers.toString(),
    states: TEST_STATES.length.toString(),
    loadTime: ((Date.now() - startTime) / 1000).toFixed(2) + 's',
    test: 'true'
  };
  
  await client.hSet('towers:test_meta', metadata);
  
  log(`\n🎉 Test completed!`, 'green');
  log(`📊 Total towers loaded: ${totalTowers.toLocaleString()}`, 'blue');
  log(`⏱️  Load time: ${metadata.loadTime}`, 'yellow');
  
  return totalTowers;
}

async function main() {
  log('🧪 OpenCellID Test Loader', 'bright');
  log('==========================', 'bright');
  
  const client = await connectRedis();
  
  try {
    // Clear existing test data
    log('\n🧹 Clearing existing test data...', 'yellow');
    const testKeys = await client.keys('towers:*');
    if (testKeys.length > 0) {
      await client.del(testKeys);
      log(`   ✓ Cleared ${testKeys.length} existing keys`, 'green');
    }
    
    // Load test states
    await loadTestStates(client);
    
    log('\n✅ Test successful! Ready to run full loader.', 'green');
    log('💡 Run "npm run towers:load:all" to load all 50 states', 'cyan');
    
  } catch (error) {
    log(`\n❌ Test failed: ${error.message}`, 'red');
    process.exit(1);
  } finally {
    await client.quit();
  }
}

if (require.main === module) {
  main().catch(error => {
    log(`\n💥 Fatal error: ${error.message}`, 'red');
    process.exit(1);
  });
}
