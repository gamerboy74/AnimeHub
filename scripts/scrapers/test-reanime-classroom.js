import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import { extractSeasonNumber } from '../../server/utils/seasonExtractor.js';

dotenv.config();
chromium.use(StealthPlugin());

const BASE_URL = 'https://reanime.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function cleanStr(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCoreTitle(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    // Remove season patterns: "season 3", "3rd season", "3rd sseason", "s3", etc.
    .replace(/(?:season\s*\d+|s\d+|\d+(?:nd|rd|th|st)?\s*season|\d+(?:nd|rd|th|st)?\s*sseason)/gi, "")
    // Remove roman numerals at the end of word or title (e.g. "iii", "ii", "iv", "v", "i")
    .replace(/\b(?:i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*$/i, "")
    // Remove arabic numbers at the end (e.g. "3", "2", "4")
    .replace(/\b\d+\b\s*$/gi, "")
    // Remove common subtitle/metadata tags
    .replace(/\b(?:dub|sub|uncensored|uncut|tv|dual[- ]audio|uncut)\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]/g, "") // Keep alphanumeric only
    .trim();
}

async function testSearch(titleToSearch) {
  console.log(`\n🔍 Searching Re:ANIME for: "${titleToSearch}"`);
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      bypassCSP: true,
      javaScriptEnabled: true
    });

    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    let searchInput = await page.$('input[placeholder*="Search" i], input[type="search"], input[name="search"]');
    if (!searchInput) {
      searchInput = await page.$('input[type="text"]');
    }

    if (!searchInput) {
      throw new Error('Could not find search input');
    }

    await searchInput.click();
    await searchInput.fill('');
    await searchInput.type(titleToSearch, { delay: 50 });
    await page.waitForTimeout(500);
    await searchInput.press('Enter');

    console.log('⏳ Waiting for search results...');
    await page.waitForTimeout(5000);

    const links = await page.$$eval('a', el => el.map(a => ({
      href: a.href,
      text: a.innerText
    })));

    const animeLinks = links.filter(l => l.href && (l.href.includes('/anime/') || l.href.includes('/watch/')));
    console.log(`🔗 Found ${animeLinks.length} potential links:`);
    for (const link of animeLinks) {
      console.log(`  - Link text: "${link.text}" -> ${link.href}`);
    }

    const targetSeason = extractSeasonNumber(titleToSearch);
    const targetClean = cleanStr(titleToSearch);
    const targetCore = getCoreTitle(titleToSearch);

    console.log(`ℹ️ Target: Season=${targetSeason}, Clean="${targetClean}", Core="${targetCore}"`);

    // Old matching algorithm
    console.log('\n--- Evaluating Old Matching Algorithm ---');
    let oldMatch = null;
    for (const link of animeLinks) {
      const resultSeason = extractSeasonNumber(link.text);
      if (targetSeason !== resultSeason) {
        console.log(`  ⏭️ Skipping "${link.text}" - Season mismatch (${resultSeason} vs ${targetSeason})`);
        continue;
      }
      const textClean = cleanStr(link.text);
      if (textClean && (textClean.includes(targetClean) || targetClean.includes(textClean))) {
        oldMatch = link;
        console.log(`  ✅ MATCH! "${link.text}"`);
        break;
      } else {
        console.log(`  ❌ MISMATCH (Text clean check failed): "${textClean}" vs "${targetClean}"`);
      }
    }
    console.log(`  Old Algorithm Result:`, oldMatch ? `SUCCESS: "${oldMatch.text}"` : 'FAILED');

    // New matching algorithm
    console.log('\n--- Evaluating New Matching Algorithm ---');
    let newMatch = null;
    for (const link of animeLinks) {
      const resultSeason = extractSeasonNumber(link.text);
      if (targetSeason !== resultSeason) {
        console.log(`  ⏭️ Skipping "${link.text}" - Season mismatch (${resultSeason} vs ${targetSeason})`);
        continue;
      }
      
      const textClean = cleanStr(link.text);
      const textCore = getCoreTitle(link.text);
      
      const isCoreMatch = textCore && (textCore.includes(targetCore) || targetCore.includes(textCore));
      const isCleanMatch = textClean && (textClean.includes(targetClean) || targetClean.includes(textClean));
      
      if (isCleanMatch || isCoreMatch) {
        newMatch = link;
        console.log(`  ✅ MATCH! "${link.text}" (CleanMatch=${isCleanMatch}, CoreMatch=${isCoreMatch})`);
        break;
      } else {
        console.log(`  ❌ MISMATCH: textCore="${textCore}" vs targetCore="${targetCore}"`);
      }
    }
    console.log(`  New Algorithm Result:`, newMatch ? `SUCCESS: "${newMatch.text}"` : 'FAILED');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  await testSearch('Classroom of the Elite III');
  await testSearch('Classroom of the Elite Season 3');
}

main();
