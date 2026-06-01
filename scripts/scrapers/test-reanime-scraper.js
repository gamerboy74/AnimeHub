import { ReAnimeScraperService } from "../../server/scrapers/reanime.js";
import { closeBrowser } from "../../server/services/queue.js";

async function runTest() {
  console.log("🚀 Testing updated Re:ANIME scraper with Cloudflare persistence & Turnstile auto-solve...");
  
  const animeTitle = "Classroom of the Elite Season 3";
  const episodeNumber = 1;
  
  try {
    const result = await ReAnimeScraperService.scrapeAnimeEpisode(animeTitle, episodeNumber, {
      lang: "sub",
      timeout: 30000,
      retries: 1
    });
    
    console.log("\n🏁 Scraping Results:");
    console.log("-----------------------------------------");
    console.log(`Success: ${result.success}`);
    if (result.success) {
      console.log(`Watch URL: ${result.watchUrl}`);
      console.log(`Stream URL: ${result.streamUrl}`);
      console.log(`Sources Count: ${result.episodeData?.sourceCount}`);
      console.log("Sources:", JSON.stringify(result.episodeData?.sources, null, 2));
    } else {
      console.log(`Error: ${result.error}`);
    }
    console.log("-----------------------------------------");

  } catch (error) {
    console.error("❌ Critical test failure:", error);
  } finally {
    console.log("🔌 Closing browser process...");
    await closeBrowser();
  }
}

runTest();
