import { chromium } from "playwright";
import { AnimeSugeScraperService } from "../server/scrapers/animesuge.js";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const matchedUrl = await AnimeSugeScraperService.searchAnimeUrl(page, "Fairy Tail: Phoenix Priestess", {
      dbAnimeId: "7ff0c7a5-3309-4e6a-9b13-7ad257d4756e"
    });
    console.log("SUCCESS! Matched URL:", matchedUrl);
  } catch (err) {
    console.error("FAILED:", err.message);
  } finally {
    await browser.close();
  }
}
main();
