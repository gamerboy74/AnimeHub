import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Apply stealth plugin to avoid detection
chromium.use(StealthPlugin());

let sharedBrowser = null;
const maxConcurrency = parseInt(process.env.SCRAPER_MAX_CONCURRENCY || "5", 10);
let activeCount = 0;
const queue = [];

// Circuit breaker for scraper
let breakerFailures = 0;
let breakerOpenedAt = 0;
const BREAKER_THRESHOLD = parseInt(
  process.env.SCRAPER_BREAKER_THRESHOLD || "8",
  10
);
const BREAKER_COOLDOWN_MS = parseInt(
  process.env.SCRAPER_BREAKER_COOLDOWN_MS || "30000",
  10
);

export async function getBrowser() {
  try {
    if (sharedBrowser) {
      if (typeof sharedBrowser.newContext === "function") {
        return sharedBrowser;
      } else {
        console.log("⚠️ Shared browser is invalid, resetting...");
        sharedBrowser = null;
      }
    }
    console.log("🔄 Launching new browser instance...");

    const launchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    };

    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
      console.log(`Using Chromium at: ${launchOptions.executablePath}`);
    } else if (process.platform === "linux") {
      launchOptions.executablePath = "/usr/bin/chromium-browser";
      console.log(`Using Chromium at: ${launchOptions.executablePath}`);
    } else {
      console.log("Using Playwright's bundled Chromium");
    }

    sharedBrowser = await chromium.launch(launchOptions);
    if (!sharedBrowser) {
      throw new Error("chromium.launch() returned null/undefined");
    }
    console.log("✅ Browser instance created successfully");
    return sharedBrowser;
  } catch (error) {
    console.error("❌ Failed to get browser:", error);
    sharedBrowser = null;
    throw error;
  }
}

export function enqueue(task, priority = "low") {
  return new Promise((resolve, reject) => {
    if (breakerOpenedAt && Date.now() - breakerOpenedAt < BREAKER_COOLDOWN_MS) {
      return reject(
        new Error("Scraper temporarily unavailable (circuit open)")
      );
    }
    const run = async () => {
      activeCount++;
      try {
        const result = await task();
        breakerFailures = 0;
        breakerOpenedAt = 0;
        resolve(result);
      } catch (e) {
        breakerFailures++;
        if (breakerFailures >= BREAKER_THRESHOLD) {
          breakerOpenedAt = Date.now();
        }
        reject(e);
      } finally {
        activeCount--;
        if (queue.length > 0) {
          const next = queue.shift();
          next();
        }
      }
    };

    if (activeCount < maxConcurrency) {
      void run();
    } else {
      if (priority === "high") {
        console.log(`⚡ Scraper Queue: Preempting queue with HIGH priority task. Queue length: ${queue.length}`);
        queue.unshift(run);
      } else {
        queue.push(run);
      }
    }
  });
}

export async function closeBrowser() {
  if (sharedBrowser) {
    console.log("🔄 Closing shared browser instance...");
    try {
      await sharedBrowser.close();
      console.log("✅ Shared browser closed successfully");
    } catch (e) {
      console.error("❌ Failed to close browser:", e.message);
    } finally {
      sharedBrowser = null;
    }
  }
}

