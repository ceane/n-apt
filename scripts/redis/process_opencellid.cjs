#!/usr/bin/env node

/**
 * OpenCellID Data Processing Script
 * 
 * This script processes OpenCellID CSV files to:
 * 1. Merge all MCC files into a single consolidated file
 * 2. Add standardized headers
 * 3. Assign towers to states based on coordinates
 * 4. Split data into state-specific files
 * 5. Generate processing statistics
 */

const fs = require('fs');
const path = require('path');

// US State bounding boxes for coordinate-to-state assignment
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
  'NC': { minLat: 33.8, maxLat: 36.6, minLon: -84.3, maxLon: -75.5 },
  'ND': { minLat: 45.9, maxLat: 49.0, minLon: -104.1, maxLon: -96.6 },
  'OH': { minLat: 38.4, maxLat: 41.9, minLon: -84.8, maxLon: -80.5 },
  'OK': { minLat: 33.6, maxLat: 37.0, minLon: -103.0, maxLon: -94.4 },
  'OR': { minLat: 42.0, maxLat: 46.3, minLon: -124.6, maxLon: -116.5 },
  'PA': { minLat: 39.7, maxLat: 42.5, minLon: -80.5, maxLon: -74.7 },
  'RI': { minLat: 41.1, maxLat: 42.0, minLon: -71.9, maxLon: -71.1 },
  'SC': { minLat: 32.0, maxLat: 35.2, minLon: -83.4, maxLon: -78.5 },
  'SD': { minLat: 42.5, maxLat: 45.9, minLon: -104.1, maxLon: -96.4 },
  'TN': { minLat: 34.9, maxLat: 36.7, minLon: -90.3, maxLon: -81.6 },
  'TX': { minLat: 25.8, maxLat: 36.5, minLon: -106.6, maxLon: -93.5 },
  'UT': { minLat: 37.0, maxLat: 42.0, minLon: -114.1, maxLon: -109.0 },
  'VT': { minLat: 42.7, maxLat: 45.0, minLon: -73.4, maxLon: -71.5 },
  'VA': { minLat: 36.5, maxLat: 39.5, minLon: -83.7, maxLon: -75.2 },
  'WA': { minLat: 45.5, maxLat: 49.0, minLon: -124.8, maxLon: -116.9 },
  'WV': { minLat: 37.2, maxLat: 40.6, minLon: -82.6, maxLon: -77.7 },
  'WI': { minLat: 42.5, maxLat: 47.1, minLon: -92.9, maxLon: -86.8 },
  'WY': { minLat: 40.7, maxLat: 45.0, minLon: -111.1, maxLon: -104.1 },
  // Territories
  'PR': { minLat: 17.9, maxLat: 18.5, minLon: -67.9, maxLon: -65.5 },
  'VI': { minLat: 17.7, maxLat: 18.4, minLon: -65.1, maxLon: -64.6 },
  'GU': { minLat: 13.2, maxLat: 13.8, minLon: 144.6, maxLon: 145.0 },
  'MP': { minLat: 14.1, maxLat: 20.0, minLon: 145.0, maxLon: 146.0 },
  'AS': { minLat: -14.4, maxLat: -11.0, minLon: -171.4, maxLon: -168.4 },
  'DC': { minLat: 38.8, maxLat: 39.0, minLon: -77.1, maxLon: -76.9 }
};

// CSV Headers
const CSV_HEADERS = 'radio,mcc,mnc,lac,cell,range,lon,lat,samples,change,created,updated,averageSignal';

/**
 * Assign state based on coordinates
 */
function assignState(lat, lon) {
  for (const [state, bounds] of Object.entries(STATE_BOUNDARIES)) {
    if (lat >= bounds.minLat && lat <= bounds.maxLat &&
        lon >= bounds.minLon && lon <= bounds.maxLon) {
      return state;
    }
  }
  return 'UNKNOWN';
}

/**
 * Parse and validate a CSV record
 */
function parseRecord(line) {
  const fields = line.trim().split(',');
  if (fields.length !== 14) return null;
  
  const lat = parseFloat(fields[7]);
  const lon = parseFloat(fields[6]);
  
  // Validate coordinates
  if (isNaN(lat) || isNaN(lon) || 
      lat < -90 || lat > 90 || 
      lon < -180 || lon > 180) {
    return null;
  }
  
  return {
    radio: fields[0],
    mcc: fields[1],
    mnc: fields[2],
    lac: fields[3],
    cell: fields[4],
    range: fields[5],
    lon: lon,
    lat: lat,
    samples: fields[8],
    change: fields[9],
    created: fields[10],
    updated: fields[11],
    averageSignal: fields[12],
    state: assignState(lat, lon)
  };
}

/**
 * Process OpenCellID data
 */
