import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", "..", ".env") });

import { NineAnimeScraperService } from '../../server/scrapers/nineanime.js';

// Setup basic in-memory caching mocks for backend environment in standalone script
global.cacheGet = async () => null;
global.cacheSet = async () => null;

async function test9AnimeSearch() {
  console.log("🧪 Starting 9anime Scraper Search Resolution Test...");
  console.log("==================================================");

  // Test Case 1: Overlord S1 (Should strictly avoid matching Overlord IV)
  try {
    console.log('🔍 Testing Season 1 lookup: "Overlord" (Should reject S4/S3/S2)');
    const result1 = await NineAnimeScraperService.searchAnimeWithCheerio("Overlord", 1);
    console.log("   Test 1 Result:", result1.success ? `✅ Success! Matched slug: "${result1.animeId}"` : `❌ Skipped/Failed gracefully: ${result1.error}`);
  } catch (err) {
    console.error("   Test 1 Error:", err.message);
  }

  console.log("--------------------------------------------------");

  // Test Case 2: Overlord IV S4 (Should correctly match Season 4)
  try {
    console.log('🔍 Testing Season 4 lookup: "Overlord IV" (Should lock onto Season 4)');
    const result2 = await NineAnimeScraperService.searchAnimeWithCheerio("Overlord IV", 1);
    console.log("   Test 2 Result:", result2.success ? `✅ Success! Matched slug: "${result2.animeId}"` : `❌ Skipped/Failed gracefully: ${result2.error}`);
  } catch (err) {
    console.error("   Test 2 Error:", err.message);
  }
  
  console.log("==================================================");
}

test9AnimeSearch();
