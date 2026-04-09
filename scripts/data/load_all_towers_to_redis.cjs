#!/usr/bin/env node

/**
 * Load ALL OpenCellID tower data from state files into Redis
 * Organizes towers by state, region, and technology for efficient querying
 */

const fs = require('fs');
const path = require('path');
const redis = require('redis');

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const STATES_DIR = path.join(__dirname, '../data/opencellid/states');
const BATCH_SIZE = 100; // Smaller batches for stability

// Regional groupings for better organization
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
  'NR': 'nr',      // 5G
  'UMTS': 'umts',  // 3G
  'GSM': 'gsm',    // 2G
  'CDMA': 'cdma',
  'UNKNOWN': 'unknown'
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
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
  
  // Validate coordinate ranges (US bounds check)
  if (lonNum < -180 || lonNum > 180 || latNum < -90 || latNum > 90) {
    return null;
  }
  
  // Additional validation for reasonable US coordinates
  if (lonNum < -160 || lonNum > -60 || latNum < 15 || latNum > 75) {
    // Outside continental US bounds, but could be territories
    // Allow only for known territories
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

async function loadStateFile(client, stateFile) {
  const state = path.basename(stateFile, '.csv');
  const region = getRegionFromState(state);
  
  log(`\n📂 Loading ${state} (${region})...`, 'cyan');
  
  try {
    const content = fs.readFileSync(stateFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    let processed = 0;
    let valid = 0;
    const techCounts = {};
    
    // Process in smaller batches with connection recovery
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
      const batch = lines.slice(i, i + BATCH_SIZE);
      
      try {
        const pipeline = client.multi();
        
        for (const line of batch) {
          processed++;
          const tower = parseTowerRecord(line, state);
          if (!tower) continue;
          
          valid++;
          
          // Count by technology
          techCounts[tower.tech] = (techCounts[tower.tech] || 0) + 1;
          
          // Add to state geospatial index
          pipeline.geoAdd(`towers:state:${state}`, {
            longitude: tower.lon,
            latitude: tower.lat,
            member: tower.id
          });
          
          // Add to region geospatial index
          pipeline.geoAdd(`towers:region:${region}`, {
            longitude: tower.lon,
            latitude: tower.lat,
            member: tower.id
          });
          
          // Add to technology geospatial index
          pipeline.geoAdd(`towers:tech:${tower.tech}`, {
            longitude: tower.lon,
            latitude: tower.lat,
            member: tower.id
          });
          
          // Add to combined state+tech index
          pipeline.geoAdd(`towers:${state}:${tower.tech}`, {
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
        
        // Progress indicator
        if (processed % 1000 === 0) {
          process.stdout.write(`.`);
        }
        
        // Small delay to prevent overwhelming Redis
        if (i % (BATCH_SIZE * 10) === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
      } catch (batchError) {
        log(`\n   ⚠️  Batch error at line ${i}: ${batchError.message}`, 'yellow');
        // Try to reconnect and continue
        try {
          if (!client.isOpen) {
            await client.connect();
            log(`   🔌 Reconnected to Redis`, 'green');
          }
        } catch (reconnectError) {
          log(`   ❌ Reconnection failed: ${reconnectError.message}`, 'red');
          throw reconnectError;
        }
      }
    }
    
    log(`\n   ✓ ${state}: ${valid.toLocaleString()} towers processed`, 'green');
    
    // Log technology breakdown
    const techBreakdown = Object.entries(techCounts)
      .map(([tech, count]) => `${tech}: ${count.toLocaleString()}`)
      .join(', ');
    log(`   📊 Technologies: ${techBreakdown}`, 'blue');
    
    return { state, region, total: valid, techCounts };
    
  } catch (error) {
    log(`   ✗ Error loading ${state}: ${error.message}`, 'red');
    return null;
  }
}

async function loadAllStates(client) {
  const stateFiles = fs.readdirSync(STATES_DIR)
    .filter(file => file.endsWith('.csv') && file !== 'UNKNOWN.csv')
    .map(file => path.join(STATES_DIR, file));
  
  log(`\n🚀 Loading ${stateFiles.length} state files into Redis...`, 'bright');
  
  const startTime = Date.now();
  const results = [];
  let totalTowers = 0;
  
  for (const stateFile of stateFiles) {
    const result = await loadStateFile(client, stateFile);
    if (result) {
      results.push(result);
      totalTowers += result.total;
    }
  }
  
  // Update metadata
  const metadata = {
    loadedAt: new Date().toISOString(),
    total: totalTowers.toString(),
    states: results.length.toString(),
    regions: Object.keys(REGION_GROUPS).length.toString(),
    loadTime: ((Date.now() - startTime) / 1000).toFixed(2) + 's'
  };
  
  await client.hSet('towers:meta', metadata);
  
  // Create region summaries
  const regionSummary = {};
  for (const result of results) {
    if (!regionSummary[result.region]) {
      regionSummary[result.region] = { total: 0, states: [], techCounts: {} };
    }
    regionSummary[result.region].total += result.total;
    regionSummary[result.region].states.push(result.state);
    
    // Merge tech counts
    for (const [tech, count] of Object.entries(result.techCounts)) {
      regionSummary[result.region].techCounts[tech] = 
        (regionSummary[result.region].techCounts[tech] || 0) + count;
    }
  }
  
  // Store region summaries
  for (const [region, data] of Object.entries(regionSummary)) {
    await client.hSet(`towers:region:${region}:meta`, {
      total: data.total.toString(),
      states: data.states.join(','),
      loadTime: metadata.loadTime
    });
  }
  
  return { totalTowers, results, regionSummary, metadata };
}

function displaySummary(totalTowers, results, regionSummary, metadata) {
  log('\n' + '='.repeat(60), 'bright');
  log('📊 LOADING SUMMARY', 'bright');
  log('='.repeat(60), 'bright');
  
  log(`\n🗺️  Total Towers Loaded: ${totalTowers.toLocaleString()}`, 'green');
  log(`📁 States Processed: ${results.length}`, 'blue');
  log(`⏱️  Load Time: ${metadata.loadTime}`, 'yellow');
  log(`🕐 Loaded At: ${new Date(metadata.loadedAt).toLocaleString()}`, 'cyan');
  
  log('\n🌍 Regional Breakdown:', 'bright');
  for (const [region, data] of Object.entries(regionSummary)) {
    const techBreakdown = Object.entries(data.techCounts)
      .map(([tech, count]) => `${tech}: ${count.toLocaleString()}`)
      .join(', ');
    log(`   ${region.toUpperCase()}: ${data.total.toLocaleString()} towers (${data.states.length} states)`, 'blue');
    log(`     └─ ${techBreakdown}`, 'grey');
  }
  
  log('\n🔍 Available Redis Keys:', 'bright');
  log('   Geospatial indexes:', 'cyan');
  log('     - towers:state:<STATE> (e.g., towers:state:CA)');
  log('     - towers:region:<REGION> (e.g., towers:region:west)');
  log('     - towers:tech:<TECH> (e.g., towers:tech:lte)');
  log('     - towers:<STATE>:<TECH> (e.g., towers:CA:lte)');
  log('   Tower records:', 'cyan');
  log('     - tower:<STATE>:<MCC>:<MNC>:<LAC>:<CELL>:<LAT>:<LON>');
  log('   Metadata:', 'cyan');
  log('     - towers:meta (global stats)');
  log('     - towers:region:<REGION>:meta (regional stats)');
  
  log('\n✅ All tower data loaded successfully!', 'green');
  log('💡 You can now query towers by state, region, or technology', 'yellow');
}

async function main() {
  log('🗺️  OpenCellID All-State Tower Loader', 'bright');
  log('=========================================', 'bright');
  
  const client = await connectRedis();
  
  try {
    // Clear existing tower data
    log('\n🧹 Clearing existing tower data...', 'yellow');
    const keys = await client.keys('towers:*');
    if (keys.length > 0) {
      await client.del(keys);
      log(`   ✓ Cleared ${keys.length} existing keys`, 'green');
    }
    
    // Load all state data
    const { totalTowers, results, regionSummary, metadata } = await loadAllStates(client);
    
    // Display summary
    displaySummary(totalTowers, results, regionSummary, metadata);
    
  } catch (error) {
    log(`\n❌ Error during loading: ${error.message}`, 'red');
    process.exit(1);
  } finally {
    await client.quit();
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('\n\n⚠️  Loading interrupted by user', 'yellow');
  process.exit(0);
});

if (require.main === module) {
  main().catch(error => {
    log(`\n💥 Fatal error: ${error.message}`, 'red');
    process.exit(1);
  });
}
