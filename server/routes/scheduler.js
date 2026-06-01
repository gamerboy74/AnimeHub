import express from "express";
import { supabase } from "../config/supabase.js";
import { scrapeAndSaveEpisode } from "../scrapers/manager.js";
import { productionScheduler } from "../services/production-scheduler.js";
import { episodeQueue, redisClient } from "../services/bull-queue.js";
import stateManager from "../services/state-manager.js";
import { getScraperConfigs, saveScraperConfigs } from "../utils/scraper-config.js";

import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

// ─── Production Scheduler API endpoints ───────────────────────────────────────────
router.get('/api/scheduler/status', async (req, res) => {
  try {
    if (!redisClient.isOpen) {
      return res.json({
        success: true,
        enabled: productionScheduler.enabled,
        running: false,
        lastRun: null,
        nextRun: null,
        checkIntervalHours: 6,
        maxConcurrent: 4,
        rateLimit: 30,
        scrapedThisHour: 0,
        lastResults: null,
        redisOffline: true,
        queue: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0, stats: {} }
      });
    }
    const status = await productionScheduler.getStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    console.warn('⚠️ Fallback status triggered:', err.message);
    res.json({
      success: true,
      enabled: productionScheduler.enabled,
      running: false,
      lastRun: null,
      nextRun: null,
      checkIntervalHours: 6,
      maxConcurrent: 4,
      rateLimit: 30,
      scrapedThisHour: 0,
      lastResults: null,
      redisOffline: true,
      queue: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0, stats: {} }
    });
  }
});

router.post('/api/scheduler/run', async (req, res) => {
  try {
    if (!redisClient.isOpen) {
      return res.status(503).json({ success: false, error: 'Redis is offline. Cannot trigger scheduler queue.' });
    }
    const isLocked = await stateManager.isLocked();
    if (isLocked) {
      return res.status(409).json({ success: false, error: 'Scheduler is already running' });
    }

    // Trigger episode enqueueing manually
    productionScheduler.enqueueNewEpisodes().catch(err =>
      console.error('Manual scheduler run error:', err)
    );

    res.json({ success: true, message: 'Episode enqueueing started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/scheduler/toggle', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be boolean' });
  }

  productionScheduler.enabled = enabled;
  if (enabled) {
    productionScheduler.start().catch(err => console.error('Scheduler start error:', err));
  } else {
    productionScheduler.stop().catch(err => console.error('Scheduler stop error:', err));
  }

  res.json({ success: true, enabled: productionScheduler.enabled });
});

router.get('/api/scheduler/queue/stats', async (req, res) => {
  try {
    if (!redisClient.isOpen) {
      return res.json({
        success: true,
        redisOffline: true,
        queue: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
        scrapers: {}
      });
    }
    const counts = await episodeQueue.getJobCounts();
    const stats = await stateManager.getAllScraperStats();
    res.json({ success: true, queue: counts, scrapers: stats });
  } catch (err) {
    console.warn('⚠️ Fallback stats triggered:', err.message);
    res.json({
      success: true,
      redisOffline: true,
      queue: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
      scrapers: {}
    });
  }
});

router.get('/api/scheduler/rate-limit', async (req, res) => {
  try {
    if (!redisClient.isOpen) {
      return res.json({
        success: true,
        redisOffline: true,
        used: 0,
        limit: 30,
        remaining: 30,
        resetIn: 0
      });
    }
    const status = await stateManager.getRateLimitStatus(30);
    res.json({ success: true, ...status });
  } catch (err) {
    res.json({
      success: true,
      redisOffline: true,
      used: 0,
      limit: 30,
      remaining: 30,
      resetIn: 0
    });
  }
});

router.post('/api/scheduler/reset-rate-limit', async (req, res) => {
  try {
    if (!redisClient.isOpen) {
      return res.status(503).json({ success: false, error: 'Redis is offline. Cannot reset rate limit.' });
    }
    await stateManager.resetRateLimit();
    res.json({ success: true, message: 'Rate limit reset' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/scheduler/logs', async (req, res) => {
  try {
    if (!redisClient.isOpen) {
      return res.json({
        success: true,
        redisOffline: true,
        logs: [{ timestamp: new Date().toISOString(), level: 'warn', message: 'Queue system is offline (Redis server disconnected).' }]
      });
    }
    const logs = await stateManager.getLogs();
    res.json({ success: true, logs });
  } catch (err) {
    res.json({
      success: true,
      redisOffline: true,
      logs: [{ timestamp: new Date().toISOString(), level: 'warn', message: 'Queue system is offline (Redis error).' }]
    });
  }
});

router.post('/api/scheduler/reset-metrics', async (req, res) => {
  try {
    if (!redisClient.isOpen) {
      return res.status(503).json({ success: false, error: 'Redis is offline. Cannot reset metrics.' });
    }
    await stateManager.clearScraperStats();
    await stateManager.clearLogs();
    await stateManager.addLog('info', 'Pipeline metrics and system logs reset by admin.');
    res.json({ success: true, message: 'Pipeline metrics reset successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Scrapers dynamic pipeline configuration
router.get('/api/scheduler/scrapers', async (req, res) => {
  try {
    const configs = await getScraperConfigs();
    res.json({ success: true, scrapers: configs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/scheduler/scrapers', async (req, res) => {
  try {
    const { scrapers } = req.body;
    if (!scrapers) {
      return res.status(400).json({ success: false, error: 'scrapers array required' });
    }
    const updated = await saveScraperConfigs(scrapers);
    res.json({ success: true, scrapers: updated, message: 'Scrapers configuration saved successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual sequential scrape endpoint for Admin Maintenance
router.post("/api/admin/maintenance/scrape-sequential", async (req, res) => {
  try {
    const { animeId, episodeNumber } = req.body;
    if (!animeId || !episodeNumber) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const ep = parseInt(episodeNumber);
    if (isNaN(ep) || ep < 1) {
      return res.status(400).json({ success: false, error: "Invalid episode number" });
    }

    console.log(`🛠️ Maintenance API: Manual sequential scrape requested for Anime ID ${animeId}, EP ${ep}`);

    // Fetch anime from db
    const { data: anime, error: animeErr } = await supabase
      .from('anime')
      .select('id, title, title_english, total_episodes, status, scraper_urls, poster_url')
      .eq('id', animeId)
      .single();

    if (animeErr || !anime) {
      return res.status(404).json({ success: false, error: "Anime not found" });
    }

    const result = await scrapeAndSaveEpisode(anime, ep);

    if (result.success) {
      if (result.skipped) {
        return res.json({
          success: true,
          message: `Sequential scrape is already active for this episode. Skipping duplicate call.`,
          skipped: true
        });
      }
      return res.json({
        success: true,
        message: `Episode ${ep} successfully scraped and merged across all scrapers!`,
        serversCount: result.serversCount,
        episode: result.episode
      });
    } else {
      return res.json({
        success: false,
        message: `Sequential scrape completed, but no streaming servers were found for episode ${ep} across all scrapers.`
      });
    }
  } catch (err) {
    console.error("Maintenance scrape error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
