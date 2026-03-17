#!/usr/bin/env node

/**
 * Node.js script to clean and validate FCC entities data
 * Usage: node scripts/cleanEntities.js [inputFile] [outputFile]
 */

const fs = require('fs').promises;

// Import the validation logic (adapted for Node.js)
class EntityValidator {
  constructor() {
    this.stats = {
      totalProcessed: 0,
      validRecords: 0,
      cleanedRecords: 0,
      discardedRecords: 0,
      duplicatesRemoved: 0,
      issuesFixed: []
    };
    this.seenRecords = new Set();
    
    // US States and territories mapping
    this.US_STATES = new Map([
      ['AL', 'ALABAMA'], ['AK', 'ALASKA'], ['AZ', 'ARIZONA'], ['AR', 'ARKANSAS'],
      ['CA', 'CALIFORNIA'], ['CO', 'COLORADO'], ['CT', 'CONNECTICUT'], ['DE', 'DELAWARE'],
      ['FL', 'FLORIDA'], ['GA', 'GEORGIA'], ['HI', 'HAWAII'], ['ID', 'IDAHO'],
      ['IL', 'ILLINOIS'], ['IN', 'INDIANA'], ['IA', 'IOWA'], ['KS', 'KANSAS'],
      ['KY', 'KENTUCKY'], ['LA', 'LOUISIANA'], ['ME', 'MAINE'], ['MD', 'MARYLAND'],
      ['MA', 'MASSACHUSETTS'], ['MI', 'MICHIGAN'], ['MN', 'MINNESOTA'], ['MS', 'MISSISSIPPI'],
      ['MO', 'MISSOURI'], ['MT', 'MONTANA'], ['NE', 'NEBRASKA'], ['NV', 'NEVADA'],
      ['NH', 'NEW HAMPSHIRE'], ['NJ', 'NEW JERSEY'], ['NM', 'NEW MEXICO'], ['NY', 'NEW YORK'],
      ['NC', 'NORTH CAROLINA'], ['ND', 'NORTH DAKOTA'], ['OH', 'OHIO'], ['OK', 'OKLAHOMA'],
      ['OR', 'OREGON'], ['PA', 'PENNSYLVANIA'], ['RI', 'RHODE ISLAND'], ['SC', 'SOUTH CAROLINA'],
      ['SD', 'SOUTH DAKOTA'], ['TN', 'TENNESSEE'], ['TX', 'TEXAS'], ['UT', 'UTAH'],
      ['VT', 'VERMONT'], ['VA', 'VIRGINIA'], ['WA', 'WASHINGTON'], ['WV', 'WEST VIRGINIA'],
      ['WI', 'WISCONSIN'], ['WY', 'WYOMING'], ['DC', 'DISTRICT OF COLUMBIA'],
      ['PR', 'PUERTO RICO'], ['VI', 'VIRGIN ISLANDS'], ['GU', 'GUAM'], ['AS', 'AMERICAN SAMOA']
    ]);

    // Major US cities database for validation
    this.MAJOR_CITIES = new Set([
      'NEW YORK', 'LOS ANGELES', 'CHICAGO', 'HOUSTON', 'PHOENIX', 'PHILADELPHIA',
      'SAN ANTONIO', 'SAN DIEGO', 'DALLAS', 'SAN JOSE', 'AUSTIN', 'JACKSONVILLE',
      'FORT WORTH', 'COLUMBUS', 'CHARLOTTE', 'SAN FRANCISCO', 'INDIANAPOLIS',
      'SEATTLE', 'DENVER', 'WASHINGTON', 'BOSTON', 'EL PASO', 'DETROIT',
      'NASHVILLE', 'PORTLAND', 'MEMPHIS', 'OKLAHOMA CITY', 'LAS VEGAS', 'BALTIMORE',
      'MIAMI', 'ALBUQUERQUE', 'TUCSON', 'FRESNO', 'SACRAMENTO', 'KANSAS CITY',
      'LONG BEACH', 'MESA', 'ATLANTA', 'OMAHA', 'COLORADO SPRINGS', 'RALEIGH',
      'MIAMI', 'TAMPA', 'ORLANDO', 'FT. MYERS', 'JACKSONVILLE', 'GAINESVILLE',
      'TALLAHASSEE', 'PENSACOLA', 'SARASOTA', 'NAPLES', 'CLEARWATER', 'BRADENTON'
    ]);
  }

