import { supabase } from '../config/supabase.js';
import { episodeQueue, redisClient } from './bull-queue.js';
import stateManager from './state-manager.js';
import episodeWorker from './episode-worker.js';
import axios from 'axios';

export class ProductionScheduler {
  constructor() {
    const t = (k, d) => (process.env[k] || '').trim() || d;

    this.enabled = t('SCHEDULER_ENABLED', 'true') === 'true';
    this.episodeCheckIntervalMs = parseInt(t('SCHEDULER_EPISODE_CHECK_INTERVAL_HOURS', '6')) * 60 * 60 * 1000;
    this.metadataSyncIntervalMs = parseInt(t('SCHEDULER_NEW_ANIME_CHECK_INTERVAL_HOURS', '24')) * 60 * 60 * 1000;
    this.rateLimit = parseInt(t('SCHEDULER_RATE_LIMIT_EPISODES_PER_HOUR', '30'));
    this.minRating = parseFloat(t('SCHEDULER_MIN_ANIME_RATING', '5.0'));

    this.episodeTimer = null;
    this.metadataTimer = null;
    this.workerRegistered = false;
    this.running = {
      episodes: false,
      metadata: false,
    };
    this.lastRun = {
      episodes: null,
      metadata: null,
    };
  }

  /**
   * Initialize and start schedulers
   */
  async start() {
    if (!this.enabled) {
      console.log('⏸️  Scheduler disabled (SCHEDULER_ENABLED != true)');
      return;
    }

    console.log('🚀 Starting Production Scheduler with Bull Queue');

    // Register worker
    await this.registerWorker();

    // Start episode checker
    this.startEpisodeChecker();

    // Start metadata sync
    this.startMetadataSync();

    console.log('✅ Production schedulers started');
  }

  /**
   * Register Bull worker (4 concurrent workers)
   */
  async registerWorker() {
    if (this.workerRegistered) {
      console.log('👷 Episode worker already registered, skipping duplicate registration');
      return;
    }

    episodeQueue.process(4, async (job) => {
      return episodeWorker.processJob(job);
    });

    this.workerRegistered = true;
    console.log('👷 Episode worker registered (4 concurrent)');
  }

  /**
   * Start episode check scheduler
   */
  startEpisodeChecker() {
    const runCheck = async () => {
      if (this.running.episodes) {
        console.log('⏳ Episode checker: previous run still active, skipping');
        return;
      }

      this.running.episodes = true;
      const startTime = Date.now();

      try {
        console.log('🔄 Episode checker: scanning database...');
        const queued = await this.enqueueNewEpisodes();
        const elapsed = Date.now() - startTime;
        console.log(
          `✅ Episode checker done (${Math.round(elapsed / 1000)}s): queued ${queued} episodes`
        );
        this.lastRun.episodes = new Date().toISOString();
      } catch (err) {
        console.error('❌ Episode checker error:', err.message);
      } finally {
        this.running.episodes = false;
      }
    };

    // First run after 30s (let server stabilize)
    setTimeout(async () => {
      await runCheck();
      // Align to top of the hour
      const now = new Date();
      const intervalHours = this.episodeCheckIntervalMs / 3600000;
      const nextAligned = Math.ceil((now.getHours() + 0.001) / intervalHours) * intervalHours % 24;
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), nextAligned, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      const msUntilNext = target - now;
      console.log(`⏰ Next episode check in ${Math.round(msUntilNext / 60000)} minutes`);
      this.episodeTimer = setInterval(runCheck, this.episodeCheckIntervalMs);
    }, 30 * 1000);

