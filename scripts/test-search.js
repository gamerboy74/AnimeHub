import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", ".env") });

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

import { AnimeSugeScraperService } from '../server/scrapers/animesuge.js';

async function testSearch() {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: AnimeSugeScraperService.USER_AGENT,
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  
  try {
    console.log('Testing search resolution for title: "Kengan Ashura"');
    const watchUrl = await AnimeSugeScraperService.resolveWatchUrlWithPage(
      page,
      "Kengan Ashura",
      1
    );
    console.log('✅ Resolved watch URL:', watchUrl);
  } catch (error) {
    console.error('❌ Resolution failed:', error.message);
  } finally {
    await context.close();
    await browser.close();
  }
}

testSearch();