  validateAndClean(record) {
    this.stats.totalProcessed++;
    const issues = [];
    let severity = 'info';
    const cleanedRecord = { ...record };

    // Check for exact duplicates using unique identifier
    const recordKey = `${record.entityName}|${record.addressLine1}|${record.city}|${record.state}`;
    if (this.seenRecords.has(recordKey)) {
      this.stats.duplicatesRemoved++;
      return {
        isValid: false,
        issues: ['Duplicate record'],
        severity: 'error'
      };
    }
    this.seenRecords.add(recordKey);

    // Validate and clean city
    const cityResult = this.validateCity(record.city, record.state);
    if (!cityResult.isValid) {
      issues.push(...cityResult.issues);
      severity = 'error';
      cleanedRecord.city = cityResult.cleanedValue || record.city;
    } else if (cityResult.issues.length > 0) {
      issues.push(...cityResult.issues);
      severity = 'warning';
      cleanedRecord.city = cityResult.cleanedValue || record.city;
    }

    // Validate and clean state
    const stateResult = this.validateState(record.state, record.city);
    if (!stateResult.isValid) {
      issues.push(...stateResult.issues);
      severity = 'error';
      cleanedRecord.state = stateResult.cleanedValue || record.state;
    } else if (stateResult.issues.length > 0) {
      issues.push(...stateResult.issues);
      if (severity !== 'error') severity = 'warning';
      cleanedRecord.state = stateResult.cleanedValue || record.state;
    }

    // Validate and clean zipcode
    const zipResult = this.validateZipcode(record.zipcode);
    if (!zipResult.isValid) {
      issues.push(...zipResult.issues);
      severity = 'error';
      cleanedRecord.zipcode = zipResult.cleanedValue || '';
    } else if (zipResult.issues.length > 0) {
      issues.push(...zipResult.issues);
      if (severity !== 'error') severity = 'warning';
      cleanedRecord.zipcode = zipResult.cleanedValue || record.zipcode;
    }

    // Check for city-state mismatches
    const mismatchResult = this.checkCityStateMismatch(cleanedRecord.city, cleanedRecord.state);
    if (mismatchResult.hasMismatch) {
      issues.push(mismatchResult.errorMessage);
      severity = 'error';
      // Try to correct the mismatch
      if (mismatchResult.correctedState) {
        cleanedRecord.state = mismatchResult.correctedState;
        issues.push(`Auto-corrected state to: ${mismatchResult.correctedState}`);
        severity = 'warning';
      }
    }

    const isValid = severity !== 'error';
    
    if (isValid) {
      if (issues.length > 0) {
        this.stats.cleanedRecords++;
      } else {
        this.stats.validRecords++;
      }
    } else {
      this.stats.discardedRecords++;
    }

    // Track issues fixed
    issues.forEach(issue => {
      if (!this.stats.issuesFixed.includes(issue)) {
        this.stats.issuesFixed.push(issue);
      }
    });

    return {
      isValid,
      cleanedRecord: isValid ? cleanedRecord : undefined,
      issues,
      severity
    };
  }

  validateCity(city, state) {
    const issues = [];
    const cleanedCity = city ? city.trim().toUpperCase() : '';

    if (!cleanedCity) {
      return { isValid: false, issues: ['City is empty'] };
    }

    // Check for obvious non-city values
    if (cleanedCity === 'KINGSTON' && state === 'MA') {
      // Kingston is a neighborhood in Boston, not a city
      return { 
        isValid: false, 
        issues: ['KINGSTON is a neighborhood in Boston, not a city'],
        cleanedValue: 'BOSTON'
      };
    }

    // Check if it's a known major city
    if (!this.MAJOR_CITIES.has(cleanedCity)) {
      // Check if it might be a neighborhood or smaller city
      if (cleanedCity.length < 3) {
        return { isValid: false, issues: ['City name too short'] };
      }
      issues.push('Unrecognized city name - may be a neighborhood or small town');
    }

    return { isValid: true, issues, cleanedValue: cleanedCity };
  }

  validateState(state, _city) {
    const issues = [];
    const cleanedState = state ? state.trim().toUpperCase() : '';

    if (!cleanedState) {
      return { isValid: false, issues: ['State is empty'] };
    }

    // Check if it's a valid 2-letter state code
    if (cleanedState.length === 2) {
      if (!this.US_STATES.has(cleanedState)) {
        return { isValid: false, issues: [`Invalid state code: ${cleanedState}`] };
      }
      return { isValid: true, issues, cleanedValue: cleanedState };
    }

    // Check if it's a full state name
    const stateCode = Array.from(this.US_STATES.entries()).find(([_, name]) => name === cleanedState)?.[0];
    if (stateCode) {
      return { 
        isValid: true, 
        issues: [`Converted state name to code: ${cleanedState} -> ${stateCode}`],
        cleanedValue: stateCode
      };
    }

    return { isValid: false, issues: [`Invalid state: ${cleanedState}`] };
  }

  validateZipcode(zipcode) {
    const issues = [];
    const cleanedZip = zipcode ? zipcode.trim() : '';

    if (!cleanedZip) {
      return { isValid: true, issues: ['Zipcode is empty'], cleanedValue: '' };
    }

    // Remove any non-digit characters
    const digitsOnly = cleanedZip.replace(/\D/g, '');

    // Check if it's a valid 5-digit or 9-digit zip
    if (digitsOnly.length === 5) {
      return { isValid: true, issues, cleanedValue: digitsOnly };
    } else if (digitsOnly.length === 9) {
      // Format as 5-4
      const formatted = `${digitsOnly.substring(0, 5)}-${digitsOnly.substring(5)}`;
      return { 
        isValid: true, 
        issues: [`Formatted 9-digit zip: ${digitsOnly} -> ${formatted}`],
        cleanedValue: formatted
      };
    } else {
      return { 
        isValid: false, 
        issues: [`Invalid zipcode format: ${cleanedZip} (must be 5-9 digits)`],
        cleanedValue: ''
      };
    }
  }

