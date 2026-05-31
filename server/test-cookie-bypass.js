import { chromium } from "playwright";
import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATE_PATH = join(__dirname, "cf-state.json");

async function extractClearanceCookies() {
  console.log("🔌 Connecting to your running Chrome browser via CDP on port 9222...");
  console.log("💡 Tip: Make sure you launched Chrome with: --remote-debugging-port=9222 --user-data-dir=\"C:\\Users\\gboy3\\chrome-dev-profile\"");
  
  let cdpBrowser;
  try {
    cdpBrowser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    console.log("✅ Connected successfully to Chrome!");

    const contexts = cdpBrowser.contexts();
    if (contexts.length === 0) {
      throw new Error("No active browser contexts found in the running Chrome instance.");
    }
    const context = contexts[0];
    
    // Create or locate a page
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    console.log("🌐 Navigating to Re:ANIME home page...");
    await page.goto("https://reanime.to", { waitUntil: "domcontentloaded", timeout: 45000 });

    console.log("\n👀 Please look at your open Chrome window!");
    console.log("👉 If there is a Cloudflare 'Verify you are human' checkbox, please click it.");
    console.log("👉 Waiting for page to fully load after verification...");

    // Wait up to 60 seconds for verification to complete and title/URL to change
    let solved = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      const title = await page.title().catch(() => "");
      const hasTurnstile = (await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null)) || 
                           (await page.$('[name="cf-turnstile-response"]').catch(() => null)) ||
                           title.includes("Just a moment...");
      
      if (!hasTurnstile && title && !title.includes("Just a moment...")) {
        console.log(`\n🎉 Success! Detected page solved. Current Title: "${title}"`);
        solved = true;
        break;
      }
      process.stdout.write(".");
    }

    if (!solved) {
      console.log("\n⚠️ Timeout waiting for Cloudflare solution. Will try saving current cookies anyway...");
    }

    // Capture user agent
    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log(`👤 Active User-Agent: "${userAgent}"`);

    // Capture Playwright storage state
    const storageState = await context.storageState();
    
    // Save combined state file (cookies + userAgent)
    const combinedState = {
      userAgent,
      storageState
    };

    fs.writeFileSync(STATE_PATH, JSON.stringify(combinedState, null, 2));
    console.log(`\n💾 Saved Cloudflare clearance session and User-Agent to ${STATE_PATH}`);
    
    const cookies = storageState.cookies || [];
    const clearance = cookies.find(c => c.name === "cf_clearance");
    if (clearance) {
      console.log(`🎯 Found 'cf_clearance' cookie: value="${clearance.value.substring(0, 15)}..." (expires: ${new Date(clearance.expires * 1000).toLocaleString()})`);
    } else {
      console.warn("⚠️ Warning: 'cf_clearance' cookie was not found in the browser session. Try logging in or performing a action on the site.");
    }

  } catch (error) {
    console.error("❌ CDP Connection failed:", error.message);
    console.log("\n🔍 To fix this error:");
    console.log("1. Close all active Google Chrome windows completely.");
    console.log("2. Open PowerShell and run this command to start Chrome with debugging enabled:");
    console.log("   Start-Process \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" -ArgumentList \"--remote-debugging-port=9222 --user-data-dir=C:\\Users\\gboy3\\chrome-dev-profile\"");
    console.log("3. Run this script again.");
  } finally {
    if (cdpBrowser) {
      await cdpBrowser.close().catch(() => {});
    }
  }
}

extractClearanceCookies();
