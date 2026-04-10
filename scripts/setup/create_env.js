#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  'UNSAFE_LOCAL_USER_PASSWORD': '',
  'UNSAFE_LOCAL_DEMOD_PASSWORD': '',
  'UNSAFE_LOCAL_LATEX_PASSWORD': '',

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
  content += `UNSAFE_LOCAL_USER_PASSWORD=${envConfig.UNSAFE_LOCAL_USER_PASSWORD}\n\n`;

  content += '# Encrypted Modules Decryption\n';
  content += '# Used for decrypting encrypted modules\n';
  content += `UNSAFE_LOCAL_DEMOD_PASSWORD=${envConfig.UNSAFE_LOCAL_DEMOD_PASSWORD}\n`;
  content += `UNSAFE_LOCAL_LATEX_PASSWORD=${envConfig.UNSAFE_LOCAL_LATEX_PASSWORD}\n\n`;
  
  content += '# Rust Logging\n';
  content += '# Log level for Rust backend (debug, info, warn, error)\n';
  content += `RUST_LOG=${envConfig.RUST_LOG}\n\n`;
  
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
    
    // Read existing file to show current values
    const existingContent = fs.readFileSync(envPath, 'utf8');
    log('\n📄 Current .env.local configuration:', 'bright');
    log('─'.repeat(50), 'cyan');
    log(existingContent, 'cyan');
    log('─'.repeat(50), 'cyan');
    
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
    fs.writeFileSync(envPath, content, 'utf8');
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
  log('   Set UNSAFE_LOCAL_USER_PASSWORD in .env.local', 'cyan');
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