async function processOpenCellID() {
  console.log('🚀 Starting OpenCellID data processing...');
  
  const inputDir = 'data/opencellid';
  const outputDir = 'data/opencellid';
  const statesDir = path.join(outputDir, 'states');
  const originalDir = path.join(outputDir, 'original');
  
  // Create directories
  if (!fs.existsSync(statesDir)) fs.mkdirSync(statesDir, { recursive: true });
  if (!fs.existsSync(originalDir)) fs.mkdirSync(originalDir, { recursive: true });
  
  // Initialize statistics
  const stats = {
    totalProcessed: 0,
    validRecords: 0,
    invalidRecords: 0,
    stateDistribution: {},
    technologyDistribution: {},
    rangeDistribution: { '-1': 0, '0': 0, 'positive': 0 },
    processingTime: Date.now()
  };
  
  // Initialize state file streams
  const stateStreams = {};
  for (const state of Object.keys(STATE_BOUNDARIES)) {
    stateStreams[state] = fs.createWriteStream(path.join(statesDir, `${state}.csv`));
    stateStreams[state].write(CSV_HEADERS + '\n');
  }
  stateStreams['UNKNOWN'] = fs.createWriteStream(path.join(statesDir, 'UNKNOWN.csv'));
  stateStreams['UNKNOWN'].write(CSV_HEADERS + '\n');
  
  // Process all MCC files
  const mccFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.csv') && f.match(/^\d+\.csv$/));
  
  console.log(`📁 Found ${mccFiles.length} MCC files to process`);
  
  for (const mccFile of mccFiles) {
    console.log(`📊 Processing ${mccFile}...`);
    
    // Backup original file
    const originalPath = path.join(inputDir, mccFile);
    const backupPath = path.join(originalDir, mccFile);
    fs.copyFileSync(originalPath, backupPath);
    
    const content = fs.readFileSync(originalPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      stats.totalProcessed++;
      
      const record = parseRecord(line);
      if (!record) {
        stats.invalidRecords++;
        continue;
      }
      
      stats.validRecords++;
      
      // Update statistics
      stats.stateDistribution[record.state] = (stats.stateDistribution[record.state] || 0) + 1;
      stats.technologyDistribution[record.radio] = (stats.technologyDistribution[record.radio] || 0) + 1;
      
      if (record.range === '-1') {
        stats.rangeDistribution['-1']++;
      } else if (record.range === '0') {
        stats.rangeDistribution['0']++;
      } else {
        stats.rangeDistribution['positive']++;
      }
      
      // Write to state-specific file
      const stateStream = stateStreams[record.state] || stateStreams['UNKNOWN'];
      stateStream.write(line + '\n');
    }
  }
  
  // Close all state streams
  for (const stream of Object.values(stateStreams)) {
    stream.end();
  }
  
  // Create merged file by concatenating all original files
  console.log('🔄 Creating merged file...');
  const mergedStream = fs.createWriteStream(path.join(outputDir, 'cell_towers_whole.csv'));
  mergedStream.write(CSV_HEADERS + '\n');
  
  // Process each original file and add to merged file
  for (const mccFile of mccFiles) {
    const originalPath = path.join(inputDir, mccFile);
    const content = fs.readFileSync(originalPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const record = parseRecord(line);
      if (record) {
        mergedStream.write(line + '\n');
      }
    }
  }
  mergedStream.end();
  
  // Finalize statistics
  stats.processingTime = Date.now() - stats.processingTime;
  
  // Save processing statistics
  const statsPath = path.join(outputDir, 'processing_stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  
  // Display results
  console.log('\n✅ Processing complete!');
  console.log(`📊 Total processed: ${stats.totalProcessed.toLocaleString()}`);
  console.log(`✅ Valid records: ${stats.validRecords.toLocaleString()}`);
  console.log(`❌ Invalid records: ${stats.invalidRecords.toLocaleString()}`);
  console.log(`⏱️  Processing time: ${(stats.processingTime / 1000).toFixed(2)}s`);
  
  console.log('\n🗺️  State distribution (top 10):');
  const sortedStates = Object.entries(stats.stateDistribution)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);
  
  for (const [state, count] of sortedStates) {
    console.log(`   ${state}: ${count.toLocaleString()}`);
  }
  
  console.log('\n📱 Technology distribution:');
  for (const [tech, count] of Object.entries(stats.technologyDistribution)) {
    console.log(`   ${tech}: ${count.toLocaleString()}`);
  }
  
  console.log('\n🎯 Range accuracy distribution:');
  console.log(`   Unknown (-1): ${stats.rangeDistribution['-1'].toLocaleString()}`);
  console.log(`   Exact (0): ${stats.rangeDistribution['0'].toLocaleString()}`);
  console.log(`   Measured: ${stats.rangeDistribution['positive'].toLocaleString()}`);
  
  console.log(`\n📁 Files created:`);
  console.log(`   ${path.join(outputDir, 'cell_towers_whole.csv')} - Merged dataset`);
  console.log(`   ${statesDir}/ - State-specific files`);
  console.log(`   ${statsPath} - Processing statistics`);
}

// Run the processor
if (require.main === module) {
  processOpenCellID().catch(console.error);
}

module.exports = { processOpenCellID, assignState, parseRecord };
