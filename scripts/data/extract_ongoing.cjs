#!/usr/bin/env node

/**
 * Extract towers within specific geographic boundaries
 * 
 * This script extracts cell towers within:
 * 1. Bay Area, CA (Santa Rosa to Antioch to Campbell to Coast)
 * 2. Miami Metro, FL (Miami, Miami Beach, Hialeah)
 */

const fs = require('fs');
const _path = require('path');

// Geographic boundaries
const REGIONS = {
  'bay_area_ca': {
    name: 'Bay Area, CA',
    bounds: {
      north: 38.44,   // Santa Rosa, CA
      south: 37.29,   // Campbell, CA  
      east: -121.81,  // Antioch, CA
      west: -123.0    // Coast of CA
    },
    description: 'San Francisco Bay Area region'
  },
  'miami_fl': {
    name: 'Miami Metro, FL',
    bounds: {
      north: 25.95,   // North Miami area
      south: 25.70,   // South Miami area
      east: -80.10,   // Miami Beach area
      west: -80.30    // Hialeah area
    },
    description: 'Miami metropolitan area including Miami Beach and Hialeah'
  }
};

/**
 * Check if coordinates are within bounds
 */
function isWithinBounds(lat, lon, bounds) {
  return lat >= bounds.south && lat <= bounds.north &&
         lon >= bounds.west && lon <= bounds.east;
}

/**
 * Extract towers for a specific region
 */
function extractRegionData(regionKey, region, sourceFile) {
  console.log(`📍 Extracting ${region.name}...`);
  
  const outputStream = fs.createWriteStream(`data/opencellid/ongoing/${regionKey}.csv`);
  outputStream.write('radio,mcc,mnc,lac,cell,range,lon,lat,samples,change,created,updated,averageSignal\n');
  
  let count = 0;
  const techCount = {};
  
  const content = fs.readFileSync(sourceFile, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const fields = line.split(',');
    
    if (fields.length !== 14) continue;
    
    const lat = parseFloat(fields[7]);
    const lon = parseFloat(fields[6]);
    const radio = fields[0];
    
    if (isNaN(lat) || isNaN(lon)) continue;
    
    if (isWithinBounds(lat, lon, region.bounds)) {
      outputStream.write(line + '\n');
      count++;
      techCount[radio] = (techCount[radio] || 0) + 1;
    }
  }
  
  outputStream.end();
  
  return { count, techCount };
}

/**
 * Main extraction function
 */
function extractOngoingData() {
  console.log('🚀 Starting ongoing data extraction...');
  
  const sourceFile = 'data/opencellid/cell_towers_whole.csv';
  
  if (!fs.existsSync(sourceFile)) {
    console.error('❌ Source file not found:', sourceFile);
    return;
  }
  
  const results = {};
  
  // Extract each region
  for (const [regionKey, region] of Object.entries(REGIONS)) {
    results[regionKey] = extractRegionData(regionKey, region, sourceFile);
  }
  
  // Create summary
  console.log('\n✅ Extraction complete!');
  
  for (const [regionKey, result] of Object.entries(results)) {
    const region = REGIONS[regionKey];
    console.log(`\n📍 ${region.name}:`);
    console.log(`   📊 Towers extracted: ${result.count.toLocaleString()}`);
    console.log(`   📱 Technology breakdown:`);
    
    for (const [tech, count] of Object.entries(result.techCount)) {
      const percentage = ((count / result.count) * 100).toFixed(1);
      console.log(`      ${tech}: ${count.toLocaleString()} (${percentage}%)`);
    }
    
    console.log(`   📁 Saved to: data/opencellid/ongoing/${regionKey}.csv`);
  }
  
  // Create summary statistics
  const stats = {
    extractionDate: new Date().toISOString(),
    regions: {}
  };
  
  for (const [regionKey, result] of Object.entries(results)) {
    const region = REGIONS[regionKey];
    stats.regions[regionKey] = {
      name: region.name,
      description: region.description,
      bounds: region.bounds,
      towerCount: result.count,
      technologyBreakdown: result.techCount
    };
  }
  
  fs.writeFileSync('data/opencellid/ongoing/extraction_stats.json', JSON.stringify(stats, null, 2));
  console.log(`\n📋 Statistics saved to: data/opencellid/ongoing/extraction_stats.json`);
  
  // Total summary
  const totalTowers = Object.values(results).reduce((sum, result) => sum + result.count, 0);
  console.log(`\n🎯 Total towers extracted: ${totalTowers.toLocaleString()}`);
}

// Run the extraction
if (require.main === module) {
  extractOngoingData();
}

module.exports = { extractOngoingData, isWithinBounds };
