import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();
chromium.use(StealthPlugin());

const BASE_URL = 'https://reanime.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function runTest() {
  console.log('🚀 Launching browser to scrape "No Game, No Life Zero"...');
  
  const browser = await chromium.launch({
    headless: false, // Set to false so the user can see it run or we can debug if needed, or true for speed. Let's use true for sandboxed running.
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      bypassCSP: true,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });

    const page = await context.newPage();

    // 1. Go to homepage
    console.log(`🌐 Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('⏳ Waiting 4 seconds for Cloudflare/Turnstile to settle...');
    await page.waitForTimeout(4000);

    // 2. Search for the title
    console.log('🔍 Locating search input...');
    let searchInput = await page.$('input[placeholder*="Search" i], input[type="search"], input[name="search"]');
    if (!searchInput) {
      searchInput = await page.$('input[type="text"]');
    }

    if (!searchInput) {
      const searchIcon = await page.$('.search-btn, .search-icon, button:has-text("Search"), [class*="search"]');
      if (searchIcon) {
        console.log('Clicking search icon/button to reveal input...');
        await searchIcon.click();
        await page.waitForTimeout(1000);
        searchInput = await page.$('input[placeholder*="Search" i], input[type="search"], input[type="text"]');
      }
    }

    if (!searchInput) {
      throw new Error('Could not find search input on Re:ANIME');
    }

    console.log('⌨️ Typing "No Game, No Life Zero"...');
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.type('No Game, No Life Zero', { delay: 100 });
    await page.waitForTimeout(500);
    await searchInput.press('Enter');

    console.log('⏳ Waiting 6 seconds for search results to load...');
    await page.waitForTimeout(6000);

    // 3. Find matching anime link
    const links = await page.$$eval('a', el => el.map(a => ({
      href: a.href,
      text: a.innerText
    })));

    const animeLinks = links.filter(l => l.href && (l.href.includes('/anime/') || l.href.includes('/watch/')));
    console.log(`🔗 Found ${animeLinks.length} potential anime links in search results:`);
    animeLinks.forEach(l => console.log(`  - [${l.text}] -> ${l.href}`));

    const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetClean = cleanStr('No Game, No Life Zero');

    let matchedLink = null;
    for (const link of animeLinks) {
      const textClean = cleanStr(link.text);
      if (textClean && (textClean.includes(targetClean) || targetClean.includes(textClean))) {
        matchedLink = link.href;
        console.log(`🎯 Matched: "${link.text}" -> ${link.href}`);
        break;
      }
    }

    if (!matchedLink && animeLinks.length > 0) {
      matchedLink = animeLinks[0].href;
      console.log(`⚠️ No exact text match, using first search result: ${matchedLink}`);
    }

    if (!matchedLink) {
      throw new Error('No search results found');
    }

    let watchUrl = '';

    if (matchedLink.includes('/watch/')) {
      watchUrl = matchedLink;
    } else {
      // 4. Navigate to anime details page
      console.log(`🌐 Navigating to detail page: ${matchedLink}...`);
      await page.goto(matchedLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);

      // Extract watch link
      console.log('🔍 Locating watch link on detail page...');
      const watchLink = await page.locator('a[href*="/watch/"]').first().getAttribute('href').catch(() => null);
      if (!watchLink) {
        throw new Error('Could not find watch link on detail page');
      }
      
      watchUrl = watchLink.startsWith('http') ? watchLink : `${BASE_URL}${watchLink.startsWith('/') ? '' : '/'}${watchLink}`;
    }

    // Parse and append parameters
    const watchUrlObj = new URL(watchUrl);
    watchUrlObj.searchParams.set('ep', '1');
    watchUrlObj.searchParams.set('lang', 'sub');
    const finalWatchUrl = watchUrlObj.toString();
    console.log(`✅ Resolved Watch URL: ${finalWatchUrl}`);

    // 5. Navigate to watch page
    console.log(`🌐 Navigating to watch page: ${finalWatchUrl}...`);
    await page.goto(finalWatchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Wait for iframe
    try {
      await page.waitForFunction(() => {
        const iframe = document.querySelector('iframe');
        return !!(iframe && iframe.getAttribute('src'));
      }, { timeout: 15000 });
    } catch {}

    const primaryIframe = await page.locator('iframe').first().getAttribute('src').catch(() => null);
    console.log(`🎬 Primary Stream Iframe URL: ${primaryIframe}`);

    // 6. Click server buttons to extract alternative servers
    const sources = [];
    const seen = new Set();
    if (primaryIframe) {
      seen.add(primaryIframe);
      sources.push({ label: 'active', iframeUrl: primaryIframe });
    }

    for (const label of ['HD-2', 'HD-1']) {
      const buttonCount = await page.getByRole('button', { name: label }).count().catch(() => 0);
      console.log(`🔘 Server button "${label}" count: ${buttonCount}`);

      for (let index = 0; index < buttonCount; index++) {
        try {
          await page.getByRole('button', { name: label }).nth(index).click({ timeout: 5000 });
          await page.waitForTimeout(3000);

          const iframeUrl = await page.locator('iframe').first().getAttribute('src').catch(() => null);
          if (iframeUrl && !seen.has(iframeUrl)) {
            seen.add(iframeUrl);
            sources.push({ label, iframeUrl });
            console.log(`  ✨ Extracted ${label} link: ${iframeUrl}`);
          }
        } catch (e) {
          console.log(`  ⚠️ Click failed: ${e.message}`);
        }
      }
    }

    console.log('\n🎉 Scraping Completed Successfully!');
    console.log('====================================');
    console.log(`Anime: "No Game, No Life Zero"`);
    console.log(`Watch URL: ${finalWatchUrl}`);
    console.log(`Sources found: ${sources.length}`);
    sources.forEach((s, i) => console.log(`  Server [${s.label}]: ${s.iframeUrl}`));
    console.log('====================================');

  } catch (error) {
    console.error('❌ Scrape Failed:', error.message);
  } finally {
    console.log('🔌 Closing browser...');
    await browser.close();
  }
}

runTest();
