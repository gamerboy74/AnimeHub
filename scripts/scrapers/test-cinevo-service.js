/**
 * Integration test for CinevoScraperService class.
 * Compiles and executes the scraper class directly, checking title resolution,
 * hydration, Radix combobox manipulation, and iframe capture.
 *
 * Run: node server/scrapers/test-cinevo-service.js
 */

import { CinevoScraperService } from "../../server/scrapers/cinevo.js";

async function run() {
  console.log("═".repeat(60));
  console.log("  🧪  CINEVO SCRAPER SERVICE DIRECT INTEGRATION TEST");
  console.log("═".repeat(60));

  const title = "Naruto";
  const episode = 1;

  console.log(`🎬 Triggering scrape for: "${title}" Episode ${episode}...`);

  const result = await CinevoScraperService.scrapeAnimeEpisode(title, episode, {
    timeout: 50000,
    retries: 1,
    lang: "sub",
    season: 1
  });

  console.log("\n" + "═".repeat(60));
  console.log("  📊  SCRAPER RESPONSE RESULTS:");
  console.log("═".repeat(60));
  console.log(JSON.stringify(result, null, 2));

  if (result.success && result.episodeData?.sources?.length > 0) {
    console.log("\n🎉 SERVICE INTEGRATION TEST PASSED!");
    process.exit(0);
  } else {
    console.log("\n❌ SERVICE INTEGRATION TEST FAILED!");
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal exception during service test:", err);
  process.exit(1);
});
