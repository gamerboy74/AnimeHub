import { supabase } from '../config/supabase.js';
import { scrapeAndSaveEpisode } from '../scrapers/manager.js';
import stateManager from './state-manager.js';
import crypto from 'crypto';

export class EpisodeWorker {
  constructor() {
    this.scrapers = ['gogoanime', 'nineanime', 'animesuge', 'reanime'];
  }

  /**
   * Main worker function - called by Bull for each job
   */
  async processJob(job) {
    const { animeId, episodeNumber } = job.data;
    const startTime = Date.now();

    try {
      console.log(`🎬 Processing job ${job.id}: anime=${animeId} ep=${episodeNumber}`);

      // Fetch anime
      const { data: anime, error } = await supabase
        .from('anime')
        .select('id, title, title_english, total_episodes, status, scraper_urls, poster_url')
        .eq('id', animeId)
        .single();

      if (error || !anime) {
        throw new Error(`Anime not found: ${animeId}`);
      }

      // Scrape and save (uses all 4 scrapers internally)
      const result = await scrapeAndSaveEpisode(anime, episodeNumber);

      if (!result.success) {
        // No streams found - this is expected for future episodes
        const elapsed = Date.now() - startTime;
        console.log(`⚠️  No streams found for "${anime.title}" EP${episodeNumber} (${elapsed}ms)`);
        return {
          success: false,
          reason: 'no_streams',
          episodeNumber,
          elapsed,
        };
      }

      const elapsed = Date.now() - startTime;
      console.log(
        `✅ Successfully scraped "${anime.title}" EP${episodeNumber}: ${result.serversCount} servers (${elapsed}ms)`
      );

      // Record success metrics
      await stateManager.recordScraperSuccess('all-scrapers', elapsed);

      return {
        success: true,
        episodeNumber,
        serversCount: result.serversCount,
        elapsed,
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`❌ Job ${job.id} failed: ${err.message}`);

      // Record failure
      await stateManager.recordScraperFailure('all-scrapers', err.name || 'unknown');

      throw err; // Bull will handle retries
    }
  }

  /**
   * Scrape episode with timeout protection
   */
  async scrapeWithTimeout(scraper, anime, episodeNumber, timeoutMs) {
    return Promise.race([
      scraper.scrape(anime, episodeNumber),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${scraper.name} timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Deduplicate streams by URL
   */
  deduplicateStreams(streams) {
    const seen = new Set();
    return streams.filter((s) => {
      const hash = crypto.createHash('md5').update(s.url || '').digest('hex');
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }
}

export default new EpisodeWorker();
