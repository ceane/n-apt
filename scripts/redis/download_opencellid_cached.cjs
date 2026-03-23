#!/usr/bin/env node

/**
 * OpenCellID API Data Downloader with Caching for N-APT
 * 
 * Downloads US tower data from OpenCellID API with intelligent caching:
 * - Caches responses for 1 week per MCC code
 * - Falls back to local CSV files when API fails
 * - Processes into dual Redis databases (Fast Select + Complete).
 */

const redis = require('redis');
const { parse } = require('csv-parse/sync');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

// Configuration
const OPENCELLID_API_TOKEN = process.env.OPEN_CELL_ID_ACCESS_TOKEN;
if (!OPENCELLID_API_TOKEN) {
  console.error('❌ OPEN_CELL_ID_ACCESS_TOKEN not found in .env.local');
  process.exit(1);
}

// Cache configuration
const CACHE_DIR = path.join(__dirname, '../.cache/opencellid');
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
const LAST_RUN_FILE = path.join(CACHE_DIR, 'last_run.json');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function shouldSkipRun() {
  const forceRun = process.argv.includes('--force') || process.env.OPENCELLID_FORCE_REFRESH === '1';
  if (forceRun) {
    console.log('⚠️  Force flag detected; ignoring OpenCellID weekly run guard.');
    return false;
  }

  try {
    const raw = fs.readFileSync(LAST_RUN_FILE, 'utf8');
    const { lastRun } = JSON.parse(raw);
    const lastRunTime = new Date(lastRun).getTime();

    if (!Number.isFinite(lastRunTime)) {
      return false;
    }

    const elapsed = Date.now() - lastRunTime;
    if (elapsed < CACHE_DURATION) {
      const daysAgo = (elapsed / (24 * 60 * 60 * 1000)).toFixed(1);
      const waitDays = ((CACHE_DURATION - elapsed) / (24 * 60 * 60 * 1000)).toFixed(1);
      console.log(`⏭️  Skipping OpenCellID import; last successful run was ${daysAgo} days ago. (${waitDays} days until next allowed run. Use --force to override.)`);
      return true;
    }
  } catch {
    // Missing or malformed file – treat as first run
  }

  return false;
}

function recordRunTimestamp() {
  const payload = { lastRun: new Date().toISOString() };
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(payload, null, 2));
}

// Region definitions
const REGIONS = {
  'bay_area': {
    name: 'Bay Area, CA',
    bounds: {
      north: 38.5,   // Santa Rosa area
      south: 37.0,   // Campbell area
      east: -121.5,   // Antioch area (corrected: negative for Western hemisphere)
      west: -123.0   // Coast
    },
    description: 'San Francisco Bay Area including SF, Oakland, San Jose'
  },
  
  'miami': {
    name: 'Miami, FL',
    bounds: {
      north: 26.2,   // North Miami Beach
      south: 25.7,   // South Miami
      east: -80.1,   // Miami Beach
      west: -80.4    // Hialeah
    },
    description: 'Miami metropolitan area including Miami Beach and Hialeah'
  }
};

// US MCC codes (Mobile Country Codes)
const US_MCC_CODES = [310, 311, 312, 313, 314, 316, 330, 334];

// Redis clients for different databases
let fastRedisClient;
let completeRedisClient;

// Statistics
const stats = {
  downloadedBytes: 0,
  totalProcessed: 0,
  fastSelectCount: 0,
  completeCount: 0,
  startTime: Date.now(),
  regions: {},
  apiCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  apiFailures: 0,
  localFallbacks: 0
};

// Initialize Redis connections
async function initRedis() {
  console.log('🔄 Initializing Redis connections...');
  
  // Use temporary databases first (db0, db1), then swap to permanent (db2, db3)
  fastRedisClient = redis.createClient({
    socket: { host: '127.0.0.1', port: 6379 },
    database: 0  // Temporary Fast Select DB
  });
  
  completeRedisClient = redis.createClient({
    socket: { host: '127.0.0.1', port: 6379 },
    database: 1  // Temporary Complete DB
  });
  
  await fastRedisClient.connect();
  await completeRedisClient.connect();
  
  console.log('✅ Redis connections established (temporary: db0, db1)');
}

// Get cache file path for MCC
function getCacheFilePath(mcc) {
  return path.join(CACHE_DIR, `mcc_${mcc}.csv`);
}

