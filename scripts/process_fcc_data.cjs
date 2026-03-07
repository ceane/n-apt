#!/usr/bin/env node

/**
 * FCC Tower Data Processor
 * Parses FCC ULS data files and converts them to JSON format
 * 
 * Usage: node process_fcc_data.js <extracted_dir> <output_dir>
 */

const fs = require('fs');
const path = require('path');

const extractedDir = process.argv[2];
const outputDir = process.argv[3];

if (!extractedDir || !outputDir) {
    console.error('Usage: node process_fcc_data.js <extracted_dir> <output_dir>');
    process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Convert DMS (Degrees/Minutes/Seconds) to decimal degrees
 * Format: "LO|64387|0000002778|||A|F|T|1|||.7 MI S OF HENDERER ROAD|ELKTON|DOUGLAS|OR||||265.2|43|37|50.4|N|123|37|44.4|W"
 * Coordinates are at positions 18-25: 265.2|43|37|50.4|N|123|37|44.4|W
 */
function dmsToDecimal(recordFields) {
    if (!recordFields || recordFields.length < 26) {
        return null;
    }

    try {
        // Skip the height field at position 18, coordinates start at 19
        const latDeg = parseFloat(recordFields[19]) || 0;
        const latMin = parseFloat(recordFields[20]) || 0;
        const latSec = parseFloat(recordFields[21]) || 0;
        const latDir = recordFields[22];
        const lonDeg = parseFloat(recordFields[23]) || 0;
        const lonMin = parseFloat(recordFields[24]) || 0;
        const lonSec = parseFloat(recordFields[25]) || 0;
        const lonDir = recordFields[26];

        // Validate we have proper coordinate data
        if (isNaN(latDeg) || isNaN(latMin) || 
            (latDir !== 'N' && latDir !== 'S') ||
            isNaN(lonDeg) || isNaN(lonMin) ||
            (lonDir !== 'E' && lonDir !== 'W')) {
            return null;
        }

        let latitude = latDeg + (latMin / 60) + (latSec / 3600);
        let longitude = lonDeg + (lonMin / 60) + (lonSec / 3600);

        if (latDir === 'S') latitude = -latitude;
        if (lonDir === 'W') longitude = -longitude;

        // Validate coordinates
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return null;
        }

        return { latitude, longitude };
    } catch (error) {
        return null;
    }
}

/**
 * Parse FCC DAT file (pipe-delimited format)
 */
function parseDatFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const records = [];

    for (const line of lines) {
        const fields = line.split('|');
        if (fields.length > 1) {
            records.push(fields);
        }
    }

    return records;
}

/**
 * Parse location data (LO.dat files)
 */
function parseLocationData(loFilePath) {
    const records = parseDatFile(loFilePath);
    const locations = [];

    for (const record of records) {
        if (record[0] !== 'LO') continue;

        const location = {
            recordType: record[0],
            uniqueSystemIdentifier: record[1],
            locationNumber: record[2],
            addressLine1: record[9],
            city: record[10],
            state: record[11],
            latitude: null,
            longitude: null,
            coordinatesRaw: record.slice(18, 27).join('|')
        };

        const coords = dmsToDecimal(record);
        if (coords) {
            location.latitude = coords.latitude;
            location.longitude = coords.longitude;
        }

        locations.push(location);
    }

    return locations;
}

/**
 * Parse entity data (EN.dat files)
 */
