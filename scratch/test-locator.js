import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();
chromium.use(StealthPlugin());

async function testLocator(lang) {
  console.log(`\n🚀 Testing visible-only locator for lang: ${lang}...`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://reanime.to/watch/wistoria-wand-and-sword-season-2-59cjjy?ep=1&lang=' + lang, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(6000);

    const langLabel = lang === 'dub' ? 'DUB' : 'SUB';
    
    // Find all visible spans matching our language label precisely
    const spans = page.locator('span').filter({ hasText: new RegExp(`^\\s*${langLabel}\\s*:?\\s*$`, 'i') }).filter({ visible: true });
    const spanCount = await spans.count();
    console.log(`🔍 Found ${spanCount} visible matching spans for ${langLabel}`);

    for (let sIdx = 0; sIdx < spanCount; sIdx++) {
      const span = spans.nth(sIdx);
      const spanText = await span.innerText();
      
      // Get the immediate parent of this span
      const parent = span.locator('..');
      const parentTagName = await parent.evaluate(el => el.tagName);
      const parentClassName = await parent.evaluate(el => el.className);
      const parentText = await parent.innerText();
      
      console.log(`  [Span #${sIdx}] Text: "${spanText}" -> Parent: <${parentTagName} class="${parentClassName}"> Text: "${parentText.replace(/\n/g, ' ')}"`);
      
      // Get buttons inside this parent
      const buttons = parent.locator('button');
      const btnCount = await buttons.count();
      console.log(`  🎯 Buttons inside parent (${btnCount}):`);
      for (let bIdx = 0; bIdx < btnCount; bIdx++) {
        const text = await buttons.nth(bIdx).innerText();
        console.log(`    - Button #${bIdx}: "${text}"`);
      }
    }
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await browser.close();
  }
}

async function run() {
  await testLocator('sub');
  await testLocator('dub');
}

run();
