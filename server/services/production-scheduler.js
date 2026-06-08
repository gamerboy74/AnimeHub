import { supabase } from '../config/supabase.js';
import { episodeQueue, redisClient } from './bull-queue.js';
import stateManager from './state-manager.js';
import episodeWorker from './episode-worker.js';
import axios from 'axios';
import { isEpisodeReleased } from '../utils/aniListScheduler.js';

export class ProductionScheduler {
  constructor() {
    const t = (k, d) => (process.env[k] || '').trim() || d;

    this.enabled = t('SCHEDULER_ENABLED', 'true') === 'true';
    this.episodeCheckIntervalMs = parseInt(t('SCHEDULER_EPISODE_CHECK_INTERVAL_HOURS', '6')) * 60 * 60 * 1000;
    this.metadataSyncIntervalMs = parseInt(t('SCHEDULER_NEW_ANIME_CHECK_INTERVAL_HOURS', '24')) * 60 * 60 * 1000;
    this.rateLimit = parseInt(t('SCHEDULER_RATE_LIMIT_EPISODES_PER_HOUR', '30'));
    this.minRating = parseFloat(t('SCHEDULER_MIN_ANIME_RATING', '5.0'));
    // Batch size for paginated DB fetch (avoids loading all anime into memory at once)
    this.dbBatchSize = parseInt(t('SCHEDULER_DB_BATCH_SIZE', '100'));

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
    // Track actual next run time so getStatus() returns correct value
    this.nextRunAt = {
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
        // Always update nextRunAt after each run so getStatus() is accurate
        this.nextRunAt.episodes = new Date(Date.now() + this.episodeCheckIntervalMs).toISOString();
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
      this.nextRunAt.episodes = target.toISOString();
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
        // Update next run time so getStatus() stays accurate after each run
        this.nextRunAt.metadata = new Date(Date.now() + this.metadataSyncIntervalMs).toISOString();
      }
    };