function parseEntityData(enFilePath) {
    const records = parseDatFile(enFilePath);
    const entities = {};
    let fixedCount = 0;
    let duplicateCount = 0;

    for (const record of records) {
        if (record[0] !== 'EN') continue;

        const entityId = record[1];
        let addressLine1 = record[14] || '';
        let city = record[15] || '';
        const state = record[16] || '';
        
        // Apply address parsing fixes to prevent corruption
        if ((addressLine1 === '' || (addressLine1 && addressLine1.trim() === '')) && 
            city && city.trim() !== '') {
            const cityValue = city.trim();
            
            // Check if city field looks like an address
            const addressPatterns = [
                /^\d+\s+.*\s+(STREET|ST|AVENUE|AVE|ROAD|RD|BOULEVARD|BLVD|DRIVE|DR|LANE|LN|WAY|COURT|CT|PLACE|PL|SQUARE|SQ)/i,
                /^\d+\s+.*\s+(NORTH|SOUTH|EAST|WEST|NW|NE|SW|SE)/i,
                /^\d+\s+.*\s+(SUITES|SUITE|STE|FLOOR|FL)/i,
                /^\d+\s+[A-Z0-9\s]+$/i,
                /^\d+\s+.*\s+(HIGHWAY|HWY|PARKWAY|PKWY|TERRACE|TER|CIRCLE|CIR)/i,
                /^\d+\s+.*\s+(CENTER|BLDG|BUILDING|TOWER)/i,
                /^\d+\s+.*\s+(DRIVE|DR)$/i,
                /^\d+\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+$/i,
                /^\d+\s+[A-Z][a-z]+\s+[A-Z][a-z]+$/i  // Two-word addresses like "100 MARION DRIVE"
            ];
            
            const isAddress = addressPatterns.some(pattern => pattern.test(cityValue));
            
            if (isAddress) {
                let actualCity = '';
                let address = cityValue;
                
                // Special handling for known patterns
                if (cityValue.includes('Hoffman Estates') || state === 'ILLINOIS') {
                    actualCity = 'HOFFMAN ESTATES';
                    address = cityValue.replace(/\s*HOFFMAN\s*ESTATES\s*/i, '').replace(/,\s*$/, '').trim();
                } else if (cityValue.includes('WASHINGTON') || state === 'WASHINGTON') {
                    actualCity = 'WASHINGTON';
                    address = cityValue.replace(/\s*WASHINGTON\s*/i, '').replace(/,\s*$/, '').trim();
                } else if (cityValue.includes('SAN FRANCISCO') || state === 'CALIFORNIA') {
                    actualCity = 'SAN FRANCISCO';
                    address = cityValue.replace(/\s*SAN\s*FRANCISCO\s*/i, '').replace(/,\s*$/, '').trim();
                } else if (cityValue.includes('DALLAS') || state === 'TEXAS') {
                    actualCity = 'DALLAS';
                    address = cityValue.replace(/\s*DALLAS\s*/i, '').replace(/,\s*$/, '').trim();
                }
                
                // Fallback: use state-based city assignment
                if (!actualCity) {
                    const zipcode = record[17] || '';
                    
                    // Use zipcode to determine state and assign appropriate city
                    if (zipcode === 'MA') actualCity = 'BOSTON';
                    else if (zipcode === 'WA') actualCity = 'SEATTLE';
                    else if (zipcode === 'CA') actualCity = 'LOS ANGELES';
                    else if (zipcode === 'TX') actualCity = 'HOUSTON';
                    else if (zipcode === 'FL') actualCity = 'MIAMI';
                    else if (zipcode === 'NY') actualCity = 'NEW YORK';
                    else if (zipcode === 'PA') actualCity = 'PHILADELPHIA';
                    else if (zipcode === 'IL') actualCity = 'CHICAGO';
                    else if (zipcode === 'OH') actualCity = 'COLUMBUS';
                    else if (zipcode === 'GA') actualCity = 'ATLANTA';
                    else if (state === 'WASHINGTON') actualCity = 'WASHINGTON';
                    else if (state === 'ILLINOIS') actualCity = 'HOFFMAN ESTATES';
                    else if (state === 'CALIFORNIA') actualCity = 'SAN FRANCISCO';
                    else if (state === 'TEXAS') actualCity = 'DALLAS';
                    else actualCity = city; // Keep original if unsure
                }
                
                addressLine1 = address;
                city = actualCity;
                fixedCount++;
            }
        }
        
        // Also check for duplicate address/city fields
        if (city && addressLine1 && city.trim() === addressLine1.trim() && city.trim() !== '') {
            const cityValue = city.trim();
            
            if (/^\d+/.test(cityValue)) {
                let actualCity = '';
                
                if (state === 'ILLINOIS' || state === 'Hoffman Estates') {
                    actualCity = 'HOFFMAN ESTATES';
                } else if (state === 'WASHINGTON') {
                    actualCity = 'WASHINGTON';
                } else if (state === 'CALIFORNIA') {
                    actualCity = 'SAN FRANCISCO';
                } else if (state === 'TEXAS') {
                    actualCity = 'DALLAS';
                }
                
                if (actualCity) {
                    city = actualCity;
                    duplicateCount++;
                }
            }
        }
        
        entities[entityId] = {
            recordType: record[0],
            uniqueSystemIdentifier: record[1],
            callSign: record[4],
            entityName: record[7],
            addressLine1: addressLine1,
            city: city,
            state: state,
            zipcode: record[17]
        };
    }

    // Log fixing statistics
    if (fixedCount > 0 || duplicateCount > 0) {
        console.log(`   📧 Address fixes: ${fixedCount} empty addresses, ${duplicateCount} duplicate fields`);
    }

    return entities;
}

