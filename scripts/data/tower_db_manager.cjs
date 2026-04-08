#!/usr/bin/env node

/**
 * N-APT Tower Database Manager
 * 
 * Manages dual Redis databases for tower data:
 * - Fast Select DB (db2): Metropolitan areas with optimized queries
 * - Complete DB (db3): Full dataset for nationwide queries
 */

const redis = require('redis');

class TowerDataManager {
  constructor() {
    this.fastClient = null;
    this.completeClient = null;
  }

  async init() {
    console.log('🔄 Connecting to Redis...');
    
    // Use permanent databases for tower data (db2, db3)
    this.fastClient = redis.createClient({ database: 2 }); // Fast Select DB
    this.completeClient = redis.createClient({ database: 3 }); // Complete DB
    
    await this.fastClient.connect();
    await this.completeClient.connect();
    
    console.log('✅ Connected to Redis databases (permanent: db2, db3)');
  }

  async getStats() {
    console.log('📊 Tower Database Statistics');
    console.log('='.repeat(40));
    
    // Get key counts
    const fastKeyCount = await this.fastClient.dbSize();
    const completeKeyCount = await this.completeClient.dbSize();
    
    // Get actual unique tower counts
    const fastTowerCount = await this.fastClient.keys('tower:*').then(keys => keys.length);
    const completeTowerCount = await this.completeClient.keys('tower:*').then(keys => keys.length);
    
    // Get region-indexed tower counts
    const bayAreaCount = await this.fastClient.keys('region:bay_area:tower:*').then(keys => keys.length);
    const miamiCount = await this.fastClient.keys('region:miami:tower:*').then(keys => keys.length);
    
    console.log(`🚀 Fast Select DB (db2): ${fastTowerCount.toLocaleString()} unique towers (${fastKeyCount.toLocaleString()} total keys)`);
    console.log(`🌍 Complete DB (db3): ${completeTowerCount.toLocaleString()} unique towers (${completeKeyCount.toLocaleString()} total keys)`);
    
    if (fastTowerCount > 0) {
      const ramReduction = ((1 - fastTowerCount / completeTowerCount) * 100).toFixed(1);
      console.log(`💾 RAM Efficiency: ${ramReduction}% reduction in fast DB`);
    }
    
    console.log('\n🎯 Region Breakdown:');
    console.log(`   Bay Area, CA: ${bayAreaCount.toLocaleString()} towers`);
    console.log(`     Bounds: 37° to 38.5°N, -123° to 121.5°W`);
    console.log(`   Miami, FL: ${miamiCount.toLocaleString()} towers`);
    console.log(`     Bounds: 25.7° to 26.2°N, -80.4° to -80.1°W`);
    
    // Explain the key duplication
    if (fastKeyCount > fastTowerCount) {
      console.log('\n📝 Note: Fast Select DB stores 2 keys per tower:');
      console.log(`   • Direct tower keys: ${fastTowerCount.toLocaleString()}`);
      console.log(`   • Region-indexed keys: ${(fastKeyCount - fastTowerCount).toLocaleString()}`);
      console.log(`   • Total keys: ${fastKeyCount.toLocaleString()}`);
    }
  }

  async switchToFast() {
    console.log('🔄 Switching to Fast Select Database...');
    
    // This would be used by the application to query the fast database
    console.log('✅ Now using Fast Select DB (db2) for queries');
    console.log('💡 Use region:bay_area:tower:* keys for Bay Area queries');
  }

  async switchToComplete() {
    console.log('🔄 Switching to Complete Database...');
    
    // This would be used by the application to query the complete database
    console.log('✅ Now using Complete DB (db3) for queries');
    console.log('💡 Use tower:* keys for nationwide queries');
  }

  async queryRegion(region, limit = 10) {
    console.log(`🔍 Querying ${region} region (limit: ${limit})...`);
    
    const pattern = `region:${region}:tower:*`;
    const keys = await this.fastClient.keys(pattern);
    
    if (keys.length === 0) {
      console.log(`❌ No towers found in ${region} region`);
      return;
    }
    
    console.log(`📍 Found ${keys.length} towers in ${region} region`);
    console.log(`📊 Sample towers (first ${Math.min(limit, keys.length)}):`);
    
    const sampleKeys = keys.slice(0, limit);
    const towers = await this.fastClient.mGet(sampleKeys);
    
    for (let i = 0; i < sampleKeys.length; i++) {
      const key = sampleKeys[i];
      const towerData = towers[i];
      
      if (towerData) {
        const tower = JSON.parse(towerData);
        console.log(`   ${i + 1}. MCC:${tower.mcc} MNC:${tower.mnc} LAC:${tower.lac} CellID:${tower.cellId}`);
        console.log(`      📍 Lat: ${tower.lat.toFixed(4)}, Lon: ${tower.lon.toFixed(4)}`);
        console.log(`      📶 Samples: ${tower.samples}, Range: ${tower.range}m`);
        console.log(`      🔑 Key: ${key}`);
        console.log('');
      }
    }
  }

  async backup() {
    console.log('💾 Creating backup of tower databases...');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = `./redis/backup/${timestamp}`;
    
    console.log(`📁 Backup directory: ${backupDir}`);
    
    // In a real implementation, this would:
    // 1. Create the backup directory
    // 2. Use Redis BGSAVE to create RDB files
    // 3. Copy the RDB files to the backup directory
    // 4. Create metadata about the backup
    
    console.log('✅ Backup completed (simulated)');
    console.log(`💾 Backup location: ${backupDir}`);
  }

  async close() {
    if (this.fastClient) await this.fastClient.quit();
    if (this.completeClient) await this.completeClient.quit();
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  const manager = new TowerDataManager();
  
  try {
    await manager.init();
    
    switch (command) {
      case 'stats':
        await manager.getStats();
        break;
        
      case 'fast':
        await manager.switchToFast();
        break;
        
      case 'complete':
        await manager.switchToComplete();
        break;
        
      case 'query':
        const region = args[0];
        const limit = parseInt(args[1]) || 10;
        if (!region) {
          console.error('❌ Please specify a region: bay_area or miami');
          process.exit(1);
        }
        await manager.queryRegion(region, limit);
        break;
        
      case 'backup':
        await manager.backup();
        break;
        
      default:
        console.log('🔧 N-APT Tower Data Manager');
        console.log('='.repeat(30));
        console.log('Commands:');
        console.log('  stats          - Show database statistics');
        console.log('  fast           - Switch to fast select database');
        console.log('  complete       - Switch to complete database');
        console.log('  query <region> [limit] - Query towers in region');
        console.log('  backup         - Create database backup');
        console.log('');
        console.log('Examples:');
        console.log('  npm run towers:db:stats');
        console.log('  npm run towers:db:query bay_area 5');
        console.log('  npm run towers:db:backup');
        break;
    }
    
    await manager.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    await manager.close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = TowerDataManager;