    // First run at 3 AM, then daily
    const syncHour = parseInt(process.env.SCHEDULER_NEW_ANIME_SYNC_HOUR || '3');
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), syncHour, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const msUntilTarget = target - now;

    console.log(`⏰ Metadata sync scheduled for ${syncHour}:00 (in ${Math.round(msUntilTarget / 60000)} minutes)`);

    // --- FIX: Store the computed target so getStatus() reports it correctly before first run ---
    this.nextRunAt.metadata = target.toISOString();

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
      // --- FIX: Paginated DB fetch instead of loading all anime at once ---
      // Fetches anime in batches of dbBatchSize to avoid memory spikes as library grows.
      const minServers = parseInt(process.env.SCHEDULER_MIN_SERVERS || '2', 10);
      const cooldownMs = 24 * 60 * 60 * 1000;
      const nowMs = Date.now();

      let queued = 0;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: animeBatch, error } = await supabase
          .from('anime')
          .select('id, title, title_english, status, total_episodes, rating')
          .order('rating', { ascending: false })
          .range(offset, offset + this.dbBatchSize - 1);

        if (error) throw new Error(`Database query failed: ${error?.message}`);
        if (!animeBatch || animeBatch.length === 0) break;

        hasMore = animeBatch.length === this.dbBatchSize;
        offset += animeBatch.length;

        // Fetch existing episodes only for this batch of anime IDs
        const batchIds = animeBatch.map((a) => a.id);
        const { data: existingEpisodes } = await supabase
          .from('episodes')
          .select('anime_id, episode_number, video_url, video_servers, created_at')
          .in('anime_id', batchIds);

        // Build a map: animeId -> Set of fully-scraped episode numbers
        const scrapedMap = new Map();
        for (const ep of existingEpisodes || []) {
          if (!scrapedMap.has(ep.anime_id)) scrapedMap.set(ep.anime_id, new Set());
          const serversCount = Array.isArray(ep.video_servers) ? ep.video_servers.length : 0;
          const lastScrapedMs = ep.created_at ? new Date(ep.created_at).getTime() : 0;
          const isCooldownActive = (nowMs - lastScrapedMs) < cooldownMs;
          // Episode is "done" if it has a URL AND (enough servers OR still in cooldown)
          if (ep.video_url && (serversCount >= minServers || isCooldownActive)) {
            scrapedMap.get(ep.anime_id).add(ep.episode_number);
          }
        }

        // Filter this batch down to anime that actually need work
        const needsEpisodes = animeBatch.filter((a) => {
          const scrapedEps = scrapedMap.get(a.id) || new Set();
          if (a.status === 'ongoing') return true;
          if (scrapedEps.size === 0) return true;
          if (a.total_episodes && scrapedEps.size < a.total_episodes) return true;
          return false;
        });

        if (offset === animeBatch.length) {
          // Only log on the first batch
          console.log(
            `📋 Found ${needsEpisodes.length} anime needing episodes in first batch (${needsEpisodes.filter((a) => a.status === 'ongoing').length} ongoing)`
          );
        }

        // Check rate limit status before processing this batch
        const rateLimitStatus = await stateManager.getRateLimitStatus(this.rateLimit);
        if (offset === animeBatch.length) {
          console.log(`💨 Rate limit: ${rateLimitStatus.used}/${rateLimitStatus.limit} used`);
        }
        if (rateLimitStatus.used >= this.rateLimit) {
          console.log(`⚠️  Rate limit is already exhausted (${rateLimitStatus.used}/${this.rateLimit}), stopping batch early`);
          return queued;
        }

        for (const anime of needsEpisodes) {
          const scrapedEps = scrapedMap.get(anime.id) || new Set();

          // --- FIX: Safe max-episode calculation that won't stack-overflow on large Sets ---
          // Math.max(...Set) uses spread which hits JS call stack limits on very large sets.
          // Using reduce() is O(n) but safe for any size.
          const startEp = scrapedEps.size === 0
            ? 1
            : [...scrapedEps].reduce((max, n) => (n > max ? n : max), 0) + 1;

          // For ongoing: only check next 1-2 eps; for finished: fill all gaps up to total
          const endEp = anime.status === 'ongoing'
            ? (scrapedEps.size > 0 ? startEp : startEp + 1)
            : (anime.total_episodes || startEp + 10);

          for (let ep = startEp; ep <= endEp; ep++) {
            // Smart AniList Airing Check
            if (anime.status === 'ongoing') {
              const airingStatus = await isEpisodeReleased(anime, ep);
              if (!airingStatus.released) {
                console.log(`  ⏳ Enqueue skipped for "${anime.title_english || anime.title}" EP ${ep}: ${airingStatus.reason}`);
                break;
              }
            }

            // --- FIX: Atomic increment-then-check to eliminate the race condition ---
            // Previously we did: read → check → increment (two round trips, window for races)
            // Now: increment first, then check — if we went over, decrement and stop.
            const newCount = await stateManager.incrementRateLimit();
            if (newCount > this.rateLimit) {
              // We over-shot the limit — undo that increment and stop
              await stateManager.decrementRateLimit();
              console.log(`⚠️  Rate limit hit (${this.rateLimit}/hr), stopping batch`);
              return queued;
            }

            // Enqueue with priority based on rating (higher rating = lower Bull priority number = runs first)
            await episodeQueue.add(
              { animeId: anime.id, episodeNumber: ep },
              {
                priority: Math.round(anime.rating || 0),
                delay: queued * 1000, // stagger 1s apart
              }
            );

            queued++;
          }
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

      // --- FIX: Retry Jikan calls with exponential backoff ---
      // Previously a single Jikan failure (429, timeout) silently skipped the anime.
      // Now we retry up to 3 times with 2s → 4s → 8s delays before giving up.
      const MAX_JIKAN_RETRIES = 3;
      let jikanData = null;

      for (let attempt = 1; attempt <= MAX_JIKAN_RETRIES; attempt++) {
        try {
          const res = await axios.get(`https://api.jikan.moe/v4/anime/${anime.mal_id}`, {
            timeout: 10000, // 10s hard timeout per request
          });
          jikanData = res.data?.data;
          break; // success — exit retry loop
        } catch (err) {
          const isLast = attempt === MAX_JIKAN_RETRIES;
          if (isLast) {
            console.warn(`  ⚠️  Jikan failed for "${anime.title_english || anime.title}" after ${MAX_JIKAN_RETRIES} attempts: ${err.message}`);
          } else {
            const backoffMs = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
            console.warn(`  ⚠️  Jikan attempt ${attempt}/${MAX_JIKAN_RETRIES} failed for "${anime.title_english || anime.title}": ${err.message} — retrying in ${backoffMs / 1000}s`);
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }

      if (!jikanData) continue;

      try {
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

        // Be nice to Jikan API (1.5s delay between successful requests)
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        console.warn(`  ⚠️  Failed to apply metadata update for "${anime.title_english || anime.title}": ${err.message}`);
      }
    }

    return updated;
  }

  /**
   * Enqueue episodes for a newly added anime immediately
   */
  async enqueueAnimeEpisodes(anime) {
    console.log(`🚀 Immediate enqueue triggered for newly added anime: "${anime.title_english || anime.title}"`);
    
    const startEp = 1;
    const endEp = anime.status === 'ongoing' ? 2 : (anime.total_episodes || 12);

    let queued = 0;
    for (let ep = startEp; ep <= endEp; ep++) {
      // Smart AniList Airing Check
      if (anime.status === 'ongoing') {
        const airingStatus = await isEpisodeReleased(anime, ep);
        if (!airingStatus.released) {
          console.log(`  ⏳ Immediate enqueue skipped for newly added "${anime.title_english || anime.title}" EP ${ep}: ${airingStatus.reason}`);
          break; // Skip subsequent episodes since they are not released yet
        }
      }

      // --- FIX: Atomic increment-then-check (same pattern as enqueueNewEpisodes) ---
      // Old code: getRateLimitCount() → check → incrementRateLimit() had a race window.
      // New code: increment first, if we overshot decrement and stop.
      const newCount = await stateManager.incrementRateLimit();
      if (newCount > this.rateLimit) {
        await stateManager.decrementRateLimit();
        console.warn(`⚠️ Rate limit reached, skipping further immediate enqueuing for EP ${ep}`);
        break;
      }

      // Enqueue to Bull queue with high priority
      await episodeQueue.add(
        { animeId: anime.id, episodeNumber: ep },
        {
          priority: 10, // Higher priority for manual/new additions
          delay: queued * 1000,
        }
      );
      queued++;
    }
    console.log(`✅ Immediate enqueuing completed: enqueued ${queued} jobs for "${anime.title}"`);
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
      lastRun: {
        episodes: this.lastRun.episodes,
        metadata: this.lastRun.metadata,
      },
      nextRun: {
        // Episodes: use tracked value, fall back to estimated if not yet set
        episodes: this.nextRunAt.episodes ?? (this.enabled ? new Date(Date.now() + this.episodeCheckIntervalMs).toISOString() : null),
        // Metadata: use tracked value (set at startup from computed 3AM target)
        metadata: this.nextRunAt.metadata ?? null,
      },
      checkIntervalHours: this.episodeCheckIntervalMs / 3600000,
      maxConcurrent: 4,
      rateLimit: rateLimitStatus.limit,
      scrapedThisHour: rateLimitStatus.used,
      lastResults: null,
      queue: {
        ...queueCounts,
        stats,
      },
    };
  }
}

export const productionScheduler = new ProductionScheduler();
export default productionScheduler;
