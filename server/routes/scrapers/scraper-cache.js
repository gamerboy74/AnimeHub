import express from "express";
import { supabase } from "../../config/supabase.js";
import { cacheInvalidateAnime } from "../../services/cache.js";
import { NineAnimeScraperService } from "../../scrapers/nineanime.js";
import { requireAdmin } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

// Single episode scraping endpoint (9Anime)
router.post("/scrape-episode", async (req, res) => {
  try {
    const { animeTitle, animeId, episodeNumber = 1, options = {} } = req.body;

    if (!animeTitle || !animeId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: animeTitle and animeId",
      });
    }

    console.log(
      `🎬 API: Scraping episode ${episodeNumber} for "${animeTitle}" (ID: ${animeId})`
    );

    const result = await NineAnimeScraperService.scrapeAndSaveEpisode(
      animeTitle,
      animeId,
      episodeNumber,
      {
        timeout: 45000,
        retries: 3,
        ...options,
      }
    );

    if (result.success) {
      cacheInvalidateAnime(animeId);
      if (result.skipped) {
        return res.json({
          success: true,
          skipped: true,
          error: result.error || "Anime/Season not found",
          message: `Episode ${episodeNumber} was gracefully skipped: ${result.error || "Not found"}`,
        });
      }
      res.json({
        success: true,
        streamUrl: result.streamUrl,
        episodeData: result.episodeData,
        message: `Episode ${episodeNumber} scraped and saved successfully!`,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || "Scraping failed",
      });
    }
  } catch (error) {
    console.error("❌ API Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// GET: Read cached scraper URLs for an anime
router.get("/scraper-cache/:animeId", async (req, res) => {
  try {
    const { animeId } = req.params;
    const { data, error } = await supabase
      .from("anime")
      .select("scraper_urls")
      .eq("id", animeId)
      .single();

    if (error) {
      return res.status(404).json({ success: false, error: error.message });
    }

    res.json({ success: true, scraper_urls: data?.scraper_urls || {} });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Save/update a scraper URL for an anime
router.post("/scraper-cache", async (req, res) => {
  try {
    const { animeId, scraper, url } = req.body;
    if (!animeId || !scraper || !url) {
      return res.status(400).json({ success: false, error: "animeId, scraper, and url are required" });
    }

    const { data: existing } = await supabase
      .from("anime")
      .select("scraper_urls")
      .eq("id", animeId)
      .single();

    const merged = { ...(existing?.scraper_urls || {}), [scraper]: url };

    const { error } = await supabase
      .from("anime")
      .update({ scraper_urls: merged })
      .eq("id", animeId);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    console.log(`💾 Scraper cache saved: anime=${animeId} scraper=${scraper} url=${url}`);
    cacheInvalidateAnime(animeId);
    res.json({ success: true, scraper_urls: merged });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE: Clear a specific scraper's cached URL (or all if no scraper given)
router.delete("/scraper-cache/:animeId", async (req, res) => {
  try {
    const { animeId } = req.params;
    const { scraper } = req.query;

    const { data: existing } = await supabase
      .from("anime")
      .select("scraper_urls")
      .eq("id", animeId)
      .single();

    let newCache = {};
    if (scraper && existing?.scraper_urls) {
      newCache = { ...existing.scraper_urls };
      delete newCache[scraper];
    }

    const { error } = await supabase
      .from("anime")
      .update({ scraper_urls: newCache })
      .eq("id", animeId);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    console.log(`🗑️ Scraper cache cleared: anime=${animeId} scraper=${scraper || "ALL"}`);
    cacheInvalidateAnime(animeId);
    res.json({ success: true, scraper_urls: newCache });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