// Check if cached data is valid (not expired)
function isCacheValid(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const fileStats = fs.statSync(filePath);
    const now = Date.now();
    const fileAge = now - fileStats.mtime.getTime();
    
    return fileAge < CACHE_DURATION;
  } catch {
    return false;
  }
}

// Load data from cache
function loadFromCache(mcc) {
  const cacheFile = getCacheFilePath(mcc);
  
  if (isCacheValid(cacheFile)) {
    console.log(`📋 Using cached data for MCC ${mcc}`);
    stats.cacheHits++;
    return fs.readFileSync(cacheFile, 'utf8');
  }
  
  stats.cacheMisses++;
  return null;
}

// Save data to cache
function saveToCache(mcc, data) {
  const cacheFile = getCacheFilePath(mcc);
  
  try {
    fs.writeFileSync(cacheFile, data, 'utf8');
    console.log(`💾 Cached data for MCC ${mcc}`);
  } catch (error) {
    console.warn(`⚠️  Failed to cache data for MCC ${mcc}: ${error.message}`);
  }
}

// Download data from OpenCellID API with caching
async function downloadFromOpenCellID(mcc, page = 1, pageSize = 10000) {
  // Try cache first
  const cachedData = loadFromCache(mcc);
  if (cachedData) {
    return cachedData;
  }
  
  return new Promise((resolve, reject) => {
    const url = `https://api.opencellid.org/cell/download?mcc=${mcc}&format=csv&page=${page}&pageSize=${pageSize}`;
    
    console.log(`📥 Downloading MCC ${mcc}, page ${page}...`);
    
    const options = {
      headers: {
        'Authorization': `Bearer ${OPENCELLID_API_TOKEN}`,
        'User-Agent': 'N-APT Tower Data Processor'
      }
    };

    const request = https.get(url, options, (response) => {
      if (response.statusCode !== 200) {
        stats.apiFailures++;
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(chunk);
        stats.downloadedBytes += chunk.length;
      });

      response.on('end', () => {
        const csvData = Buffer.concat(chunks).toString();
        stats.apiCalls++;
        
        // Cache the successful response
        if (csvData.trim().length > 0) {
          saveToCache(mcc, csvData);
        }
        
        resolve(csvData);
      });
    });

    request.on('error', (error) => {
      stats.apiFailures++;
      reject(error);
    });

    request.setTimeout(10000, () => {
      stats.apiFailures++;
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

const LOCAL_CSV_DIR = process.env.LOCAL_OPENCELLID_CSV_DIR || path.join(__dirname, '../data/opencellid');

// Fallback to local CSV files
async function loadFromLocalCSV(mcc) {
  const csvPath = path.join(LOCAL_CSV_DIR, `${mcc}.csv`);
  
  try {
    if (fs.existsSync(csvPath)) {
      console.log(`📁 Using local CSV file for MCC ${mcc}: ${csvPath}`);
      stats.localFallbacks++;
      const csvData = fs.readFileSync(csvPath, 'utf8');
      return csvData;
    } else {
      throw new Error(`CSV file not found: ${csvPath}`);
    }
  } catch (error) {
    throw new Error(`Failed to load local CSV for MCC ${mcc}: ${error.message}`);
  }
}

// Check if point is within region bounds
function isInRegion(lat, lon, region) {
  const { bounds } = region;
  return lat >= bounds.south && lat <= bounds.north &&
         lon >= bounds.west && lon <= bounds.east;
}

// Determine which regions a tower belongs to
function getRegionsForTower(lat, lon) {
  const regions = [];
  for (const [regionKey, region] of Object.entries(REGIONS)) {
    if (isInRegion(lat, lon, region)) {
      regions.push(regionKey);
    }
  }
  return regions;
}

// Process CSV data from OpenCellID API
async function processCSVData(csvData, mcc) {
  console.log(`📊 Processing MCC ${mcc} data...`);
  
  const records = parse(csvData, {
    columns: false,
    skip_empty_lines: true,
    cast: true
  });
  
  let mccProcessed = 0;
  let mccFastSelect = 0;
  let mccComplete = 0;
  
  // Process in batches to manage memory
  const batchSize = 1000;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    
    const fastSelectPipeline = fastRedisClient.multi();
    const completePipeline = completeRedisClient.multi();
    
    for (const record of batch) {
      if (record.length < 9) continue; // Skip malformed records
      
      // OpenCellID CSV format: [type,mcc,mnc,lac,cellid,range,lon,lat,samples,changeable,created,updated,averageSignal]
      const [type, mcc_val, mnc, lac, cellId, range, lon, lat, samples] = record;
      
      // Validate coordinates
      if (!lat || !lon || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        continue;
      }
      
      // Filter for US towers only (additional validation)
      if (lon < -125 || lon > -65 || lat < 25 || lat > 49) {
        continue; // Outside continental US bounds
      }
      
      const towerData = {
        type,
        mcc: mcc_val,
        mnc,
        lac,
        cellId,
        range: parseFloat(range) || 0,
        lon: parseFloat(lon),
        lat: parseFloat(lat),
        samples: parseInt(samples) || 0,
        created: record[10] || null,
        updated: record[11] || null,
        averageSignal: record[12] || null
      };
      
      // Create Redis key
      const towerKey = `tower:${mcc_val}:${mnc}:${lac}:${cellId}`;
      const towerJson = JSON.stringify(towerData);
      
      // Determine regions
      const regions = getRegionsForTower(towerData.lat, towerData.lon);
      
      // Add to complete DB (all towers)
      completePipeline.set(towerKey, towerJson);
      mccComplete++;
      
      // Add to fast select DB if in any region
      if (regions.length > 0) {
        fastSelectPipeline.set(towerKey, towerJson);
        
        // Also add region-specific indexes for fast queries
        for (const regionKey of regions) {
          const regionTowerKey = `region:${regionKey}:${towerKey}`;
          fastSelectPipeline.set(regionTowerKey, towerJson);
          
          // Initialize region stats
          if (!stats.regions[regionKey]) {
            stats.regions[regionKey] = 0;
          }
          stats.regions[regionKey]++;
        }
        
        mccFastSelect++;
      }
      
      mccProcessed++;
    }
    
    // Execute pipelines
    await fastSelectPipeline.exec();
    await completePipeline.exec();
    
    // Progress update
    if (i % 10000 === 0) {
      console.log(`   Processed ${mccProcessed.toLocaleString()} records for MCC ${mcc}...`);
    }
  }
  
  stats.totalProcessed += mccProcessed;
  stats.fastSelectCount += mccFastSelect;
  stats.completeCount += mccComplete;
  
  console.log(`✅ MCC ${mcc}: ${mccProcessed.toLocaleString()} processed, ${mccFastSelect.toLocaleString()} fast select, ${mccComplete.toLocaleString()} complete`);
  
  return mccProcessed;
}

// Download and process all US MCC codes with intelligent fallback
async function downloadAndProcessAll() {
  console.log('🌍 Downloading US tower data from OpenCellID with caching...');
  console.log(`📋 MCC codes: ${US_MCC_CODES.join(', ')}`);
  console.log(`💾 Cache duration: ${CACHE_DURATION / (24 * 60 * 60 * 1000)} days`);
  console.log(`📁 Cache directory: ${CACHE_DIR}`);
  
  for (const mcc of US_MCC_CODES) {
    try {
      let csvData;
      let dataSource = '';
      
      // Try API first (with automatic cache check)
      try {
        csvData = await downloadFromOpenCellID(mcc, 1, 100);
        dataSource = 'API (cached or fresh)';
      } catch (apiError) {
        console.log(`⚠️  API failed for MCC ${mcc}: ${apiError.message}`);
        
        // Fallback to local CSV files
        try {
          csvData = await loadFromLocalCSV(mcc);
          dataSource = 'Local CSV file';
          console.log(`✅ Loaded from local CSV for MCC ${mcc}`);
        } catch (csvError) {
          console.log(`❌ Both API and local CSV failed for MCC ${mcc}`);
          console.log(`   API error: ${apiError.message}`);
          console.log(`   CSV error: ${csvError.message}`);
          continue; // Skip to next MCC
        }
      }
      
      if (csvData.trim().length === 0) {
        console.log(`⚠️  No data available for MCC ${mcc} from ${dataSource}`);
        continue;
      }
      
      console.log(`📊 Processing MCC ${mcc} data from ${dataSource}...`);
      
      // Process the data
      await processCSVData(csvData, mcc);
      
    } catch (error) {
      console.error(`❌ Error processing MCC ${mcc}:`, error.message);
      continue;
    }
  }
}

// Clear existing data from temporary databases
async function clearDatabases() {
  console.log('🗑️  Clearing existing tower data from temporary databases...');
  
  await fastRedisClient.flushDb();
  await completeRedisClient.flushDb();
  
  console.log('✅ Temporary databases cleared (db0, db1)');
}

// Create region indexes for fast queries
async function createRegionIndexes() {
  console.log('📊 Creating region indexes...');
  
  for (const [regionKey, region] of Object.entries(REGIONS)) {
    // Create region metadata
    const regionMeta = {
      name: region.name,
      bounds: region.bounds,
      description: region.description,
      towerCount: stats.regions[regionKey] || 0
    };
    
    await fastRedisClient.set(`region:${regionKey}:meta`, JSON.stringify(regionMeta));
    
    // Create geospatial index for the region
    await fastRedisClient.set(`region:${regionKey}:indexed`, 'true');
  }
  
  console.log('✅ Region indexes created');
}

// Generate final statistics
function generateStats() {
  const endTime = Date.now();
  const duration = (endTime - stats.startTime) / 1000;
  
  console.log('\n📊 OPENCELLID DOWNLOAD & PROCESSING COMPLETE');
  console.log('='.repeat(60));
  console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
  console.log(`📥 Downloaded: ${(stats.downloadedBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`🔌 API Calls: ${stats.apiCalls}`);
  console.log(`💾 Cache Hits: ${stats.cacheHits}`);
  console.log(`💾 Cache Misses: ${stats.cacheMisses}`);
  console.log(`❌ API Failures: ${stats.apiFailures}`);
  console.log(`📁 Local Fallbacks: ${stats.localFallbacks}`);
  console.log(`📁 Total Records: ${stats.totalProcessed.toLocaleString()}`);
  console.log(`🚀 Fast Select DB: ${stats.fastSelectCount.toLocaleString()} towers`);
  console.log(`🌍 Complete DB: ${stats.completeCount.toLocaleString()} towers`);
  console.log(`💾 RAM Efficiency: ${((1 - stats.fastSelectCount / stats.completeCount) * 100).toFixed(1)}% reduction in fast DB`);
  
  console.log('\n🎯 REGION BREAKDOWN:');
  for (const [regionKey, region] of Object.entries(REGIONS)) {
    const count = stats.regions[regionKey] || 0;
    console.log(`   ${region.name}: ${count.toLocaleString()} towers`);
  }
  
  console.log('\n🔧 USAGE:');
  console.log('   Fast Select DB: Use for metropolitan area queries');
  console.log('   Complete DB: Use for nationwide/global queries');
  console.log('   Region queries: region:bay_area:tower:*');
  console.log(`   Cache directory: ${CACHE_DIR}`);
  
  // Cache efficiency
  if (stats.cacheHits + stats.cacheMisses > 0) {
    const cacheEfficiency = (stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100).toFixed(1);
    console.log(`   Cache efficiency: ${cacheEfficiency}%`);
  }
}

// Main processing function
async function main() {
  try {
    console.log('🚀 OpenCellID API Data Processor with Caching for N-APT');
    console.log('='.repeat(50));
    console.log(`🔑 Using API token: ${OPENCELLID_API_TOKEN.substring(0, 10)}...`);
    
    if (shouldSkipRun()) {
      await initRedis();
      try {
        const fastCount = await fastRedisClient.dbSize();
        const completeCount = await completeRedisClient.dbSize();
        console.log(`TOWER_COUNT=${fastCount + completeCount}`);
      } finally {
        await fastRedisClient.quit();
        await completeRedisClient.quit();
      }
      return;
    }
    
    // Initialize Redis
    await initRedis();
    
    // Clear existing data
    await clearDatabases();
    
    // Download and process all US data with intelligent fallback
    await downloadAndProcessAll();
    
    // Create region indexes
    await createRegionIndexes();
    
    // Generate statistics
    generateStats();
    recordRunTimestamp();
    
    // Close connections
    await fastRedisClient.quit();
    await completeRedisClient.quit();
    
    console.log('\n✅ OpenCellID data processing complete! Ready to move to permanent databases.');
    
  } catch (error) {
    console.error('❌ Error during processing:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main, REGIONS, US_MCC_CODES, CACHE_DIR, CACHE_DURATION };
