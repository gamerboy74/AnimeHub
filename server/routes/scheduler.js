import express from "express";
import { supabase } from "../config/supabase.js";
import { scrapeAndSaveEpisode } from "../scrapers/manager.js";
import { productionScheduler } from "../services/production-scheduler.js";
import { episodeQueue } from "../services/bull-queue.js";
import stateManager from "../services/state-manager.js";

const router = express.Router();

// ─── Production Scheduler API endpoints ───────────────────────────────────────────
router.get('/api/scheduler/status', async (req, res) => {
  try {
    const status = await productionScheduler.getStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/scheduler/run', async (req, res) => {
  try {
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
    const counts = await episodeQueue.getJobCounts();
    const stats = await stateManager.getAllScraperStats();
    res.json({ success: true, queue: counts, scrapers: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/scheduler/rate-limit', async (req, res) => {
  try {
    const status = await stateManager.getRateLimitStatus(30);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/scheduler/reset-rate-limit', async (req, res) => {
  try {
    await stateManager.resetRateLimit();
    res.json({ success: true, message: 'Rate limit reset' });
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