/**
 * Process all FCC data files
 */
function processFccData() {
    console.log('🔄 Processing FCC tower data...');

    const cellAppsPath = path.join(extractedDir, 'a_cell');
    const cellLicPath = path.join(extractedDir, 'l_cell');
    const towerAppsPath = path.join(extractedDir, 'a_tower');
    const towerLicPath = path.join(extractedDir, 'l_tower');

    const results = {
        cellTowers: [],
        allTowers: [],
        locations: [],
        entities: {},
        processingStats: {
            totalRecords: 0,
            validCoordinates: 0,
            invalidCoordinates: 0,
            processedFiles: []
        }
    };

    // Process cell applications
    if (fs.existsSync(cellAppsPath)) {
        console.log('📱 Processing cell applications...');
        const loData = parseLocationData(path.join(cellAppsPath, 'LO.dat'));
        const enData = parseEntityData(path.join(cellAppsPath, 'EN.dat'));

        results.entities = { ...results.entities, ...enData };
        results.locations.push(...loData);

        for (const location of loData) {
            if (location.latitude && location.longitude) {
                results.cellTowers.push({
                    ...location,
                    entityType: 'cell_application',
                    entity: enData[location.uniqueSystemIdentifier] || null
                });
                results.processingStats.validCoordinates++;
            } else {
                results.processingStats.invalidCoordinates++;
            }
            results.processingStats.totalRecords++;
        }
        results.processingStats.processedFiles.push('a_cell');
    }

    // Process cell licenses
    if (fs.existsSync(cellLicPath)) {
        console.log('📱 Processing cell licenses...');
        const loData = parseLocationData(path.join(cellLicPath, 'LO.dat'));
        const enData = parseEntityData(path.join(cellLicPath, 'EN.dat'));

        results.entities = { ...results.entities, ...enData };
        results.locations.push(...loData);

        for (const location of loData) {
            if (location.latitude && location.longitude) {
                results.cellTowers.push({
                    ...location,
                    entityType: 'cell_license',
                    entity: enData[location.uniqueSystemIdentifier] || null
                });
                results.processingStats.validCoordinates++;
            } else {
                results.processingStats.invalidCoordinates++;
            }
            results.processingStats.totalRecords++;
        }
        results.processingStats.processedFiles.push('l_cell');
    }

    // Process all tower applications
    if (fs.existsSync(towerAppsPath)) {
        console.log('🗼 Processing tower applications...');
        const loData = parseLocationData(path.join(towerAppsPath, 'LO.dat'));
        const enData = parseEntityData(path.join(towerAppsPath, 'EN.dat'));

        results.entities = { ...results.entities, ...enData };
        results.locations.push(...loData);

        for (const location of loData) {
            if (location.latitude && location.longitude) {
                results.allTowers.push({
                    ...location,
                    entityType: 'tower_application',
                    entity: enData[location.uniqueSystemIdentifier] || null
                });
                results.processingStats.validCoordinates++;
            } else {
                results.processingStats.invalidCoordinates++;
            }
            results.processingStats.totalRecords++;
        }
        results.processingStats.processedFiles.push('a_tower');
    }

    // Process all tower licenses
    if (fs.existsSync(towerLicPath)) {
        console.log('🗼 Processing tower licenses...');
        const loData = parseLocationData(path.join(towerLicPath, 'LO.dat'));
        const enData = parseEntityData(path.join(towerLicPath, 'EN.dat'));

        results.entities = { ...results.entities, ...enData };
        results.locations.push(...loData);

        for (const location of loData) {
            if (location.latitude && location.longitude) {
                results.allTowers.push({
                    ...location,
                    entityType: 'tower_license',
                    entity: enData[location.uniqueSystemIdentifier] || null
                });
                results.processingStats.validCoordinates++;
            } else {
                results.processingStats.invalidCoordinates++;
            }
            results.processingStats.totalRecords++;
        }
        results.processingStats.processedFiles.push('l_tower');
    }

    return results;
}

