import axios from "axios";
import { fileURLToPath } from "url";
import { resolve as resolvePath, dirname } from "path";
import { promises as fs } from "fs";
import { supabase } from "./config/supabase.js";
import { scrapeAndSaveEpisode } from "./scrapers/manager.js";

export { isGenericTitle, isGenericDescription, mergeVideoServers } from "./scrapers/manager.js";

/* =========================================================================
 *  Helper Functions & State Persistence
 * ========================================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATE_FILE_PATH = resolvePath(__dirname, "config", "scheduler_state.json");

async function ensureDir(filePath) {
  const dir = dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {}
}

async function loadSchedulerState() {
  try {
    const content = await fs.readFile(STATE_FILE_PATH, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    return {};
  }
}

async function saveSchedulerState(state) {
  try {
    await ensureDir(STATE_FILE_PATH);
    await fs.writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn("⚠️ Failed to persist scheduler state:", err.message);
  }
}

export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function getMsUntilHour(targetHour) {
  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    targetHour,
    0,
    0,
    0
  );
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

export function getMsUntilNextInterval(intervalHours) {
  const now = new Date();
  const hours = now.getHours();
  const nextAlignedHour = Math.ceil((hours + 0.001) / intervalHours) * intervalHours % 24;
  
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    nextAlignedHour,
    0,
    0,
    0
  );
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/* =========================================================================
 *  Episode Scheduler — checks ongoing anime for new episodes
 * ========================================================================= */
export class EpisodeScheduler {
  constructor() {
    // Configuration from env (trim whitespace)
    const t = (k, d) => (process.env[k] || '').trim() || d;
    this.enabled = t('SCHEDULER_ENABLED', 'true') === 'true';
    this.checkIntervalMs = parseInt(t('SCHEDULER_EPISODE_CHECK_INTERVAL_HOURS', '6')) * 60 * 60 * 1000;
    this.maxConcurrent = parseInt(t('SCHEDULER_MAX_CONCURRENT_JOBS', '2'));
    this.rateLimit = parseInt(t('SCHEDULER_RATE_LIMIT_EPISODES_PER_HOUR', '30'));
    this.minRating = parseFloat(t('SCHEDULER_MIN_ANIME_RATING', '0'));

    // State
    this.timer = null;
    this.initialTimeout = null;
    this.running = false;
    this.lastRun = null;
    this.lastResults = null;
    this.scrapedThisHour = 0;
    this.rateLimitReset = Date.now() + 60 * 60 * 1000;
  }

  async start() {
    if (!this.enabled) {
      console.log('⏸  Episode scheduler disabled (SCHEDULER_ENABLED != true)');
      return;
    }

    const persisted = await loadSchedulerState();
    if (persisted.episodeScheduler) {
      this.lastRun = persisted.episodeScheduler.lastRun || null;
      this.lastResults = persisted.episodeScheduler.lastResults || null;
      this.scrapedThisHour = persisted.episodeScheduler.scrapedThisHour || 0;
      this.rateLimitReset = persisted.episodeScheduler.rateLimitReset || (Date.now() + 60 * 60 * 1000);
    }

    console.log(`⏰ Episode scheduler started — checking every ${this.checkIntervalMs / 3600000}h`);
    // First catch-up run after 30s (let the server boot fully)
    this.initialTimeout = setTimeout(async () => {
      await this.run();
      
      // Align subsequent runs to the top of the nearest interval hour
      const intervalHours = this.checkIntervalMs / 3600000;
      const msUntilAligned = getMsUntilNextInterval(intervalHours);
      console.log(`⏰ Next scheduled episode check aligned to run in ${formatDuration(msUntilAligned)}`);
      
      this.timer = setTimeout(() => {
        this.run();
        this.timer = setInterval(() => this.run(), this.checkIntervalMs);
      }, msUntilAligned);
    }, 30 * 1000);
  }

  stop() {
    if (this.initialTimeout) { clearTimeout(this.initialTimeout); this.initialTimeout = null; }
    if (this.timer) { clearTimeout(this.timer); clearInterval(this.timer); this.timer = null; }
  }

