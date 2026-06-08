import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", "..", ".env") });

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

global.getBrowser = getBrowser;

import { AnimeSugeScraperService } from '../../server/scrapers/animesuge.js';

async function runTest() {
  console.log('🚀 Starting test with DB anime ID...');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const title = "The Seven Deadly Sins: Cursed by Light";
    const matchedUrl = await AnimeSugeScraperService.searchAnimeUrl(page, title, {
      dbAnimeId: "5374bfd1-7589-4b46-abd0-cf4a19ec1faa"
    });
    console.log("Matched URL:", matchedUrl);
  } catch (e) {
    console.error("Test error:", e);
  } finally {
    await browser.close();
  }
}

runTest();
