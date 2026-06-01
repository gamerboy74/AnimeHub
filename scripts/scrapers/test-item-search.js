/**
 * Directly tests the .item-based title extraction used in the fixed scraper.
 * Run: node scripts/test-item-search.js
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const BASE_URL = 'https://animesuge.cz';
const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const TITLES = ['Naruto', 'Demon Slayer', 'Attack on Titan', 'One Piece'];

async function searchByTitle(page, title) {
  const url = `${BASE_URL}/filter?keyword=${encodeURIComponent(title)}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(2000);

  try { await page.waitForSelector('.item', { timeout: 5000 }); } catch (_) {}

  const links = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    document.querySelectorAll('.item').forEach((item) => {
      const link = item.querySelector('a[href*="/anime/"]');
      if (!link || !link.href || seen.has(link.href)) return;
      if (link.href.includes('/filter') || link.href.includes('/genre')) return;
      seen.add(link.href);

      const lines = (item.innerText || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 &&
            !/^\d+$/.test(l) &&
            !['TV', 'MOVIE', 'ONA', 'OVA', 'SPECIAL', 'MUSIC'].includes(l.toUpperCase())
        );
      results.push({ href: link.href, text: lines[lines.length - 1] || '' });
    });
    return results;
  });

  console.log(`\n--- Searching: "${title}" (${links.length} results) ---`);
  links.slice(0, 6).forEach((l, i) => console.log(`  [${i + 1}] "${l.text}" → ${l.href}`));

  const target = cleanStr(title);
  let exactMatch = null;
  const partial = [];

  for (const l of links) {
    const tc = cleanStr(l.text);
    if (tc === target) { exactMatch = l; break; }
    if (tc && (tc.includes(target) || target.includes(tc))) partial.push(l);
  }

  if (exactMatch) {
    console.log(`  ✅ EXACT: "${exactMatch.text}"`);
    return exactMatch.href;
  }
  if (partial.length > 0) {
    partial.sort((a, b) => cleanStr(a.text).length - cleanStr(b.text).length);
    console.log(`  🟡 PARTIAL: "${partial[0].text}" (shortest of ${partial.length} matches)`);
    return partial[0].href;
  }
  if (links.length > 0) {
    console.log(`  ⚠️  FALLBACK: "${links[0].text}"`);
    return links[0].href;
  }
  console.log(`  ❌ NO RESULTS`);
  return null;
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  const page = await ctx.newPage();

  console.log('🔬 Testing .item-based AnimeSuge title search (scraper logic)');

  const results = [];
  for (const title of TITLES) {
    const href = await searchByTitle(page, title);
    results.push({ title, href });
    await page.waitForTimeout(800);
  }

  console.log('\n\n==== SUMMARY ====');
  results.forEach(({ title, href }) => {
    console.log(href ? `✅ "${title}" → ${href}` : `❌ "${title}" → NOT FOUND`);
  });
  const ok = results.filter((r) => r.href).length;
  console.log(`\n🏆 ${ok}/${results.length} titles found`);

  await ctx.close();
  await browser.close();
}

run().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