  async persistState() {
    const currentState = await loadSchedulerState();
    currentState.episodeScheduler = {
      lastRun: this.lastRun,
      lastResults: this.lastResults,
      scrapedThisHour: this.scrapedThisHour,
      rateLimitReset: this.rateLimitReset
    };
    await saveSchedulerState(currentState);
  }

  async run() {
    if (!this.enabled) {
      console.log('⏸️ Scheduler: disabled, skipping run');
      return { skipped: true };
    }
    if (this.running) {
      console.log('⏳ Scheduler: previous run still active, skipping');
      return { skipped: true };
    }
    this.running = true;
    const started = Date.now();
    console.log('🔄 Scheduler: checking anime for new episodes…');

    const results = { checked: 0, found: 0, failed: 0, skipped: 0, details: [] };

    try {
      // 1. Get all anime that might need episodes
      const { data: allAnime, error } = await supabase
        .from('anime')
        .select('id, title, title_english, status, total_episodes, rating, nine_anime_slug, scraper_urls, poster_url')
        .order('rating', { ascending: false });

      if (error) throw error;
      if (!allAnime || allAnime.length === 0) {
        console.log('📭 Scheduler: no anime found');
        this.running = false;
        this.lastRun = new Date().toISOString();
        this.lastResults = results;
        await this.persistState();
        return results;
      }

      console.log(`📋 Scheduler: ${allAnime.length} anime in database`);

      // 2. For each anime, find the highest episode number already in DB
      const animeIds = allAnime.map(a => a.id);
      const { data: maxEps } = await supabase
        .from('episodes')
        .select('anime_id, episode_number')
        .in('anime_id', animeIds)
        .order('episode_number', { ascending: false });

      const maxEpMap = new Map();
      const epCountMap = new Map();
      for (const ep of (maxEps || [])) {
        if (!maxEpMap.has(ep.anime_id) || ep.episode_number > maxEpMap.get(ep.anime_id)) {
          maxEpMap.set(ep.anime_id, ep.episode_number);
        }
        epCountMap.set(ep.anime_id, (epCountMap.get(ep.anime_id) || 0) + 1);
      }

      // 3. Filter to anime that actually need episodes
      const needsEpisodes = allAnime.filter(a => {
        const epCount = epCountMap.get(a.id) || 0;
        if (a.status === 'ongoing') return true;
        if (epCount === 0) return true;
        if (a.total_episodes && epCount < a.total_episodes) return true;
        return false;
      });

      needsEpisodes.sort((a, b) => {
        const aOngoing = a.status === 'ongoing' ? 0 : 1;
        const bOngoing = b.status === 'ongoing' ? 0 : 1;
        if (aOngoing !== bOngoing) return aOngoing - bOngoing;
        const aMissing = (a.total_episodes || 0) - (epCountMap.get(a.id) || 0);
        const bMissing = (b.total_episodes || 0) - (epCountMap.get(b.id) || 0);
        return bMissing - aMissing;
      });

      console.log(`📋 Scheduler: ${needsEpisodes.length} anime need episodes (${needsEpisodes.filter(a => a.status === 'ongoing').length} ongoing, ${needsEpisodes.filter(a => (epCountMap.get(a.id) || 0) === 0).length} with 0 eps)`);

      const queue = needsEpisodes.map(anime => ({
        ...anime,
        nextEp: (maxEpMap.get(anime.id) || 0) + 1,
      }));

      for (const anime of queue) {
        if (Date.now() > this.rateLimitReset) {
          this.scrapedThisHour = 0;
          this.rateLimitReset = Date.now() + 60 * 60 * 1000;
        }
        if (this.scrapedThisHour >= this.rateLimit) {
          console.log(`⚠️  Scheduler: rate limit hit (${this.rateLimit}/hr), stopping batch`);
          results.skipped += queue.length - queue.indexOf(anime);
          break;
        }

        await this.checkAndScrape(anime, results);

        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      console.error('❌ Scheduler error:', err.message);
    }

    this.running = false;
    this.lastRun = new Date().toISOString();
    this.lastResults = results;
    await this.persistState();
    const elapsed = formatDuration(Date.now() - started);
    console.log(`✅ Scheduler done in ${elapsed}: checked=${results.checked} found=${results.found} failed=${results.failed} skipped=${results.skipped}`);
    return results;
  }

  async checkAndScrape(anime, results) {
    const animeTitle = anime.title_english || anime.title;
    results.checked++;

    const { data: existingEps } = await supabase
      .from('episodes')
      .select('episode_number, video_url, video_servers, created_at')
      .eq('anime_id', anime.id);

    const minServers = parseInt(process.env.SCHEDULER_MIN_SERVERS || '2', 10);
    const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours cooldown
    const nowMs = Date.now();

    const scrapedSet = new Set(
      (existingEps || [])
        .filter(e => {
          const serversCount = Array.isArray(e.video_servers) ? e.video_servers.length : 0;
          const lastScrapedMs = e.created_at ? new Date(e.created_at).getTime() : 0;
          const isCooldownActive = (nowMs - lastScrapedMs) < cooldownMs;
          return e.video_url && (serversCount >= minServers || isCooldownActive);
        })
        .map(e => e.episode_number)
    );

    let ep = 1;
    while (scrapedSet.has(ep)) ep++;

    if (scrapedSet.size > 0) {
      const totalStubs = (existingEps || []).length;
      console.log(`  📦 "${animeTitle}" has ${scrapedSet.size}/${totalStubs} episodes with video, starting from EP ${ep}`);
    }

    while (true) {
      if (this.scrapedThisHour >= this.rateLimit) break;

      if (anime.total_episodes && ep > anime.total_episodes && anime.status !== 'ongoing') {
        console.log(`  ℹ️ Reached total episodes limit (${anime.total_episodes}) for completed anime "${animeTitle}". Stopping.`);
        break;
      }

      try {
        const scrapeRes = await scrapeAndSaveEpisode(anime, ep);
        if (scrapeRes.success) {
          this.scrapedThisHour++;
          results.found++;
          results.details.push({ anime: animeTitle, episode: ep, status: 'found', serversCount: scrapeRes.serversCount });
          await this.persistState();

          ep++;
          while (scrapedSet.has(ep)) ep++;
          await new Promise(r => setTimeout(r, 4000));
        } else {
          console.log(`  ℹ️ No stream URLs found for EP ${ep} across all 4 scrapers. Stopping catch-up loop.`);
          if (scrapedSet.size === 0 && ep === 1) {
            results.details.push({ anime: animeTitle, episode: ep, status: 'not_available' });
          }
          break;
        }
      } catch (err) {
        results.failed++;
        results.details.push({ anime: animeTitle, episode: ep, status: 'error', error: err.message });
        console.warn(`  ⚠️ Failed "${animeTitle}" EP ${ep}: ${err.message}`);
        break;
      }
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      lastRun: this.lastRun,
      nextRun: this.timer ? new Date(Date.now() + this.checkIntervalMs).toISOString() : null,
      checkIntervalHours: this.checkIntervalMs / 3600000,
      maxConcurrent: this.maxConcurrent,
      rateLimit: this.rateLimit,
      scrapedThisHour: this.scrapedThisHour,
      lastResults: this.lastResults,
    };
  }
}

/* =========================================================================
 *  New Anime Sync Scheduler — syncs seasonal releases and ratings
 * ========================================================================= */
export class NewAnimeScheduler {
  constructor() {
    const t = (k, d) => (process.env[k] || '').trim() || d;
    this.enabled = t('SCHEDULER_ENABLED', 'true') === 'true';
    this.checkIntervalMs = parseInt(t('SCHEDULER_NEW_ANIME_CHECK_INTERVAL_HOURS', '24')) * 60 * 60 * 1000;
    this.minRating = parseFloat(t('SCHEDULER_MIN_ANIME_RATING', '5.0'));

    this.timer = null;
    this.initialTimeout = null;
    this.running = false;
    this.lastRun = null;
    this.lastResults = null;
  }

