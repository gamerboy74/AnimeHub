import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load dotenv
dotenv.config({ path: join(__dirname, "..", ".env") });

// Mock the required index.js functions before importing the scraper
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

let sharedBrowser = null;
async function getBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return sharedBrowser;
}

// Inject getBrowser into the global context
global.getBrowser = getBrowser;

// Now import the service dynamically
import { AnimeSugeScraperService } from '../server/scrapers/animesuge.js';

async function runServiceTest() {
  console.log('🚀 Running AnimeSugeScraperService integration test for Fairy Tail: Phoenix Priestess...');
  try {
    const animeTitle = 'Fairy Tail: Phoenix Priestess';
    const result = await AnimeSugeScraperService.scrapeAnimeEpisode(animeTitle, 1, {
      timeout: 45000,
      retries: 2,
      lang: 'sub',
      dbAnimeId: '7ff0c7a5-3309-4e6a-9b13-7ad257d4756e'
    });

    console.log('\n🎉 TEST RESULT SUMMARY:');
    console.log('==================================================');
    console.log(`Success: ${result.success}`);
    if (result.success) {
      console.log(`Watch URL: ${result.watchUrl}`);
      console.log(`Primary Stream: ${result.streamUrl}`);
      console.log(`Sources Count: ${result.episodeData?.sources?.length || 0}`);
      result.episodeData?.sources?.forEach((s, idx) => {
        console.log(`   [Server #${idx + 1}] Label: ${s.label} (${s.lang})`);
        console.log(`   Embed URL: ${s.iframeUrl}`);
      });
    } else {
      console.log(`Error: ${result.error}`);
    }
    console.log('==================================================');

  } catch (error) {
    console.error('❌ Integration Test Failed:', error);
  } finally {
    if (sharedBrowser) {
      await sharedBrowser.close();
    }
  }
}

runServiceTest();
