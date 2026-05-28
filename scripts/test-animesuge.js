import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();
chromium.use(StealthPlugin());

const ANIME_URL = 'https://animesuge.cz/anime/wistoria-wand-and-sword-season-2-dua04';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function runAnimeSugeTest() {
  console.log(`🚀 Launching browser to probe Wistoria on AnimeSuge: ${ANIME_URL}`);
  
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
    });

    const page = await context.newPage();

    // Listen to network requests/responses to see how it loads episodes and embeds
    page.on('request', request => {
      const url = request.url();
      if (url.includes('ajax') || url.includes('embed') || url.includes('player') || url.includes('.m3u8')) {
        console.log(`📡 [Req] ${request.method()} - ${url}`);
      }
    });

    page.on('response', async response => {
      const url = response.url();
      if (url.includes('ajax') || url.includes('embed') || url.includes('player') || url.includes('.m3u8')) {
        console.log(`📥 [Res] ${response.status()} - ${url}`);
        try {
          if (response.status() === 200) {
            const text = await response.text();
            console.log(`  ✨ Saved response (Length: ${text.length})`);
            console.log(`  Preview: ${text.substring(0, 300)}`);
          }
        } catch (e) {
          // ignore
        }
      }
    });

    console.log('🌐 Navigating to Anime page...');
    await page.goto(ANIME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log(`👑 Page Title: ${await page.title()}`);

    // Let's check for any dynamic episode list containers in the page DOM
    console.log('🔍 Scanning page DOM for episode lists and servers...');
    
    // Dump HTML structure around episodes and players
    const pageStructure = await page.evaluate(() => {
      const episodeContainers = Array.from(document.querySelectorAll('#episodes, .episodes, [class*="episode-list"], [id*="episode"]'))
        .map(el => ({ id: el.id, class: el.className, tag: el.tagName }));
      
      const serverContainers = Array.from(document.querySelectorAll('#servers, .servers, #media-servers, .server-list, [class*="server"]'))
        .map(el => ({ id: el.id, class: el.className, tag: el.tagName }));

      const iframeSrcs = Array.from(document.querySelectorAll('iframe'))
        .map(el => ({ id: el.id, class: el.className, src: el.src }));

      return { episodeContainers, serverContainers, iframeSrcs };
    });

    console.log('📄 Page structure scan results:', JSON.stringify(pageStructure, null, 2));

    // Find and list all elements that look like episode links/buttons
    const episodeButtons = await page.$$eval('a, li, button, .episode', el => el.map(e => ({
      tag: e.tagName.toLowerCase(),
      text: e.innerText.trim().replace(/\s+/g, ' '),
      class: e.className,
      id: e.id,
      href: e.href || null,
      dataId: e.getAttribute('data-id') || e.getAttribute('data-episode-id') || e.getAttribute('data-episode')
    })).filter(e => {
      const text = e.text.toLowerCase();
      const isEpNum = /^\d+$/.test(e.text) || text.includes('ep') || text.includes('episode');
      return (e.href && (e.href.includes('/watch/') || e.href.includes('/episode/') || e.href.includes('ep='))) || 
             e.dataId || 
             (isEpNum && (e.class.includes('item') || e.class.includes('ep') || e.class.includes('btn')));
    }));

    console.log(`🔢 Found ${episodeButtons.length} potential episode items:`, JSON.stringify(episodeButtons.slice(0, 30), null, 2));

    // Let's find an episode button to click (usually the first one, like Episode 1)
    let clickedEpisodeText = '';
    // Look for an item that is exactly "1" or contains "Episode 1" or has a href with ep=1 or similar
    const ep1Item = episodeButtons.find(b => b.text === '1' || b.text.toLowerCase() === 'episode 1' || b.text.toLowerCase().includes('ep 1') || (b.href && b.href.includes('ep=1')));
    const targetEpItem = ep1Item || episodeButtons[0];

    if (targetEpItem) {
      console.log(`👉 Clicking episode element:`, targetEpItem);
      clickedEpisodeText = targetEpItem.text;
      
      // Let's find the matching element in Playwright and click it
      let locator;
      if (targetEpItem.id) {
        locator = page.locator(`#${targetEpItem.id}`);
      } else if (targetEpItem.href) {
        locator = page.locator(`a[href="${targetEpItem.href}"]`).first();
      } else {
        // Fallback to text matching
        locator = page.locator(`${targetEpItem.tag}`).filter({ hasText: new RegExp(`^\\s*${targetEpItem.text}\\s*$`, 'i') }).first();
      }

      await locator.click({ timeout: 5000 }).catch(async () => {
        console.log('⚠️ click via locator failed, trying evaluate click');
        await page.evaluate((text, tag) => {
          const els = Array.from(document.querySelectorAll(tag));
          const el = els.find(e => e.innerText.trim() === text);
          if (el) el.click();
        }, targetEpItem.text, targetEpItem.tag);
      });

      console.log('⏳ Waiting for episode players and servers to load...');
      await page.waitForTimeout(5000);

      // Now scan the servers list
      const servers = await page.$$eval('.server, [class*="server"], [id*="server"]', el => el.map(s => ({
        tag: s.tagName.toLowerCase(),
        text: s.innerText.trim().replace(/\s+/g, ' '),
        class: s.className,
        id: s.id,
        dataId: s.getAttribute('data-id') || s.getAttribute('data-embed') || s.getAttribute('data-video') || s.getAttribute('data-link')
      })).filter(s => s.text.length > 0 && !s.class.includes('wrapper') && !s.class.includes('list') && !s.class.includes('type')));

      console.log(`🔘 Discovered ${servers.length} server options:`, JSON.stringify(servers, null, 2));

      // Check current iframe URL
      const currentIframe = await page.locator('iframe').first().getAttribute('src').catch(() => null);
      console.log(`📺 Current iframe source: ${currentIframe}`);

      // Let's try to click other servers if available
      for (const server of servers) {
        if (server.text.toLowerCase().includes('megaplay') || server.text.toLowerCase().includes('vidwish') || server.text.toLowerCase().includes('-1') || server.text.toLowerCase().includes('server')) {
          console.log(`👉 Clicking server element: "${server.text}"...`);
          
          await page.evaluate((text) => {
            const els = Array.from(document.querySelectorAll('.server, [class*="server"]'));
            const el = els.find(e => e.innerText.trim() === text);
            if (el) el.click();
          }, server.text);

          await page.waitForTimeout(3000);

          const newIframe = await page.locator('iframe').first().getAttribute('src').catch(() => null);
          console.log(`  ✨ Clicked "${server.text}" -> Iframe source: ${newIframe}`);
        }
      }
    } else {
      console.log('❌ Could not find any episode element to click!');
    }

  } catch (error) {
    console.error('❌ Error during AnimeSuge probe:', error);
  } finally {
    console.log('🔌 Closing browser...');
    await browser.close();
  }
}

runAnimeSugeTest();