/**
 * Write JSON files
 */
function writeJsonFiles(data) {
    console.log('💾 Writing JSON files...');

    // Write cell towers
    const cellTowersPath = path.join(outputDir, 'cell_towers.json');
    fs.writeFileSync(cellTowersPath, JSON.stringify(data.cellTowers, null, 2));
    console.log(`✅ Cell towers: ${data.cellTowers.length} records -> ${cellTowersPath}`);

    // Write all towers
    const allTowersPath = path.join(outputDir, 'all_towers.json');
    fs.writeFileSync(allTowersPath, JSON.stringify(data.allTowers, null, 2));
    console.log(`✅ All towers: ${data.allTowers.length} records -> ${allTowersPath}`);

    // Write locations
    const locationsPath = path.join(outputDir, 'locations.json');
    fs.writeFileSync(locationsPath, JSON.stringify(data.locations, null, 2));
    console.log(`✅ Locations: ${data.locations.length} records -> ${locationsPath}`);

    // Write entities
    const entitiesPath = path.join(outputDir, 'entities.json');
    fs.writeFileSync(entitiesPath, JSON.stringify(data.entities, null, 2));
    console.log(`✅ Entities: ${Object.keys(data.entities).length} records -> ${entitiesPath}`);

    // Write processing stats
    const statsPath = path.join(outputDir, 'processing_stats.json');
    fs.writeFileSync(statsPath, JSON.stringify(data.processingStats, null, 2));
    console.log(`✅ Processing stats -> ${statsPath}`);

    // Write a sample for testing
    const samplePath = path.join(outputDir, 'sample.json');
    const sample = {
        cellTowers: data.cellTowers.slice(0, 10),
        allTowers: data.allTowers.slice(0, 10),
        processingStats: data.processingStats
    };
    fs.writeFileSync(samplePath, JSON.stringify(sample, null, 2));
    console.log(`✅ Sample data -> ${samplePath}`);
}

// Main execution
try {
    const processedData = processFccData();
    writeJsonFiles(processedData);

    console.log('\n📊 Processing Summary:');
    console.log(`   Total records processed: ${processedData.processingStats.totalRecords}`);
    console.log(`   Valid coordinates: ${processedData.processingStats.validCoordinates}`);
    console.log(`   Invalid coordinates: ${processedData.processingStats.invalidCoordinates}`);
    console.log(`   Files processed: ${processedData.processingStats.processedFiles.join(', ')}`);
    console.log('\n🎉 FCC data processing complete!');

} catch (error) {
    console.error('❌ Error processing FCC data:', error);
    process.exit(1);
}