  async start() {
    if (!this.enabled) {
      console.log('⏸️  New anime sync scheduler disabled');
      return;
    }

    const persisted = await loadSchedulerState();
    if (persisted.newAnimeScheduler) {
      this.lastRun = persisted.newAnimeScheduler.lastRun || null;
      this.lastResults = persisted.newAnimeScheduler.lastResults || null;
    }

    const targetHour = parseInt(process.env.SCHEDULER_NEW_ANIME_SYNC_HOUR || '3', 10);
    const msUntilTarget = getMsUntilHour(targetHour);
    const targetTimeStr = new Date(Date.now() + msUntilTarget).toLocaleTimeString();
    console.log(`⏰ New anime sync scheduler scheduled to run daily at ${targetHour}:00 (in ${formatDuration(msUntilTarget)}, at ${targetTimeStr})`);

    this.initialTimeout = setTimeout(async () => {
      await this.run();
      this.timer = setInterval(() => this.run(), 24 * 60 * 60 * 1000);
    }, msUntilTarget);
  }

  stop() {
    if (this.initialTimeout) { clearTimeout(this.initialTimeout); this.initialTimeout = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async persistState() {
    const currentState = await loadSchedulerState();
    currentState.newAnimeScheduler = {
      lastRun: this.lastRun,
      lastResults: this.lastResults
    };
    await saveSchedulerState(currentState);
  }

  async run() {
    if (!this.enabled) {
      console.log('⏸️ New Anime Sync: disabled, skipping run');
      return { skipped: true };
    }
    if (this.running) {
      console.log('⏳ New Anime Sync: previous run still active, skipping');
      return { skipped: true };
    }
    this.running = true;
    const started = Date.now();
    console.log('🔄 New Anime Sync: syncing metadata and seasonal releases...');

    const results = { checked: 0, updated: 0, added: 0, failed: 0 };

    try {
      // 1. Sync ongoing anime metadata from Jikan
      const { data: ongoingAnime, error } = await supabase
        .from('anime')
        .select('id, title, mal_id, status, rating, total_episodes')
        .eq('status', 'ongoing');

      if (error) throw error;

      if (ongoingAnime && ongoingAnime.length > 0) {
        console.log(`📋 New Anime Sync: checking updates for ${ongoingAnime.length} ongoing anime`);
        for (const anime of ongoingAnime) {
          if (!anime.mal_id) continue;
          results.checked++;
          try {
            const response = await axios.get(`https://api.jikan.moe/v4/anime/${anime.mal_id}`);
            const jikanData = response.data?.data;
            if (jikanData) {
              const updatedFields = {};
              
              let mappedStatus = anime.status;
              if (jikanData.status === 'Currently Airing') mappedStatus = 'ongoing';
              else if (jikanData.status === 'Finished Airing') mappedStatus = 'completed';
              else if (jikanData.status === 'Not yet aired') mappedStatus = 'upcoming';

              if (mappedStatus !== anime.status) updatedFields.status = mappedStatus;
              if (jikanData.score && Math.abs(jikanData.score - anime.rating) > 0.05) updatedFields.rating = jikanData.score;
              if (jikanData.episodes && jikanData.episodes !== anime.total_episodes) updatedFields.total_episodes = jikanData.episodes;

              if (Object.keys(updatedFields).length > 0) {
                updatedFields.updated_at = new Date().toISOString();
                await supabase
                  .from('anime')
                  .update(updatedFields)
                  .eq('id', anime.id);
                results.updated++;
                console.log(`💾 Synced metadata for "${anime.title}": ${JSON.stringify(updatedFields)}`);
              }
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (e) {
            console.error(`⚠️ Sync failed for "${anime.title}":`, e.message);
            results.failed++;
          }
        }
      }



    } catch (err) {
      console.error('❌ New Anime Sync Scheduler error:', err.message);
    }

    this.running = false;
    this.lastRun = new Date().toISOString();
    this.lastResults = results;
    await this.persistState();
    const elapsed = formatDuration(Date.now() - started);
    console.log(`✅ New Anime Sync done in ${elapsed}: checked=${results.checked} updated=${results.updated} added=${results.added} failed=${results.failed}`);
    return results;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      lastRun: this.lastRun,
      nextRun: this.timer ? new Date(Date.now() + this.checkIntervalMs).toISOString() : null,
      checkIntervalHours: this.checkIntervalMs / 3600000,
      lastResults: this.lastResults,
    };
  }
}

// Instantiate the schedulers
export const episodeScheduler = new EpisodeScheduler();
export const newAnimeScheduler = new NewAnimeScheduler();
