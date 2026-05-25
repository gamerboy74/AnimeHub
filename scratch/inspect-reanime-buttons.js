import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();
chromium.use(StealthPlugin());

async function inspect() {
  console.log('🚀 Launching chromium to inspect parent containers...');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://reanime.to/watch/wistoria-wand-and-sword-season-2-59cjjy?ep=1&lang=sub', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(6000);

    const result = await page.evaluate(() => {
      // Find all divs or containers that house the buttons
      const containers = Array.from(document.querySelectorAll('div')).filter(div => {
        const text = div.innerText || '';
        return text.includes('HD-2') && (text.includes('Sub') || text.includes('Dub') || div.querySelector('span'));
      });

      return containers.map((div, i) => {
        // Find any headers or spans inside this container
        const spans = Array.from(div.querySelectorAll('span')).map(s => s.innerText);
        const html = div.outerHTML.substring(0, 1000);
        return {
          i,
          class: div.className,
          spans,
          innerText: div.innerText?.substring(0, 300)
        };
      });
    });

    console.log('📦 Containers found:', result);
  } catch (err) {
    console.error('❌ Error during inspection:', err);
  } finally {
    await browser.close();
  }
}

inspect();
