import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();
chromium.use(StealthPlugin());

async function testReanimeScraping() {
  console.log('🚀 Launching Playwright to inspect reanime.to...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      bypassCSP: true,
      javaScriptEnabled: true
    });

    const page = await context.newPage();

    // Listen to network requests/responses to catch embed APIs or direct video streaming URLs
    page.on('request', request => {
      const url = request.url();
      if (url.includes('embed') || url.includes('player') || url.includes('.m3u8') || url.includes('iframe') || url.includes('api') || url.includes('manifest')) {
        console.log(`📡 [Network Request] ${request.method()} - ${url}`);
      }
    });

    const interestingResponses = {};
    page.on('response', async response => {
      const url = response.url();
      if (url.includes('.m3u8') || url.includes('manifest') || url.includes('hls') || url.includes('api') || url.includes('flix')) {
        console.log(`📥 [Network Response] ${response.status()} - ${url}`);
        try {
          if (response.status() === 200) {
            const text = await response.text();
            interestingResponses[url] = text;
            console.log(`  ✨ Saved response from: ${url} (Length: ${text.length})`);
            if (url.includes('flix') || url.includes('m3u8') || url.includes('episodes')) {
              console.log(`  Preview: ${text.substring(0, 800)}`);
            }
          }
        } catch (e) {
          // ignore
        }
      }
    });

    console.log('🌐 Navigating to https://reanime.to/watch/wistoria-wand-and-sword-season-2-59cjjy?ep=1...');
    // Use domcontentloaded instead of networkidle to prevent timeout from blocking trackers
    const response = await page.goto('https://reanime.to/watch/wistoria-wand-and-sword-season-2-59cjjy?ep=1', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log(`📥 Response status: ${response ? response.status() : 'No response'}`);
    
    // Dump page title
    const title = await page.title();
    console.log(`👑 Page Title: ${title}`);

    // Wait 20 seconds to allow cloudflare/turnstile, player to load and all network responses to finish
    console.log('⏳ Waiting 20 seconds for dynamic elements and player to render...');
    await page.waitForTimeout(20000);

    // Extract all iframes
    const iframes = await page.$$eval('iframe', el => el.map(iframe => ({
      src: iframe.src,
      id: iframe.id,
      class: iframe.className
    })));
    console.log(`📺 Found ${iframes.length} iframes:`, iframes);

    // Get HTML content
    const html = await page.content();
    console.log(`📄 Page HTML Length: ${html.length}`);
    
    // Search for 182300 in HTML
    const searchTerms = ['182300', 'wistoria', 'flix'];
    for (const term of searchTerms) {
      const idx = html.indexOf(term);
      if (idx !== -1) {
        console.log(`🔍 Found term "${term}" in HTML at index ${idx}. Context: ${html.substring(Math.max(0, idx - 100), Math.min(html.length, idx + 200))}`);
      } else {
        console.log(`🔍 Term "${term}" NOT found in HTML.`);
      }
    }
    
    // Look for stream URLs using regex
    const m3u8Pattern = /https?:\/\/[^"'\s]*\.m3u8[^"'\s]*/gi;
    const m3u8Matches = [...html.matchAll(m3u8Pattern)].map(m => m[0]);
    if (m3u8Matches.length > 0) {
      console.log('🎯 Found .m3u8 URLs in HTML source:', [...new Set(m3u8Matches)]);
    } else {
      console.log('❌ No .m3u8 URLs found directly in page HTML.');
    }

    // Check if there are other potential sources (e.g. video tags)
    const videos = await page.$$eval('video', el => el.map(v => ({
      src: v.src,
      sources: Array.from(v.querySelectorAll('source')).map(s => s.src)
    })));
    console.log(`📹 Found ${videos.length} video tags:`, videos);

    // Wait an extra 5 seconds to ensure all responses are fully captured
    console.log('⏳ Waiting 5 more seconds to ensure all responses are logged...');
    await page.waitForTimeout(5000);

    console.log('\n📜 --- DUMPING INTERESTING RESPONSES ---');
    for (const [url, text] of Object.entries(interestingResponses)) {
      if (url.includes('m3u8') || url.includes('flix')) {
        console.log(`🔑 URL: ${url}`);
        console.log(`📄 Response: ${text}\n`);
      }
    }
    console.log('----------------------------------------\n');

  } catch (error) {
    console.error('❌ Error during inspection:', error);
  } finally {
    console.log('🔌 Closing browser...');
    await browser.close();
  }
}

testReanimeScraping();
