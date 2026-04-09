#!/usr/bin/env node

/**
 * Region-based tower loader for memory-efficient development
 * Load only specific regions instead of all 600K+ towers
 */

const fs = require('fs');
const path = require('path');
const redis = require('redis');

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const STATES_DIR = path.join(__dirname, '../data/opencellid/states');
const BATCH_SIZE = 100;

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

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    regions: [],
    states: [],
    tech: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      break;
    } else if (arg === '--region' || arg === '-r') {
      options.regions.push(args[++i]);
    } else if (arg === '--state' || arg === '-s') {
      options.states.push(args[++i]);
    } else if (arg === '--tech' || arg === '-t') {
      options.tech = args[++i];
    } else if (!arg.startsWith('-')) {
      // Default to region if no flag specified
      if (Object.keys(REGION_GROUPS).includes(arg.toUpperCase())) {
        options.regions.push(arg.toUpperCase());
      } else if (arg.length === 2) {
        options.states.push(arg.toUpperCase());
      }
    }
  }

  return options;
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

async function loadRegionData(client, options) {
  const startTime = Date.now();
  let totalTowers = 0;
  const regionStats = {};

  // Determine which states to load
  const statesToLoad = new Set();
  
  // Add states from specified regions
  for (const region of options.regions) {
    const states = REGION_GROUPS[region.toLowerCase()];
    if (states) {
      states.forEach(state => statesToLoad.add(state));
      regionStats[region] = { states: states.length, towers: 0, techCounts: {} };
    }
  }
  
  // Add individually specified states
  for (const state of options.states) {
    statesToLoad.add(state);
    const region = getRegionFromState(state);
    if (!regionStats[region]) {
      regionStats[region] = { states: 0, towers: 0, techCounts: {} };
    }
    regionStats[region].states++;
  }

  if (statesToLoad.size === 0) {
    log('❌ No regions or states specified', 'red');
    return;
  }

  log(`🗺️  Loading ${statesToLoad.size} states for regions: ${options.regions.join(', ')}`, 'cyan');
  log(`📋 Individual states: ${options.states.join(', ')}`, 'cyan');
  
  if (options.tech) {
    log(`🔬 Technology filter: ${options.tech}`, 'cyan');
  }

  // Clear existing data
  log('\n🧹 Clearing existing tower data...', 'yellow');
  const keys = await client.keys('towers:*');
  if (keys.length > 0) {
    await client.del(keys);
    log(`   ✓ Cleared ${keys.length} keys`, 'green');
  }

  // Load data for each state
  for (const state of statesToLoad) {
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
            
            // Apply technology filter if specified
            if (options.tech && tower.tech !== options.tech) {
              continue;
            }
            
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
      
      // Update region stats
      if (regionStats[region]) {
        regionStats[region].towers += valid;
        for (const [tech, count] of Object.entries(techCounts)) {
          regionStats[region].techCounts[tech] = (regionStats[region].techCounts[tech] || 0) + count;
        }
      }
      
      log(`\n   ✓ ${state}: ${valid.toLocaleString()} towers`, 'green');
      
      const techBreakdown = Object.entries(techCounts)
        .map(([tech, count]) => `${tech}: ${count.toLocaleString()}`)
        .join(', ');
      log(`   📊 Technologies: ${techBreakdown}`, 'cyan');
      
    } catch (error) {
      log(`   ✗ Error loading ${state}: ${error.message}`, 'red');
    }
  }
  
  // Update metadata
  const metadata = {
    loadedAt: new Date().toISOString(),
    total: totalTowers.toString(),
    regions: options.regions.join(','),
    states: Array.from(statesToLoad).join(','),
    tech: options.tech || '',
    loadTime: ((Date.now() - startTime) / 1000).toFixed(2) + 's',
    sharded: 'true'
  };
  
  await client.hSet('towers:meta', metadata);
  
  // Show summary
  log(`\n🎉 Region loading completed!`, 'green');
  log(`📊 Total towers: ${totalTowers.toLocaleString()}`, 'blue');
  log(`⏱️  Load time: ${metadata.loadTime}`, 'yellow');
  
  log(`\n🌍 Regional Breakdown:`, 'cyan');
  for (const [region, stats] of Object.entries(regionStats)) {
    if (stats.towers > 0) {
      log(`   ${region.toUpperCase()}: ${stats.towers.toLocaleString()} towers (${stats.states} states)`, 'blue');
      
      const techBreakdown = Object.entries(stats.techCounts)
        .map(([tech, count]) => `${tech}: ${count.toLocaleString()}`)
        .join(', ');
      log(`     └─ ${techBreakdown}`, 'cyan');
    }
  }
  
  return totalTowers;
}

function showHelp() {
  console.log(`
🗺️  Region-Based Tower Loader

Load specific regions or states instead of all 600K+ towers to save memory.

USAGE:
  node scripts/load_region_towers.cjs [options]

OPTIONS:
  --region, -r <region>    Load specific region (west, midwest, south, northeast, territories)
  --state, -s <state>      Load specific state (CA, NY, TX, etc.)
  --tech, -t <tech>        Filter by technology (lte, nr, umts, gsm)
  --help, -h               Show this help

EXAMPLES:
  # Load West Coast only (CA, WA, OR, etc.)
  node scripts/load_region_towers.cjs --region west

  # Load California and New York
  node scripts/load_region_towers.cjs --state CA --state NY

  # Load 5G towers in the South
  node scripts/load_region_towers.cjs --region south --tech nr

  # Load multiple regions
  node scripts/load_region_towers.cjs --region west --region northeast

MEMORY SAVINGS:
  • West region only: ~150K towers (~120MB memory)
  • Single state (CA): ~98K towers (~80MB memory)  
  • 5G only: ~115K towers (~90MB memory)
  • Single state + 5G: ~15K towers (~12MB memory)

AVAILABLE REGIONS:
  • west: 13 states (WA, OR, CA, AZ, etc.)
  • midwest: 12 states (IL, OH, MI, etc.)
  • south: 16 states (TX, FL, GA, etc.)
  • northeast: 9 states (NY, NJ, MA, etc.)
  • territories: 6 territories (PR, VI, GU, etc.)
`);
}

async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    return;
  }

  log('🗺️  Region-Based Tower Loader', 'bright');
  log('=============================', 'bright');
  
  const client = await connectRedis();
  
  try {
    await loadRegionData(client, options);
    
    log('\n✅ Region loading successful!', 'green');
    log('💡 Use "npm run redis:persistent status" to check memory usage', 'cyan');
    
  } catch (error) {
    log(`\n❌ Loading failed: ${error.message}`, 'red');
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