  checkCityStateMismatch(city, state) {
    const cityUpper = city.toUpperCase();
    const stateUpper = state.toUpperCase();

    // Check for specific known mismatches
    if (cityUpper === 'BOSTON' && stateUpper === 'KINGSTON') {
      return {
        hasMismatch: true,
        errorMessage: 'Boston should be in Massachusetts (MA), not Kingston',
        correctedState: 'MA'
      };
    }

    if (cityUpper === 'MIAMI' && stateUpper === 'FT. MYERS') {
      return {
        hasMismatch: true,
        errorMessage: 'Miami should be in Florida (FL), not Ft. Myers',
        correctedState: 'FL'
      };
    }

    // Additional city-state validations
    const cityStateMap = {
      'BOSTON': ['MA'],
      'MIAMI': ['FL'],
      'FT. MYERS': ['FL'],
      'TAMPA': ['FL'],
      'ORLANDO': ['FL'],
      'JACKSONVILLE': ['FL'],
      'SEATTLE': ['WA'],
      'PORTLAND': ['OR'],
      'LOS ANGELES': ['CA'],
      'SAN DIEGO': ['CA'],
      'SAN FRANCISCO': ['CA'],
      'CHICAGO': ['IL'],
      'PHILADELPHIA': ['PA'],
      'NEW YORK': ['NY'],
      'DENVER': ['CO'],
      'ATLANTA': ['GA'],
      'DALLAS': ['TX'],
      'HOUSTON': ['TX'],
      'AUSTIN': ['TX'],
      'SAN ANTONIO': ['TX']
    };

    const expectedStates = cityStateMap[cityUpper];
    if (expectedStates && !expectedStates.includes(stateUpper)) {
      return {
        hasMismatch: true,
        errorMessage: `City ${city} is not in ${state}. Expected: ${expectedStates.join(' or ')}`,
        correctedState: expectedStates[0]
      };
    }

    return { hasMismatch: false };
  }

  processBatch(records) {
    const cleanedRecords = {};
    
    Object.entries(records).forEach(([id, record]) => {
      const result = this.validateAndClean(record);
      if (result.isValid && result.cleanedRecord) {
        cleanedRecords[id] = result.cleanedRecord;
      }
    });

    return {
      cleanedRecords,
      stats: this.getStats()
    };
  }

  getStats() {
    return { ...this.stats };
  }
}

async function main() {
  const inputFile = process.argv[2] || 'data/json/entities.json';
  const outputFile = process.argv[3] || 'data/json/entities_cleaned.json';

  console.log(`🧹 Cleaning entities data...`);
  console.log(`Input: ${inputFile}`);
  console.log(`Output: ${outputFile}`);

  try {
    // Read the input file
    const startTime = Date.now();
    const rawData = await fs.readFile(inputFile, 'utf8');
    const entitiesData = JSON.parse(rawData);
    
    console.log(`📊 Loaded ${Object.keys(entitiesData).length} records`);

    // Process the data
    const validator = new EntityValidator();
    const result = validator.processBatch(entitiesData);
    
    // Write cleaned data
    const cleanedJson = JSON.stringify(result.cleanedRecords, null, 2);
    await fs.writeFile(outputFile, cleanedJson, 'utf8');
    
    const endTime = Date.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    // Display statistics
    console.log(`\n✅ Processing completed in ${processingTime}s`);
    console.log(`📈 Statistics:`);
    console.log(`   Total processed: ${result.stats.totalProcessed}`);
    console.log(`   Valid records: ${result.stats.validRecords}`);
    console.log(`   Cleaned records: ${result.stats.cleanedRecords}`);
    console.log(`   Discarded records: ${result.stats.discardedRecords}`);
    console.log(`   Duplicates removed: ${result.stats.duplicatesRemoved}`);
    console.log(`   Final record count: ${Object.keys(result.cleanedRecords).length}`);
    
    if (result.stats.issuesFixed.length > 0) {
      console.log(`\n🔧 Issues fixed:`);
      result.stats.issuesFixed.forEach(issue => {
        console.log(`   • ${issue}`);
      });
    }

    console.log(`\n💾 Cleaned data saved to: ${outputFile}`);
    
    // Update processing stats
    const statsFile = 'data/json/processing_stats.json';
    const existingStats = await fs.readFile(statsFile, 'utf8').catch(() => '{}');
    const stats = JSON.parse(existingStats);
    
    stats.lastCleaned = new Date().toISOString();
    stats.cleaningStats = result.stats;
    
    await fs.writeFile(statsFile, JSON.stringify(stats, null, 2));
    console.log(`📊 Updated processing stats: ${statsFile}`);

  } catch (error) {
    console.error(`❌ Error processing entities file:`, error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { EntityValidator };
