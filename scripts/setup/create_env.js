#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../..');

// ANSI colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step) {
  log(`\n📋 Step ${step}:`, 'bright');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

const legacyVitePasswordKey = 'VITE_UNSAFE_LOCAL_USER_PASSWORD';
const localCapturePasswordKey = 'NAPT_LEGACY_CAPTURE_PASSWORD';

function migrateLegacyVitePassword(envPath) {
  const original = fs.readFileSync(envPath, 'utf8');
  const values = dotenv.parse(original);
  if (!Object.hasOwn(values, legacyVitePasswordKey)) return false;

  const hasBackendPassword = Object.hasOwn(values, 'UNSAFE_LOCAL_USER_PASSWORD');
  const hasLocalCapturePassword = Object.hasOwn(values, localCapturePasswordKey);
  const legacyPassword = values[legacyVitePasswordKey];
  let targetKey = null;

  if (!hasBackendPassword) {
    targetKey = 'UNSAFE_LOCAL_USER_PASSWORD';
  } else if (legacyPassword !== values.UNSAFE_LOCAL_USER_PASSWORD) {
    if (!hasLocalCapturePassword) {
      targetKey = localCapturePasswordKey;
    } else if (values[localCapturePasswordKey] !== legacyPassword) {
      throw new Error('A different NAPT_LEGACY_CAPTURE_PASSWORD already exists. Resolve the two local capture passwords before rerunning setup.');
    }
  }

  const lines = original.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let lastAliasLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(?:export\s+)?VITE_UNSAFE_LOCAL_USER_PASSWORD\s*=/.test(lines[index])) {
      lastAliasLine = index;
    }
  }

  const migrated = lines.flatMap((line, index) => {
    if (!/^\s*(?:export\s+)?VITE_UNSAFE_LOCAL_USER_PASSWORD\s*=/.test(line)) return [line];
    if (index !== lastAliasLine || !targetKey) return [];
    return [line.replace(/^([ \t]*(?:export[ \t]+)?)VITE_UNSAFE_LOCAL_USER_PASSWORD([ \t]*=)/, `$1${targetKey}$2`)];
  }).join('');

  const temporaryPath = `${envPath}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, migrated, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporaryPath, envPath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
  return true;
}

// Environment variables configuration
const envConfig = {
  // Development/Production
  'NODE_ENV': 'development',
  
  // Redis Configuration
  'REDIS_URL': 'redis://127.0.0.1:6379',
  'REDIS_HOST': '127.0.0.1',
  'REDIS_PORT': '6379',
  
  // OpenCellID API (Optional - for tower data)
  'OPEN_CELL_ID_ACCESS_TOKEN': 'your_opencellid_api_token_here',
  
  // Local OpenCellID data (Optional)
  'LOCAL_OPENCELLID_CSV_DIR': '',
  
  // Force refresh flags
  'OPENCELLID_FORCE_REFRESH': '0',
  
  // Password for decrypting streaming frames and files
  // Ensure to set the correct password for the files here
  'UNSAFE_LOCAL_USER_PASSWORD': randomBytes(32).toString('hex'),
  'UNSAFE_LOCAL_DEMOD_PASSWORD': 'the_demod_password',
  'UNSAFE_LOCAL_LATEX_PASSWORD': 'the_latex_password',

  // PBKDF2 Salts for cryptographic operations
  // If not set, the application uses a default hard-coded salt (not recommended for production)
  'NAPT_PBKDF2_SALT': 'n-apt-aes-salt-v1',
  'VITE_PBKDF2_SALT': 'n-apt-aes-salt-v1',

  // Rust logging
  'RUST_LOG': 'info'
};

// Create .env.local content
function createEnvContent() {
  let content = '# N-APT Environment Configuration\n';
  content += '# Generated automatically by npm run setup\n';
  content += '# Feel free to modify these values as needed\n\n';
  
  content += '# Development/Production Environment\n';
  content += `NODE_ENV=${envConfig.NODE_ENV}\n\n`;
  
  content += '# Redis Configuration\n';
  content += '# Used for tower data caching and application state\n';
  content += `REDIS_URL=${envConfig.REDIS_URL}\n`;
  content += `REDIS_HOST=${envConfig.REDIS_HOST}\n`;
  content += `REDIS_PORT=${envConfig.REDIS_PORT}\n\n`;
  
  content += '# OpenCellID API (Optional)\n';
  content += '# Get your token from: https://opencellid.org/\n';
  content += '# Required for downloading tower data automatically\n';
  content += `OPEN_CELL_ID_ACCESS_TOKEN=${envConfig.OPEN_CELL_ID_ACCESS_TOKEN}\n\n`;
  
  content += '# Local OpenCellID Data (Optional)\n';
  content += '# Path to local OpenCellID CSV files if you have them\n';
  content += '# Leave empty to use remote API or skip tower data\n';
  content += `LOCAL_OPENCELLID_CSV_DIR=${envConfig.LOCAL_OPENCELLID_CSV_DIR}\n\n`;
  
  content += '# Force Refresh Flags\n';
  content += '# Set to 1 to force refresh OpenCellID data\n';
  content += `OPENCELLID_FORCE_REFRESH=${envConfig.OPENCELLID_FORCE_REFRESH}\n\n`;
  
  content += '# Streaming Frames and Files Decryption\n';
  content += '# Used for decrypting streaming frames and files\n';
  content += '# Ensure to set the correct password for the files here\n';
  content += `UNSAFE_LOCAL_USER_PASSWORD=${envConfig.UNSAFE_LOCAL_USER_PASSWORD}\n`;
  content += '\n';

  content += '# Encrypted Modules Decryption\n';
  content += '# Used for decrypting encrypted modules\n';
  content += `UNSAFE_LOCAL_DEMOD_PASSWORD=${envConfig.UNSAFE_LOCAL_DEMOD_PASSWORD}\n`;
  content += `UNSAFE_LOCAL_LATEX_PASSWORD=${envConfig.UNSAFE_LOCAL_LATEX_PASSWORD}\n\n`;
  
  content += '# Rust Logging\n';
  content += '# Log level for Rust backend (debug, info, warn, error)\n';
  content += `RUST_LOG=${envConfig.RUST_LOG}\n\n`;

  content += '# PBKDF2 Salts (Security Hardening)\n';
  content += '# Used for key derivation in both backend and frontend\n';
  content += '# RECOMMENDED: Change these to unique random strings in production\n';
  content += `NAPT_PBKDF2_SALT=${envConfig.NAPT_PBKDF2_SALT}\n`;
  content += `VITE_PBKDF2_SALT=${envConfig.NAPT_PBKDF2_SALT}\n\n`;
  
  content += '# Additional Development Settings\n';
  content += '# Uncomment and modify as needed:\n';
  content += '# VITE_API_URL=http://localhost:8765\n';
  content += '# VITE_WS_URL=ws://localhost:8765\n';
  content += '# PORT=5173\n';
  
  return content;
}

// Check if .env.local exists and show current configuration
function checkExistingFile() {
  const envPath = path.join(projectRoot, '.env.local');
  
  if (fs.existsSync(envPath)) {
    logSuccess('.env.local already exists!');
    
    // Preserve existing passwords and salts: changing them would orphan captures.
    fs.chmodSync(envPath, 0o600);
    try {
      if (migrateLegacyVitePassword(envPath)) {
        log('Removed the legacy Vite password entry; local capture credentials were retained.', 'cyan');
      }
    } catch {
      logError('Could not safely migrate the legacy Vite password entry. Resolve any conflicting local capture passwords, then rerun setup.');
      process.exitCode = 1;
      return false;
    }
    log('\nExisting credentials preserved; values are hidden.', 'cyan');
    
    log('\n💡 Your environment is already configured!', 'green');
    log('   If you need to recreate it, delete .env.local first:', 'yellow');
    log('   rm .env.local', 'cyan');
    log('   Then run: npm run setup', 'cyan');
    
    return false; // Don't overwrite
  }
  
  return true; // Safe to create
}

// Create .env.local file
function createEnvFile() {
  const envPath = path.join(projectRoot, '.env.local');
  const content = createEnvContent();
  
  try {
    fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    logSuccess('.env.local created successfully!');
    return true;
  } catch (error) {
    logError(`Failed to create .env.local: ${error.message}`);
    return false;
  }
}

// Show next steps
function showNextSteps() {
  log('\n🚀 Next Steps:', 'bright');
  log('\n1. Start the development server:', 'blue');
  log('   npm run dev', 'cyan');
  log('\n2. Login with the development password:', 'blue');
  log('   Read UNSAFE_LOCAL_USER_PASSWORD from .env.local locally.', 'cyan');
  log('   Keep that password and the salts to decrypt existing captures.', 'cyan');
  log('\n3. Optional: Configure OpenCellID API token for tower data:', 'blue');
  log('   - Get token from https://opencellid.org/');
  log('   - Edit .env.local and replace "your_opencellid_api_token_here"');
  log('\n4. Available commands:', 'blue');
  log('   npm run lint          - Check code quality');
  log('   npm run test          - Run TypeScript tests');
  log('   npm run test:rust     - Run Rust tests');
  log('   npm run test:wasm     - Run WASM tests');
}

// Main setup function
function main() {
  log('🔧 N-APT Environment Setup', 'bright');
  log('==============================', 'bright');
  
  logStep(1);
  log('Checking for existing .env.local file...');
  
  if (!checkExistingFile()) {
    if (process.exitCode) return;
    log('\n🎉 Setup complete - environment already configured!', 'green');
    showNextSteps();
    return;
  }
  
  logStep(2);
  log('Creating .env.local with default configuration...');
  
  if (!createEnvFile()) {
    process.exit(1);
  }
  
  logStep(3);
  log('Setup complete!');
  
  showNextSteps();
  
  log('\n✨ Happy coding with N-APT!', 'green');
}

// Run setup
main();
