import express from "express";
import { supabase } from "../config/supabase.js";
import { scrapeAndSaveEpisode } from "../scrapers/manager.js";
import { episodeScheduler, newAnimeScheduler } from "../scheduler.js";

const router = express.Router();

// ─── Scheduler API endpoints ───────────────────────────────────────────
router.get('/api/scheduler/status', (req, res) => {
  res.json({
    success: true,
    ...episodeScheduler.getStatus(),
    newAnimeSync: newAnimeScheduler.getStatus()
  });
});

router.post('/api/scheduler/run', async (req, res) => {
  if (episodeScheduler.running) {
    return res.status(409).json({ success: false, error: 'Scheduler is already running' });
  }
  episodeScheduler.run().catch(err => console.error('Manual scheduler run error:', err));
  res.json({ success: true, message: 'Scheduler run started' });
});

router.post('/api/scheduler/toggle', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be boolean' });
  }
  if (enabled && !episodeScheduler.timer) {
    episodeScheduler.enabled = true;
    episodeScheduler.start();
  } else if (!enabled) {
    episodeScheduler.enabled = false;
    episodeScheduler.stop();
  }
  res.json({ success: true, enabled: episodeScheduler.enabled });
});

router.post('/api/scheduler/run-sync', async (req, res) => {
  if (newAnimeScheduler.running) {
    return res.status(409).json({ success: false, error: 'New Anime Sync scheduler is already running' });
  }
  newAnimeScheduler.run().catch(err => console.error('Manual new anime sync scheduler run error:', err));
  res.json({ success: true, message: 'New Anime Sync scheduler run started' });
});

router.post('/api/scheduler/toggle-sync', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be boolean' });
  }
  if (enabled && !newAnimeScheduler.timer) {
    newAnimeScheduler.enabled = true;
    newAnimeScheduler.start();
  } else if (!enabled) {
    newAnimeScheduler.enabled = false;
    newAnimeScheduler.stop();
  }
  res.json({ success: true, enabled: newAnimeScheduler.enabled });
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

  } catch (error) {
    console.error("❌ API Maintenance Error:", error);
    res.status(500).json({ success: false, error: error.message || "Scraping failed" });
  }
});

export default router;