    console.log(`⏰ Episode checker scheduled every ${this.episodeCheckIntervalMs / 3600000}h`);
  }

  /**
   * Start metadata sync scheduler
   */
  startMetadataSync() {
    const runSync = async () => {
      if (this.running.metadata) {
        console.log('⏳ Metadata sync: previous run still active, skipping');
        return;
      }

      this.running.metadata = true;
      const startTime = Date.now();

      try {
        console.log('🔄 Metadata sync: updating ongoing anime...');
        const updated = await this.syncMetadata();
        const elapsed = Date.now() - startTime;
        console.log(`✅ Metadata sync done (${Math.round(elapsed / 1000)}s): updated ${updated} anime`);
        this.lastRun.metadata = new Date().toISOString();
      } catch (err) {
        console.error('❌ Metadata sync error:', err.message);
      } finally {
        this.running.metadata = false;
      }
    };

    // First run at 3 AM, then daily
    const syncHour = parseInt(process.env.SCHEDULER_NEW_ANIME_SYNC_HOUR || '3');
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), syncHour, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const msUntilTarget = target - now;

    console.log(`⏰ Metadata sync scheduled for ${syncHour}:00 (in ${Math.round(msUntilTarget / 60000)} minutes)`);

    setTimeout(() => {
      runSync();
      this.metadataTimer = setInterval(runSync, this.metadataSyncIntervalMs);
    }, msUntilTarget);
  }

  /**
   * Scan database and enqueue missing episodes
   */
  async enqueueNewEpisodes() {
    const locked = await stateManager.acquireLock();
    if (!locked) {
      console.log('🔒 Enqueuer: lock already held, skipping batch');
      return 0;
    }

    try {
      // Get all anime that need episodes
      const { data: allAnime, error } = await supabase
        .from('anime')
        .select('id, title, title_english, status, total_episodes, rating')
        .order('rating', { ascending: false });

      if (error || !allAnime) {
        throw new Error(`Database query failed: ${error?.message}`);
      }

      // Find which episodes already have video URLs and servers
      const animeIds = allAnime.map((a) => a.id);
      const { data: existingEpisodes } = await supabase
        .from('episodes')
        .select('anime_id, episode_number, video_url, video_servers, created_at')
        .in('anime_id', animeIds);

      // We want to ensure episodes have a minimum number of servers (e.g. at least 2 servers)
      // to have backups. If they have fewer, we'll re-scrape them, but only after a cooldown
      // of 24 hours since the last attempt to avoid spamming.
      const minServers = parseInt(process.env.SCHEDULER_MIN_SERVERS || '2', 10);
      const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours cooldown
      const nowMs = Date.now();

      const scrapedMap = new Map();
      for (const ep of existingEpisodes || []) {
        if (!scrapedMap.has(ep.anime_id)) scrapedMap.set(ep.anime_id, new Set());

        const serversCount = Array.isArray(ep.video_servers) ? ep.video_servers.length : 0;
        const lastScrapedMs = ep.created_at ? new Date(ep.created_at).getTime() : 0;
        const isCooldownActive = (nowMs - lastScrapedMs) < cooldownMs;

        // An episode is considered complete and skipped if:
        // 1. It has a primary video URL AND
        // 2. Either it meets the min servers target OR it's still in the 24h cooldown period
        if (ep.video_url && (serversCount >= minServers || isCooldownActive)) {
          scrapedMap.get(ep.anime_id).add(ep.episode_number);
        }
      }

      // Filter anime that need episodes
      const needsEpisodes = allAnime.filter((a) => {
        const scrapedEps = scrapedMap.get(a.id) || new Set();
        if (a.status === 'ongoing') return true;
        if (scrapedEps.size === 0) return true;
        if (a.total_episodes && scrapedEps.size < a.total_episodes) return true;
        return false;
      });

      console.log(
        `📋 Found ${needsEpisodes.length} anime needing episodes (${needsEpisodes.filter((a) => a.status === 'ongoing').length} ongoing)`
      );

      const rateLimitStatus = await stateManager.getRateLimitStatus(this.rateLimit);
      console.log(`💨 Rate limit: ${rateLimitStatus.used}/${rateLimitStatus.limit} used`);

      if (rateLimitStatus.used >= this.rateLimit) {
        console.log(`⚠️  Rate limit is already exhausted (${rateLimitStatus.used}/${this.rateLimit}), stopping batch early`);
        await stateManager.releaseLock();
        return 0;
      }

      let queued = 0;
      for (const anime of needsEpisodes) {
        const scrapedEps = scrapedMap.get(anime.id) || new Set();
        let startEp = 1;
        for (let ep = 1; ep <= 1000; ep++) {
          if (!scrapedEps.has(ep)) {
            startEp = ep;
            break;
          }
        }

        // For ongoing anime:
        // - If we already have scraped episodes, only check the single next one (startEp)
        // - If we have 0 scraped episodes, check at most startEp + 1 to catch double-episode premiers
        const endEp = anime.status === 'ongoing'
          ? (scrapedEps.size > 0 ? startEp : startEp + 1)
          : (anime.total_episodes || startEp + 10);

        for (let ep = startEp; ep <= endEp; ep++) {
          // Check rate limit before incrementing to avoid over-inflating Redis counter when full
          const currentUsed = await stateManager.getRateLimitCount();
          if (currentUsed >= this.rateLimit) {
            console.log(`⚠️  Rate limit hit (${this.rateLimit}/hr), stopping batch`);
            await stateManager.releaseLock();
            return queued;
          }

          // Increment rate limit counter
          await stateManager.incrementRateLimit();

          // Enqueue with priority based on rating
          await episodeQueue.add(
            { animeId: anime.id, episodeNumber: ep },
            {
              priority: Math.round(anime.rating || 0), // Higher rating = higher priority
              delay: queued * 1000, // Stagger enqueueing by 1s each
            }
          );

          queued++;
        }
      }

      return queued;
    } finally {
      await stateManager.releaseLock();
    }
  }

  /**
   * Sync metadata for ongoing anime from Jikan
   */
  async syncMetadata() {
    const { data: ongoingAnime, error } = await supabase
      .from('anime')
      .select('id, title, title_english, mal_id, status, rating, total_episodes')
      .eq('status', 'ongoing');

    if (error || !ongoingAnime) {
      throw new Error(`Failed to fetch ongoing anime: ${error?.message}`);
    }

    console.log(`📋 Syncing metadata for ${ongoingAnime.length} ongoing anime`);

    let updated = 0;
    for (const anime of ongoingAnime) {
      if (!anime.mal_id) continue;

      try {
        const res = await axios.get(`https://api.jikan.moe/v4/anime/${anime.mal_id}`);
        const jikanData = res.data?.data;

        if (!jikanData) continue;

        const updates = {};

        // Map status
        let mappedStatus = anime.status;
        if (jikanData.status === 'Currently Airing') mappedStatus = 'ongoing';
        else if (jikanData.status === 'Finished Airing') mappedStatus = 'completed';
        if (mappedStatus !== anime.status) updates.status = mappedStatus;

        // Check rating change (±0.05 tolerance)
        if (jikanData.score && Math.abs(jikanData.score - anime.rating) > 0.05) {
          updates.rating = jikanData.score;
        }

        // Check episode count change
        if (jikanData.episodes && jikanData.episodes !== anime.total_episodes) {
          updates.total_episodes = jikanData.episodes;
        }

        if (Object.keys(updates).length > 0) {
          await supabase
            .from('anime')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', anime.id);

          updated++;
          console.log(`  ✏️  "${anime.title_english || anime.title}": ${JSON.stringify(updates)}`);
        }

        // Be nice to Jikan API (1.5s delay)
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        console.warn(`  ⚠️  Failed to sync "${anime.title_english || anime.title}": ${err.message}`);
      }
    }

    return updated;
  }

  /**
   * Stop all schedulers
   */
  async stop() {
    console.log('🛑 Stopping Production Scheduler...');
    if (this.episodeTimer) clearInterval(this.episodeTimer);
    if (this.metadataTimer) clearInterval(this.metadataTimer);
    await episodeQueue.close();
    console.log('✅ Scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  async getStatus() {
    const queueCounts = await episodeQueue.getJobCounts();
    const stats = await stateManager.getAllScraperStats();
    const rateLimitStatus = await stateManager.getRateLimitStatus(this.rateLimit);

    return {
      enabled: this.enabled,
      running: this.running.episodes || this.running.metadata,
      lastRun: this.lastRun.episodes,
      nextRun: this.enabled ? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() : null, // estimated fallback
      checkIntervalHours: this.episodeCheckIntervalMs / 3600000,
      maxConcurrent: 4,
      rateLimit: rateLimitStatus.limit,
      scrapedThisHour: rateLimitStatus.used,
      lastResults: null, // safe to be null
      queue: {
        ...queueCounts,
        stats,
      },
    };
  }
}

export const productionScheduler = new ProductionScheduler();
export default productionScheduler;
