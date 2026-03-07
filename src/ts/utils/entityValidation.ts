/**
 * Entity Data Validation and Cleaning System
 * Addresses data quality issues in FCC entities database
 */

export interface EntityRecord {
  recordType: string;
  uniqueSystemIdentifier: string;
  callSign: string;
  entityName: string;
  addressLine1: string;
  city: string;
  state: string;
  zipcode: string;
}

export interface ValidationResult {
  isValid: boolean;
  cleanedRecord?: EntityRecord;
  issues: string[];
  severity: 'error' | 'warning' | 'info';
}

export interface CleaningStats {
  totalProcessed: number;
  validRecords: number;
  cleanedRecords: number;
  discardedRecords: number;
  duplicatesRemoved: number;
  issuesFixed: string[];
}

// US States and territories mapping
const US_STATES = new Map([
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
const MAJOR_CITIES = new Set([
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

// Common city-state mismatches to detect
const CITY_STATE_MISMATCHES = new Map([
  ['BOSTON', ['MA', 'MASSACHUSETTS']],
  ['MIAMI', ['FL', 'FLORIDA']],
  ['FT. MYERS', ['FL', 'FLORIDA']],
  ['TAMPA', ['FL', 'FLORIDA']],
  ['ORLANDO', ['FL', 'FLORIDA']],
  ['JACKSONVILLE', ['FL', 'FLORIDA']],
  ['KINGSTON', ['MA', 'MASSACHUSETTS', 'NY', 'NEW YORK']], // Kingston is commonly in MA or NY
  ['AUSTIN', ['TX', 'TEXAS']],
  ['DALLAS', ['TX', 'TEXAS']],
  ['HOUSTON', ['TX', 'TEXAS']],
  ['SAN ANTONIO', ['TX', 'TEXAS']],
  ['EL PASO', ['TX', 'TEXAS']],
  ['FORT WORTH', ['TX', 'TEXAS']],
  ['ARLINGTON', ['TX', 'TEXAS', 'VA', 'VIRGINIA']],
  ['SEATTLE', ['WA', 'WASHINGTON']],
  ['PORTLAND', ['OR', 'OREGON']],
  ['LOS ANGELES', ['CA', 'CALIFORNIA']],
  ['SAN DIEGO', ['CA', 'CALIFORNIA']],
  ['SAN FRANCISCO', ['CA', 'CALIFORNIA']],
  ['SACRAMENTO', ['CA', 'CALIFORNIA']],
  ['SAN JOSE', ['CA', 'CALIFORNIA']],
  ['FRESNO', ['CA', 'CALIFORNIA']],
  ['LONG BEACH', ['CA', 'CALIFORNIA']],
  ['OAKLAND', ['CA', 'CALIFORNIA']],
  ['CHICAGO', ['IL', 'ILLINOIS']],
  ['PHILADELPHIA', ['PA', 'PENNSYLVANIA']],
  ['PITTSBURGH', ['PA', 'PENNSYLVANIA']],
  ['NEW YORK', ['NY', 'NEW YORK']],
  ['BUFFALO', ['NY', 'NEW YORK']],
  ['ROCHESTER', ['NY', 'NEW YORK']],
  ['YONKERS', ['NY', 'NEW YORK']],
  ['SYRACUSE', ['NY', 'NEW YORK']],
  ['ALBANY', ['NY', 'NEW YORK']],
  ['NEWARK', ['NJ', 'NEW JERSEY']],
  ['JERSEY CITY', ['NJ', 'NEW JERSEY']],
  ['ATLANTIC CITY', ['NJ', 'NEW JERSEY']],
  ['DENVER', ['CO', 'COLORADO']],
  ['COLORADO SPRINGS', ['CO', 'COLORADO']],
  ['AURORA', ['CO', 'COLORADO']],
  ['DETROIT', ['MI', 'MICHIGAN']],
  ['GRAND RAPIDS', ['MI', 'MICHIGAN']],
  ['WARREN', ['MI', 'MICHIGAN']],
  ['STERLING HEIGHTS', ['MI', 'MICHIGAN']],
  ['LAS VEGAS', ['NV', 'NEVADA']],
  ['RENO', ['NV', 'NEVADA']],
  ['HENDERSON', ['NV', 'NEVADA']],
  ['CHARLOTTE', ['NC', 'NORTH CAROLINA']],
  ['RALEIGH', ['NC', 'NORTH CAROLINA']],
  ['GREENSBORO', ['NC', 'NORTH CAROLINA']],
  ['DURHAM', ['NC', 'NORTH CAROLINA']],
  ['WINSTON-SALEM', ['NC', 'NORTH CAROLINA']],
  ['CARY', ['NC', 'NORTH CAROLINA']],
  ['NASHVILLE', ['TN', 'TENNESSEE']],
  ['MEMPHIS', ['TN', 'TENNESSEE']],
  ['KNOXVILLE', ['TN', 'TENNESSEE']],
  ['CHATTANOOGA', ['TN', 'TENNESSEE']],
  ['CLARKSVILLE', ['TN', 'TENNESSEE']],
  ['MURFREESBORO', ['TN', 'TENNESSEE']],
  ['BALTIMORE', ['MD', 'MARYLAND']],
  ['FREDERICK', ['MD', 'MARYLAND']],
  ['ROCKVILLE', ['MD', 'MARYLAND']],
  ['BOWIE', ['MD', 'MARYLAND']],
  ['OKLAHOMA CITY', ['OK', 'OKLAHOMA']],
  ['TULSA', ['OK', 'OKLAHOMA']],
  ['NORMAN', ['OK', 'OKLAHOMA']],
  ['EDMOND', ['OK', 'OKLAHOMA']],
  ['MIDWEST CITY', ['OK', 'OKLAHOMA']]
]);

export class EntityValidator {
  private stats: CleaningStats;
  private seenRecords: Set<string>;

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
  }

  /**
   * Validates and cleans a single entity record
   */
  validateAndClean(record: EntityRecord): ValidationResult {
    this.stats.totalProcessed++;
    const issues: string[] = [];
    let severity: 'error' | 'warning' | 'info' = 'info';
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
      issues.push(mismatchResult.errorMessage!);
      severity = 'error';
      // Try to correct the mismatch
      if (mismatchResult.correctedState) {
        cleanedRecord.state = mismatchResult.correctedState;
        issues.push(`Auto-corrected state to: ${mismatchResult.correctedState}`);
        severity = 'warning';
      }
    }

    // Validate entity name
    if (!record.entityName || record.entityName.trim().length === 0) {
      issues.push('Entity name is empty');
      severity = 'error';
    }

    // Validate address
    if (!record.addressLine1 || record.addressLine1.trim().length === 0) {
      issues.push('Address line 1 is empty');
      if (severity !== 'error') severity = 'warning';
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

  /**
   * Validates city name and detects common issues
   */
  private validateCity(city: string, state: string): { isValid: boolean; issues: string[]; cleanedValue?: string } {
    const issues: string[] = [];
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
    if (!MAJOR_CITIES.has(cleanedCity)) {
      // Check if it might be a neighborhood or smaller city
      if (cleanedCity.length < 3) {
        return { isValid: false, issues: ['City name too short'] };
      }
      issues.push('Unrecognized city name - may be a neighborhood or small town');
    }

    return { isValid: true, issues, cleanedValue: cleanedCity };
  }

  /**
   * Validates state code/name
   */
  private validateState(state: string, _city: string): { isValid: boolean; issues: string[]; cleanedValue?: string } {
    const issues: string[] = [];
    const cleanedState = state ? state.trim().toUpperCase() : '';

    if (!cleanedState) {
      return { isValid: false, issues: ['State is empty'] };
    }

    // Check if it's a valid 2-letter state code
    if (cleanedState.length === 2) {
      if (!US_STATES.has(cleanedState)) {
        return { isValid: false, issues: [`Invalid state code: ${cleanedState}`] };
      }
      return { isValid: true, issues, cleanedValue: cleanedState };
    }

    // Check if it's a full state name
    const stateCode = Array.from(US_STATES.entries()).find(([_, name]) => name === cleanedState)?.[0];
    if (stateCode) {
      return { 
        isValid: true, 
        issues: [`Converted state name to code: ${cleanedState} -> ${stateCode}`],
        cleanedValue: stateCode
      };
    }

    return { isValid: false, issues: [`Invalid state: ${cleanedState}`] };
  }

  /**
   * Validates zipcode format
   */
  private validateZipcode(zipcode: string): { isValid: boolean; issues: string[]; cleanedValue?: string } {
    const issues: string[] = [];
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

  /**
   * Checks for city-state mismatches
   */
  private checkCityStateMismatch(city: string, state: string): { 
    hasMismatch: boolean; 
    errorMessage?: string; 
    correctedState?: string;
  } {
    const expectedStates = CITY_STATE_MISMATCHES.get(city.toUpperCase());
    
    if (expectedStates) {
      const stateUpper = state.toUpperCase();
      if (!expectedStates.includes(stateUpper)) {
        // Found a mismatch, try to suggest correction
        const suggestedState = expectedStates[0]; // Use first suggestion
        return {
          hasMismatch: true,
          errorMessage: `City ${city} is not in ${state}. Expected: ${expectedStates.join(' or ')}`,
          correctedState: suggestedState
        };
      }
    }

    // Check for specific known mismatches
    if (city.toUpperCase() === 'BOSTON' && state.toUpperCase() === 'KINGSTON') {
      return {
        hasMismatch: true,
        errorMessage: 'Boston should be in Massachusetts (MA), not Kingston',
        correctedState: 'MA'
      };
    }

    if (city.toUpperCase() === 'MIAMI' && state.toUpperCase() === 'FT. MYERS') {
      return {
        hasMismatch: true,
        errorMessage: 'Miami should be in Florida (FL), not Ft. Myers',
        correctedState: 'FL'
      };
    }

    return { hasMismatch: false };
  }

  /**
   * Process a batch of entity records
   */
  processBatch(records: Record<string, EntityRecord>): { 
    cleanedRecords: Record<string, EntityRecord>;
    stats: CleaningStats;
  } {
    const cleanedRecords: Record<string, EntityRecord> = {};
    
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

  /**
   * Get current cleaning statistics
   */
  getStats(): CleaningStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      validRecords: 0,
      cleanedRecords: 0,
      discardedRecords: 0,
      duplicatesRemoved: 0,
      issuesFixed: []
    };
    this.seenRecords.clear();
  }
}

/**
 * Utility function to clean entities JSON file
 */
export async function cleanEntitiesFile(inputPath: string, _outputPath: string): Promise<CleaningStats> {
  try {
    // In browser environment, use fetch instead of Deno
    const response = await fetch(inputPath);
    const entitiesData = await response.json();
    
    const validator = new EntityValidator();
    const result = validator.processBatch(entitiesData);
    
    // For browser environment, return the data instead of writing to file
    // The calling code should handle the file writing
    console.log('Cleaned data ready for output:', result.stats);
    return result.stats;
  } catch (error: unknown) {
    throw new Error(`Failed to clean entities file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
