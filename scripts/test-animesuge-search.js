/**
 * test-animesuge-search.js
 * Tests AnimeSuge title-based search to debug why "not found" occurs.
 * Run: node scripts/test-animesuge-search.js
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
chromium.use(StealthPlugin());

const BASE_URL = 'https://animesuge.cz';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Anime titles to test (same titles users would type)
const TEST_TITLES = [
  'Naruto',
  'One Piece',
  'Wistoria: Wand and Sword',
  'Attack on Titan',
  'Demon Slayer',
];

const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function searchAnimeSuge(page, title) {
  const searchUrl = `${BASE_URL}/filter?keyword=${encodeURIComponent(title)}`;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 Searching AnimeSuge for: "${title}"`);
  console.log(`   URL: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(2000);

  const pageTitle = await page.title();
  console.log(`   Page title: "${pageTitle}"`);

  // ── Strategy 1: selector-based link collection ─────────────────────────
  const strategy1Links = await page.evaluate(() => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href*="/anime/"]'))
      .map((a) => {
        const cardEl =
          a.querySelector('.name, .title, h3, h2, strong, span') || a;
        return {
          href: a.href,
          text:
            cardEl.innerText?.trim() ||
            a.getAttribute('title') ||
            a.getAttribute('aria-label') ||
            '',
          outerHTML: a.outerHTML.slice(0, 120),
        };
      })
      .filter((l) => {
        if (!l.href || seen.has(l.href)) return false;
        if (l.href.includes('/filter') || l.href.includes('/genre')) return false;
        seen.add(l.href);
        return true;
      });
  });

  console.log(`\n📋 Strategy 1 (querySelector .name/.title): Found ${strategy1Links.length} links`);
  strategy1Links.slice(0, 8).forEach((l, i) => {
    console.log(`   [${i + 1}] "${l.text}" → ${l.href}`);
    if (!l.text) console.log(`        ⚠️  EMPTY TEXT — outerHTML: ${l.outerHTML}`);
  });

  // ── Strategy 2: all /anime/ links with any text ─────────────────────────
  const strategy2Links = await page.evaluate(() => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a'))
      .filter((a) => a.href && a.href.includes('/anime/'))
      .map((a) => ({
        href: a.href,
        text: a.innerText?.trim() || a.getAttribute('title') || '',
      }))
      .filter((l) => {
        if (seen.has(l.href)) return false;
        if (l.href.includes('/filter') || l.href.includes('/genre')) return false;
        seen.add(l.href);
        return true;
      });
  });

  console.log(`\n📋 Strategy 2 (all a[href*=/anime/]): Found ${strategy2Links.length} links`);
  strategy2Links.slice(0, 8).forEach((l, i) => {
    console.log(`   [${i + 1}] "${l.text}" → ${l.href}`);
  });

  // ── Strategy 3: dump all visible card containers ─────────────────────────
  const cardInfo = await page.evaluate(() => {
    // Try common result card selectors used by animesuge-style sites
    const selectors = [
      '.item', '.anime-item', '.film-item', '.card', '.result',
      '[class*="item"]', '[class*="card"]', '[class*="anime"]',
      '.inner', '.data', '.film-detail',
    ];
    const results = [];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0 && els.length < 50) {
        results.push({
          selector: sel,
          count: els.length,
          sample: Array.from(els).slice(0, 3).map(e => ({
            tag: e.tagName,
            class: e.className.slice(0, 80),
            text: e.innerText?.trim().slice(0, 80),
          })),
        });
      }
    }
    return results;
  });

  console.log(`\n🔎 Strategy 3 (card container scan):`);
  if (cardInfo.length === 0) {
    console.log('   ❌ No matching card containers found!');
  } else {
    cardInfo.forEach((c) => {
      console.log(`   Selector "${c.selector}": ${c.count} elements`);
      c.sample.forEach((s) => console.log(`     → <${s.tag} class="${s.class}"> "${s.text}"`));
    });
  }

  // ── Match attempt ─────────────────────────────────────────────────────────
  const allLinks = strategy2Links.length > 0 ? strategy2Links : strategy1Links;
  const targetClean = cleanStr(title);

  let exactMatch = null;
  const partialMatches = [];

  for (const link of allLinks) {
    const textClean = cleanStr(link.text);
    if (textClean === targetClean) {
      exactMatch = link;
      break;
    }
    if (textClean && (textClean.includes(targetClean) || targetClean.includes(textClean))) {
      partialMatches.push(link);
    }
  }

  if (exactMatch) {
    console.log(`\n✅ EXACT MATCH: "${exactMatch.text}" → ${exactMatch.href}`);
    return exactMatch.href;
  } else if (partialMatches.length > 0) {
    partialMatches.sort((a, b) => cleanStr(a.text).length - cleanStr(b.text).length);
    console.log(`\n🟡 PARTIAL MATCH: "${partialMatches[0].text}" → ${partialMatches[0].href}`);
    return partialMatches[0].href;
  } else if (allLinks.length > 0) {
    console.log(`\n⚠️  NO MATCH — using first result: "${allLinks[0].text}" → ${allLinks[0].href}`);
    return allLinks[0].href;
  } else {
    console.log(`\n❌ FAILED: No anime links found at all on the search results page!`);

    // Dump the page body for debugging
    const bodySnippet = await page.evaluate(() =>
      document.body?.innerText?.slice(0, 500)
    );
    console.log(`\n📄 Page body (first 500 chars):\n${bodySnippet}`);
    return null;
  }
}

async function run() {
  console.log('🚀 AnimeSuge Title Search Test');
  console.log(`   Testing ${TEST_TITLES.length} anime titles on ${BASE_URL}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      bypassCSP: true,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const page = await context.newPage();

    // First, check if animesuge.cz is reachable at all
    console.log('\n📡 Checking if animesuge.cz is accessible...');
    try {
      const resp = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log(`   Status: ${resp.status()} — Title: "${await page.title()}"`);
    } catch (e) {
      console.log(`   ❌ Cannot reach ${BASE_URL}: ${e.message}`);
      console.log('   The site may be blocked or down. Try using a VPN.');
      return;
    }

    const results = [];
    for (const title of TEST_TITLES) {
      const matched = await searchAnimeSuge(page, title);
      results.push({ title, matched: matched || null });
      // Small delay between searches
      await page.waitForTimeout(1500);
    }

    console.log('\n\n' + '='.repeat(60));
    console.log('📊 SEARCH RESULTS SUMMARY');
    console.log('='.repeat(60));
    results.forEach(({ title, matched }) => {
      const icon = matched ? '✅' : '❌';
      console.log(`${icon} "${title}" → ${matched || 'NOT FOUND'}`);
    });

    const successCount = results.filter((r) => r.matched).length;
    console.log(`\n🏆 Success rate: ${successCount}/${results.length} (${Math.round((successCount / results.length) * 100)}%)`);

    await context.close();
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
  } finally {
    await browser.close();
    console.log('\n✅ Browser closed.');
  }
}

run();
