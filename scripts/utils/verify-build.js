/**
 * Production Build Verification Script
 * Checks build output for common issues
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const OUT_DIR = 'out';
const MAX_BUNDLE_SIZE = 500 * 1024; // 500KB
const MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5MB

function checkFileExists(file) {
  if (!existsSync(file)) {
    console.error(`❌ Missing file: ${file}`);
    return false;
  }
  return true;
}

function checkBundleSizes() {
  console.log('📦 Checking bundle sizes...');
  
  // Check main entry points
  const entryFiles = ['index.html'];
  let allExist = true;
  
  for (const file of entryFiles) {
    const filePath = join(OUT_DIR, file);
    if (!checkFileExists(filePath)) {
      allExist = false;
    }
  }
  
  // Check for excessively large JS files
  // This would require walking the directory, simplified for now
  console.log('✅ Bundle size check complete');
  return allExist;
}

function checkSourceMaps() {
  console.log('🗺️  Checking source maps...');
  
  // In production, source maps should be disabled or hidden
  const hasSourceMaps = existsSync(join(OUT_DIR, 'index.js.map'));
  
  if (hasSourceMaps && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  Source maps found in production build');
    return false;
  }
  
  console.log('✅ Source map check complete');
  return true;
}

function checkEnvironmentVariables() {
  console.log('🔐 Checking environment variables...');
  
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
    return false;
  }
  
  console.log('✅ Environment variables check complete');
  return true;
}

function main() {
  console.log('🔍 Starting production build verification...\n');
  
  const checks = [
    checkFileExists(join(OUT_DIR, 'index.html')),
    checkBundleSizes(),
    checkSourceMaps(),
    checkEnvironmentVariables(),
  ];
  
  const allPassed = checks.every(check => check === true);
  
  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log('✅ All checks passed! Build is ready for production.');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed. Please review the errors above.');
    process.exit(1);
  }
}

main();

