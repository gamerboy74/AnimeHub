import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load dotenv
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

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

// Inject getBrowser into the global context or import mock module
global.getBrowser = getBrowser;

// Now import the service dynamically
import { AnimeSugeScraperService } from '../../server/scrapers/animesuge.js';

async function runServiceTest() {
  console.log('🚀 Running AnimeSugeScraperService integration test...');
  try {
    const animeUrl = 'Wistoria: Wand and Sword Season 2';
    const result = await AnimeSugeScraperService.scrapeAnimeEpisode(animeUrl, 1, {
      timeout: 35000,
      retries: 1,
      lang: 'dub'
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
