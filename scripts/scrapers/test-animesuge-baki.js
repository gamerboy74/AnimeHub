import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import { extractSeasonNumber } from '../../server/utils/seasonExtractor.js';

dotenv.config();
chromium.use(StealthPlugin());

const BASE_URL = 'https://animesuge.cz';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getCoreTitle(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/(?:season\s*\d+|s\d+|\d+(?:nd|rd|th|st)?\s*season|\d+(?:nd|rd|th|st)?\s*sseason)/gi, "")
    .replace(/\b(?:i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*$/i, "")
    .replace(/\b\d+\b\s*$/gi, "")
    .replace(/\b(?:dub|sub|uncensored|uncut|tv|dual[- ]audio|uncut)\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

async function testSearch(titleToSearch) {
  console.log(`\n🔍 Searching AnimeSuge for: "${titleToSearch}"`);
  
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
    const searchUrl = `${BASE_URL}/filter?keyword=${encodeURIComponent(titleToSearch)}`;
    console.log(`🔗 Navigating to search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Extract links + titles from .item containers.
    const animeLinks = await page.evaluate(() => {
      const seen = new Set();
      const results = [];

      document.querySelectorAll(".item").forEach((item) => {
        const link = item.querySelector('a[href*="/anime/"]');
        if (!link || !link.href || seen.has(link.href)) return;
        if (link.href.includes("/filter") || link.href.includes("/genre")) return;
        seen.add(link.href);

        const lines = (item.innerText || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(
            (l) =>
              l.length > 0 &&
              !/^\d+$/.test(l) &&
              !["TV", "MOVIE", "ONA", "OVA", "SPECIAL", "MUSIC"].includes(l.toUpperCase())
          );

        const titleText = lines[lines.length - 1] || "";
        results.push({ href: link.href, text: titleText });
      });

      return results;
    });

    console.log(`📋 Found ${animeLinks.length} total results on page:`);
    animeLinks.slice(0, 8).forEach((l, i) =>
      console.log(`   [${i + 1}] "${l.text}" → ${l.href}`)
    );

    const targetSeason = extractSeasonNumber(titleToSearch);
    const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const sortWords = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");
    
    const targetClean = cleanStr(titleToSearch);
    const targetSorted = sortWords(titleToSearch);
    const targetCore = getCoreTitle(titleToSearch);

    console.log(`\nℹ️ Target Metrics:`);
    console.log(`   - Season: ${targetSeason}`);
    console.log(`   - Clean String: "${targetClean}"`);
    console.log(`   - Sorted Words: "${targetSorted}"`);
    console.log(`   - Core Title:   "${targetCore}"`);

    let exactMatch = null;
    let reorderMatch = null;
    let coreMatch = null;

    console.log('\n--- Evaluating Candidates ---');
    for (const link of animeLinks) {
      const resultSeason = extractSeasonNumber(link.text);
      if (targetSeason !== resultSeason) {
        console.log(`  ⏭️ Skipping "${link.text}" - Season mismatch (${resultSeason} vs ${targetSeason})`);
        continue;
      }

      const textClean = cleanStr(link.text);
      const textSorted = sortWords(link.text);
      const textCore = getCoreTitle(link.text);

      console.log(`  Checking result: "${link.text}"`);
      console.log(`     - Clean: "${textClean}"`);
      console.log(`     - Sorted: "${textSorted}"`);
      console.log(`     - Core:   "${textCore}"`);

      // 1. Direct exact clean match
      if (textClean === targetClean) {
        exactMatch = link;
        console.log(`     👉 MATCH TYPE: EXACT!`);
        break;
      }

      // 2. Token-sorted word match
      if (textSorted === targetSorted && targetSorted !== "") {
        reorderMatch = link;
        console.log(`     👉 MATCH TYPE: REORDER (Exact match on word ordering)!`);
      }

      // 3. Core exact match
      if (textCore === targetCore && targetCore !== "") {
        coreMatch = link;
        console.log(`     👉 MATCH TYPE: CORE!`);
      }
    }

    const finalMatch = exactMatch || reorderMatch || coreMatch;
    console.log('\n======================================================');
    console.log(`🏁 FINAL SCORING DECISION:`);
    if (finalMatch) {
      console.log(`   ✅ SUCCESS: Matched with "${finalMatch.text}" → ${finalMatch.href}`);
    } else {
      console.log(`   ❌ FAILED: No matches found under new exact/reorder constraints.`);
    }
    console.log('======================================================');

  } catch (err) {
    console.error('❌ Error during search:', err.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  await testSearch('Baki Hanma VS Kengan Ashura');
}

main();
