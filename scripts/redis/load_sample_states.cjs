#!/usr/bin/env node

/**
 * Load a sample of states to test the improved loader
 */

const fs = require('fs');
const path = require('path');
const redis = require('redis');

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const STATES_DIR = path.join(__dirname, '../data/opencellid/states');
const BATCH_SIZE = 100;

// Test with medium-sized states
const TEST_STATES = ['DE', 'RI', 'VT', 'WY', 'NV']; // Mix of sizes

// Regional groupings
const REGION_GROUPS = {
  'west': ['WA', 'OR', 'CA', 'NV', 'ID', 'MT', 'WY', 'UT', 'CO', 'AZ', 'NM', 'AK', 'HI'],
  'midwest': ['ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'IN', 'MI', 'OH'],
  'south': ['TX', 'OK', 'AR', 'LA', 'MS', 'AL', 'TN', 'KY', 'WV', 'VA', 'NC', 'SC', 'GA', 'FL', 'MD', 'DE'],
  'northeast': ['PA', 'NY', 'NJ', 'CT', 'RI', 'MA', 'VT', 'NH', 'ME'],
  'territories': ['PR', 'VI', 'GU', 'MP', 'AS', 'DC']
};

// Technology mappings
const TECH_MAPPING = {
  'LTE': 'lte',
  'NR': 'nr',
  'UMTS': 'umts',
  'GSM': 'gsm',
  'CDMA': 'cdma',
  'UNKNOWN': 'unknown'
};

// Colors
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
  for (const [region, states] of Object.entries(REGION_GROUPS)) {
    if (states.includes(state)) {
      return region;
    }
  }
  return 'other';
}

function parseTowerRecord(line, state) {
  const fields = line.trim().split(',');
  if (fields.length < 12) return null;
  
  // Skip header row
  if (fields[0] === 'radio') return null;

  // CSV format: radio,mcc,mnc,lac,cell,range,lon,lat,samples,change,created,updated,averageSignal
  const [radio, mcc, mnc, lac, cell, range, lon, lat, samples, _change, created, updated, _averageSignal] = fields;
  
  // Validate coordinates
  const lonNum = parseFloat(lon);
  const latNum = parseFloat(lat);
  if (isNaN(lonNum) || isNaN(latNum) || lonNum === 0 || latNum === 0) {
    return null;
  }
  
  // Validate coordinate ranges
  if (lonNum < -180 || lonNum > 180 || latNum < -90 || latNum > 90) {
    return null;
  }
  
  // Additional validation for US coordinates
  if (lonNum < -160 || lonNum > -60 || latNum < 15 || latNum > 75) {
    const territories = ['AK', 'HI', 'PR', 'VI', 'GU', 'MP', 'AS'];
    if (!territories.includes(state)) {
      return null;
    }
  }

  const tech = TECH_MAPPING[radio] || 'unknown';
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

async function loadSampleStates(client) {
  log(`\n🧪 Loading ${TEST_STATES.length} sample states...`, 'cyan');
  
  let totalTowers = 0;
  const startTime = Date.now();
  
  for (const state of TEST_STATES) {
    const stateFile = path.join(STATES_DIR, `${state}.csv`);
    
    if (!fs.existsSync(stateFile)) {
      log(`   ⚠️  ${state}.csv not found, skipping`, 'yellow');
      continue;
    }
    
    const region = getRegionFromState(state);
    log(`\n📂 Loading ${state} (${region})...`, 'blue');
    
    try {
      const content = fs.readFileSync(stateFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      let valid = 0;
      const techCounts = {};
      
      for (let i = 0; i < lines.length; i += BATCH_SIZE) {
        const batch = lines.slice(i, i + BATCH_SIZE);
        
        try {
          const pipeline = client.multi();
          
          for (const line of batch) {
            const tower = parseTowerRecord(line, state);
            if (!tower) continue;
            
            valid++;
            techCounts[tower.tech] = (techCounts[tower.tech] || 0) + 1;
            
            // Add to indexes
            pipeline.geoAdd(`towers:state:${state}`, {
              longitude: tower.lon,
              latitude: tower.lat,
              member: tower.id
            });
            
            pipeline.geoAdd(`towers:region:${region}`, {
              longitude: tower.lon,
              latitude: tower.lat,
              member: tower.id
            });
            
            pipeline.geoAdd(`towers:tech:${tower.tech}`, {
              longitude: tower.lon,
              latitude: tower.lat,
              member: tower.id
            });
            
            // Store tower details
            pipeline.hSet(tower.id, {
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
          
          await pipeline.exec();
          
          if (valid % 500 === 0) {
            process.stdout.write(`.`);
          }
          
        } catch (batchError) {
          log(`\n   ⚠️  Batch error: ${batchError.message}`, 'yellow');
        }
      }
      
      totalTowers += valid;
      log(`\n   ✓ ${state}: ${valid.toLocaleString()} towers`, 'green');
      
      const techBreakdown = Object.entries(techCounts)
        .map(([tech, count]) => `${tech}: ${count.toLocaleString()}`)
        .join(', ');
      log(`   📊 Technologies: ${techBreakdown}`, 'cyan');
      
    } catch (error) {
      log(`   ✗ Error loading ${state}: ${error.message}`, 'red');
    }
  }
  
  log(`\n🎉 Sample loading completed!`, 'green');
  log(`📊 Total towers: ${totalTowers.toLocaleString()}`, 'blue');
  log(`⏱️  Load time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`, 'yellow');
  
  return totalTowers;
}

async function main() {
  log('🧪 Sample State Tower Loader', 'bright');
  log('============================', 'bright');
  
  const client = await connectRedis();
  
  try {
    // Clear existing data
    log('\n🧹 Clearing existing data...', 'yellow');
    const keys = await client.keys('towers:*');
    if (keys.length > 0) {
      await client.del(keys);
      log(`   ✓ Cleared ${keys.length} keys`, 'green');
    }
    
    await loadSampleStates(client);
    
    log('\n✅ Sample test successful!', 'green');
    log('💡 Ready to try full loader with improved stability', 'cyan');
    
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
