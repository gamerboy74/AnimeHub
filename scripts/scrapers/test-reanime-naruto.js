import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();
chromium.use(StealthPlugin());

const BASE_URL = 'https://reanime.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function runTest() {
  console.log('🚀 Launching browser to scrape Naruto Ep 1 to 5...');
  
  const browser = await chromium.launch({
    headless: true,
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
    console.log('⏳ Waiting for Cloudflare challenge to settle...');
    await page.waitForTimeout(4000);

    // 2. Search for Naruto
    console.log('🔍 Locating search input...');
    let searchInput = await page.$('input[placeholder*="Search" i], input[type="search"], input[name="search"]');
    if (!searchInput) {
      searchInput = await page.$('input[type="text"]');
    }

    if (!searchInput) {
      const searchIcon = await page.$('.search-btn, .search-icon, button:has-text("Search"), [class*="search"]');
      if (searchIcon) {
        await searchIcon.click();
        await page.waitForTimeout(1000);
        searchInput = await page.$('input[placeholder*="Search" i], input[type="search"], input[type="text"]');
      }
    }

    if (!searchInput) {
      throw new Error('Could not find search input');
    }

    console.log('⌨️ Typing "Naruto"...');
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.type('Naruto', { delay: 100 });
    await page.waitForTimeout(500);
    await searchInput.press('Enter');

    console.log('⏳ Waiting for search results...');
    await page.waitForTimeout(5000);

    // 3. Find matching anime link
    const links = await page.$$eval('a', el => el.map(a => ({
      href: a.href,
      text: a.innerText
    })));

    const animeLinks = links.filter(l => l.href && (l.href.includes('/anime/') || l.href.includes('/watch/')));
    
    // Find link containing Naruto
    const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetClean = cleanStr('Naruto');

    let matchedLink = null;
    for (const link of animeLinks) {
      const textClean = cleanStr(link.text);
      // We want to match "Naruto" exactly or closely (not Naruto Shippuden if possible, but let's see)
      if (textClean === 'naruto' || textClean.includes('naruto')) {
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

    let watchUrlBase = '';

    if (matchedLink.includes('/watch/')) {
      watchUrlBase = matchedLink.split('?')[0];
    } else {
      // Navigate to anime details page
      console.log(`🌐 Navigating to detail page: ${matchedLink}...`);
      await page.goto(matchedLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);

      // Extract watch link
      console.log('🔍 Locating watch link on detail page...');
      const watchLink = await page.locator('a[href*="/watch/"]').first().getAttribute('href').catch(() => null);
      if (!watchLink) {
        throw new Error('Could not find watch link on detail page');
      }
      
      const fullWatchLink = watchLink.startsWith('http') ? watchLink : `${BASE_URL}${watchLink.startsWith('/') ? '' : '/'}${watchLink}`;
      watchUrlBase = fullWatchLink.split('?')[0];
    }

    console.log(`📡 Resolved Base Watch URL: ${watchUrlBase}`);

    // Loop through episodes 1 to 5
    const episodes = [1, 2, 3, 4, 5];
    const results = [];

    for (const ep of episodes) {
      const targetWatchUrl = `${watchUrlBase}?ep=${ep}&lang=sub`;
      console.log(`\n🎬 [Episode ${ep}] Navigating to watch page: ${targetWatchUrl}...`);
      
      await page.goto(targetWatchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);

      // Wait for iframe
      try {
        await page.waitForFunction(() => {
          const iframe = document.querySelector('iframe');
          return !!(iframe && iframe.getAttribute('src'));
        }, { timeout: 10000 });
      } catch {}

      const primaryIframe = await page.locator('iframe').first().getAttribute('src').catch(() => null);
      console.log(`  [Episode ${ep}] Primary Iframe: ${primaryIframe}`);

      const episodeSources = [];
      const seen = new Set();
      if (primaryIframe) {
        seen.add(primaryIframe);
        episodeSources.push({ label: 'active', iframeUrl: primaryIframe });
      }

      for (const label of ['HD-2', 'HD-1']) {
        const buttonCount = await page.getByRole('button', { name: label }).count().catch(() => 0);
        for (let index = 0; index < buttonCount; index++) {
          try {
            await page.getByRole('button', { name: label }).nth(index).click({ timeout: 5000 });
            await page.waitForTimeout(2500);

            const iframeUrl = await page.locator('iframe').first().getAttribute('src').catch(() => null);
            if (iframeUrl && !seen.has(iframeUrl)) {
              seen.add(iframeUrl);
              episodeSources.push({ label, iframeUrl });
              console.log(`    ✨ Extracted ${label} link: ${iframeUrl}`);
            }
          } catch (e) {
            // ignore
          }
        }
      }

      results.push({
        episode: ep,
        watchUrl: targetWatchUrl,
        sources: episodeSources
      });
    }

    console.log('\n🎉 Naruto Scrape ep1 to ep5 Completed!');
    console.log('==================================================');
    for (const res of results) {
      console.log(`📺 Episode ${res.episode}:`);
      console.log(`   Watch URL: ${res.watchUrl}`);
      console.log(`   Sources found: ${res.sources.length}`);
      res.sources.forEach(s => console.log(`     - [${s.label}]: ${s.iframeUrl}`));
      console.log('--------------------------------------------------');
    }
    console.log('==================================================');

  } catch (error) {
    console.error('❌ Scrape Failed:', error.message);
  } finally {
    console.log('🔌 Closing browser...');
    await browser.close();
  }
}

runTest();
