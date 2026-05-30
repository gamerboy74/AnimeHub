import express from "express";
import axios from "axios";
import { supabase } from "../config/supabase.js";
import { enqueue, getBrowser } from "../services/queue.js";
import { cacheInvalidateAnime } from "../services/cache.js";
import { NineAnimeScraperService } from "../scrapers/nineanime.js";
import { ReAnimeScraperService } from "../scrapers/reanime.js";
import { SanjiAnimeScraperService } from "../scrapers/sanjianime.js";
import { AnimeSugeScraperService } from "../scrapers/animesuge.js";
import { mergeVideoServers } from "../scrapers/manager.js";

const router = express.Router();

// Single episode scraping endpoint
router.post("/api/scrape-episode", async (req, res) => {
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
router.get("/api/scraper-cache/:animeId", async (req, res) => {
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
router.post("/api/scraper-cache", async (req, res) => {
  try {
    const { animeId, scraper, url } = req.body;
    if (!animeId || !scraper || !url) {
      return res.status(400).json({ success: false, error: "animeId, scraper, and url are required" });
    }

    // Read existing cache first, then merge
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
router.delete("/api/scraper-cache/:animeId", async (req, res) => {
  try {
    const { animeId } = req.params;
    const { scraper } = req.query; // optional: clear only one scraper key

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
    // If no scraper specified → clear all (newCache stays {})

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

// Single episode Re:ANIME scraping endpoint
router.post("/api/scrape-reanime-episode", async (req, res) => {
  try {
    const {
      url,
      watchUrl,
      animeUrl,
      episodeNumber = 1,
      options = {},
    } = req.body;

    const targetUrl = url || watchUrl || animeUrl;
    const animeId = req.body.animeId || options.animeId;

    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: url, watchUrl, or animeUrl",
      });
    }

    console.log(
      `🎬 API: Scraping Re:ANIME for ${targetUrl} (episode ${episodeNumber})`
    );

    // ── URL Cache: check if we already know the base watch URL for this anime ──
    let resolvedInputUrl = targetUrl;
    const cacheKey = "reanime_watch";

    if (animeId) {
      try {
        const { data: cacheRow } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const cachedWatchBase = cacheRow?.scraper_urls?.[cacheKey];
        if (cachedWatchBase) {
          console.log(`⚡ Re:ANIME cache HIT [${cacheKey}]: ${cachedWatchBase}`);
          // Scraper sees a /watch/ URL → skips the title search entirely
          resolvedInputUrl = cachedWatchBase;
        }
      } catch (e) {
        console.warn("⚠️ Re:ANIME cache read failed:", e.message);
      }
    }

    const result = await enqueue(() =>
      ReAnimeScraperService.scrapeAnimeEpisode(resolvedInputUrl, episodeNumber, {
        timeout: 30000,
        retries: 2,
        ...options,
      }),
      "high"
    );

    // ── URL Cache: after a fresh resolve, save the base watch URL for next time ──
    if (result.success && result.watchUrl && animeId) {
      try {
        const watchBase = new URL(result.watchUrl);
        watchBase.searchParams.delete("ep");
        watchBase.searchParams.delete("lang");
        const baseWatchUrl = watchBase.toString();

        const { data: existing } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const currentCache = existing?.scraper_urls || {};
        if (currentCache[cacheKey] !== baseWatchUrl) {
          const merged = { ...currentCache, [cacheKey]: baseWatchUrl };
          await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
          console.log(`💾 Re:ANIME watch URL cached: ${baseWatchUrl}`);
        }
      } catch (e) {
        console.warn("⚠️ Re:ANIME cache save failed:", e.message);
      }
    }

    if (result.success && result.streamUrl && animeId) {
      console.log(`💾 API: Saving single Re:ANIME scraped episode to database for anime ${animeId}`);
      // Save to database
      const { data: existingEpisode } = await supabase
        .from("episodes")
        .select("id, title")
        .eq("anime_id", animeId)
        .eq("episode_number", episodeNumber)
        .maybeSingle();

      const scrapeLang = options.lang || "sub";
      const videoServers = (result.episodeData?.sources || []).map(s => ({
        name: s.label ? `Re:ANIME - ${s.label}` : "Re:ANIME active",
        url: s.iframeUrl,
        lang: s.lang || scrapeLang
      }));

      if (videoServers.length === 0 && result.streamUrl) {
        videoServers.push({
          name: "Re:ANIME active",
          url: result.streamUrl,
          lang: scrapeLang
        });
      }

      if (existingEpisode) {
        // Merge with existing servers of other languages to prevent overwriting them
        const { data: currentEp } = await supabase
          .from("episodes")
          .select("video_servers")
          .eq("id", existingEpisode.id)
          .single();

        const mergedServers = mergeVideoServers(currentEp?.video_servers, videoServers);

        await supabase
          .from("episodes")
          .update({
            video_url: result.streamUrl,
            video_servers: mergedServers,
            duration: 1440,
          })
          .eq("id", existingEpisode.id);
      } else {
        await supabase
          .from("episodes")
          .insert({
            anime_id: animeId,
            episode_number: episodeNumber,
            title: `${targetUrl} - Episode ${episodeNumber}`,
            video_url: result.streamUrl,
            video_servers: mergeVideoServers([], videoServers),
            duration: 1440,
            description: `Scraped from Re:ANIME`,
            created_at: new Date().toISOString(),
          });
      }
      cacheInvalidateAnime(animeId);
    }

    res.json(result);
  } catch (error) {
    console.error("❌ Re:ANIME scrape error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Re:ANIME scrape failed",
    });
  }
});

// Single episode Sanji Anime scraping endpoint
router.post("/api/scrape-sanjianime-episode", async (req, res) => {
  try {
    const { url, watchUrl, animeUrl, animeTitle, episodeNumber = 1, options = {} } = req.body;
    const animeId = req.body.animeId || options.animeId;
    const targetUrl = url || watchUrl || animeUrl || animeTitle;

    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: url, watchUrl, animeUrl, or animeTitle",
      });
    }

    console.log(`🎬 API: Scraping Sanji Anime for ${targetUrl} (episode ${episodeNumber})`);

    let resolvedInputUrl = targetUrl;
    const cacheKey = "sanjianime_watch";

    if (animeId) {
      try {
        const { data: cacheRow } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const cachedWatchUrl = cacheRow?.scraper_urls?.[cacheKey];
        if (cachedWatchUrl) {
          console.log(`⚡ Sanji Anime cache HIT [${cacheKey}]: ${cachedWatchUrl}`);
          resolvedInputUrl = cachedWatchUrl;
        }
      } catch (error) {
        console.warn("⚠️ Sanji Anime cache read failed:", error.message);
      }
    }

    const result = await enqueue(() =>
      SanjiAnimeScraperService.scrapeAnimeEpisode(resolvedInputUrl, episodeNumber, {
        timeout: options.timeout || 30000,
        retries: options.retries || 2,
        lang: options.lang,
        ...options,
      }),
      "high"
    );

    if (result.success && result.watchUrl && animeId) {
      try {
        const { data: existing } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const currentCache = existing?.scraper_urls || {};
        if (currentCache[cacheKey] !== result.watchUrl) {
          const merged = { ...currentCache, [cacheKey]: result.watchUrl };
          await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
          console.log(`💾 Sanji Anime watch URL cached: ${result.watchUrl}`);
        }
      } catch (error) {
        console.warn("⚠️ Sanji Anime cache save failed:", error.message);
      }
    }

    if (result.success && result.streamUrl && animeId) {
      console.log(`💾 API: Saving Sanji Anime scraped episode to database for anime ${animeId}`);

      const { data: existingEpisode } = await supabase
        .from("episodes")
        .select("id, title")
        .eq("anime_id", animeId)
        .eq("episode_number", episodeNumber)
        .maybeSingle();

      const scrapeLang = options.lang || result.episodeData?.lang || "unknown";
      const videoServers = (result.episodeData?.sources || []).map((source) => ({
        name: source.label ? `Sanji - ${source.label}` : "Sanji Anime active",
        url: source.playableUrl || source.iframeUrl || source.url || result.streamUrl,
        lang: (source.lang || scrapeLang).toLowerCase(),
      }));

      if (videoServers.length === 0 && result.streamUrl) {
        videoServers.push({
          name: "Sanji Anime active",
          url: result.streamUrl,
          lang: scrapeLang.toLowerCase(),
        });
      }

      if (existingEpisode) {
        const { data: currentEp } = await supabase
          .from("episodes")
          .select("video_servers")
          .eq("id", existingEpisode.id)
          .single();

        const mergedServers = mergeVideoServers(currentEp?.video_servers, videoServers);

        await supabase
          .from("episodes")
          .update({
            video_url: result.streamUrl,
            video_servers: mergedServers,
            duration: 1440,
          })
          .eq("id", existingEpisode.id);
      } else {
        await supabase
          .from("episodes")
          .insert({
            anime_id: animeId,
            episode_number: episodeNumber,
            title: `${animeTitle || targetUrl} - Episode ${episodeNumber}`,
            video_url: result.streamUrl,
            video_servers: mergeVideoServers([], videoServers),
            duration: 1440,
            description: `Scraped from Sanji Anime`,
            created_at: new Date().toISOString(),
          });
      }

      cacheInvalidateAnime(animeId);
    }

    res.json(result);
  } catch (error) {
    console.error("❌ Sanji Anime scrape error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Sanji Anime scrape failed",
    });
  }
});

// Single episode AnimeSuge scraping endpoint
router.post("/api/scrape-animesuge-episode", async (req, res) => {
  try {
    const { url, watchUrl, animeUrl, animeTitle, episodeNumber = 1, options = {} } = req.body;
    const animeId = req.body.animeId || options.animeId;
    const targetUrl = url || watchUrl || animeUrl || animeTitle;

    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: url, watchUrl, animeUrl, or animeTitle",
      });
    }

    console.log(`🎬 API: Scraping AnimeSuge for ${targetUrl} (episode ${episodeNumber})`);

    const isUrl = /^https?:\/\//i.test(targetUrl);
    const overwrite = req.body.overwrite || options.overwrite || false;
    let resolvedInputUrl = targetUrl;
    const cacheKey = "animesuge_watch";
    let isFromCache = false;

    if (animeId && !isUrl && !overwrite) {
      try {
        const { data: cacheRow } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const cachedWatchUrl = cacheRow?.scraper_urls?.[cacheKey];
        if (cachedWatchUrl) {
          console.log(`⚡ AnimeSuge cache HIT [${cacheKey}]: ${cachedWatchUrl}`);
          resolvedInputUrl = cachedWatchUrl;
          isFromCache = true;
        }
      } catch (error) {
        console.warn("⚠️ AnimeSuge cache read failed:", error.message);
      }
    }

    let result = await enqueue(() =>
      AnimeSugeScraperService.scrapeAnimeEpisode(resolvedInputUrl, episodeNumber, {
        timeout: options.timeout || 30000,
        retries: options.retries || 2,
        lang: options.lang,
        ...options,
      }),
      "high"
    );

    // If cache failure retry
    if (!result.success && isFromCache) {
      console.warn("⚠️ Cached AnimeSuge URL failed. Clearing cache and retrying search...");
      try {
        const { data: existing } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();
        const currentCache = existing?.scraper_urls || {};
        delete currentCache[cacheKey];
        await supabase.from("anime").update({ scraper_urls: currentCache }).eq("id", animeId);
      } catch (err) {
        console.warn("⚠️ Failed to clear AnimeSuge cache on error:", err.message);
      }

      result = await enqueue(() =>
        AnimeSugeScraperService.scrapeAnimeEpisode(targetUrl, episodeNumber, {
          timeout: options.timeout || 30000,
          retries: options.retries || 2,
          lang: options.lang,
          ...options,
        }),
        "high"
      );
    }

    if (result.success && result.watchUrl && animeId) {
      try {
        const { data: existing } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const currentCache = existing?.scraper_urls || {};
        const urlObj = new URL(result.watchUrl);
        urlObj.pathname = urlObj.pathname.replace(/\/ep-\d+$/i, "");
        const baseWatchUrl = urlObj.toString();

        if (currentCache[cacheKey] !== baseWatchUrl) {
          const merged = { ...currentCache, [cacheKey]: baseWatchUrl };
          await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
          console.log(`💾 AnimeSuge watch URL cached: ${baseWatchUrl}`);
        }
      } catch (error) {
        console.warn("⚠️ AnimeSuge cache save failed:", error.message);
      }
    }

    if (result.success && result.streamUrl && animeId) {
      console.log(`💾 API: Saving AnimeSuge scraped episode to database for anime ${animeId}`);

      const { data: existingEpisode } = await supabase
        .from("episodes")
        .select("id, title")
        .eq("anime_id", animeId)
        .eq("episode_number", episodeNumber)
        .maybeSingle();

      const scrapeLang = options.lang || result.episodeData?.lang || "sub";
      const videoServers = (result.episodeData?.sources || []).map((source) => ({
        name: source.label ? `AnimeSuge - ${source.label}` : "AnimeSuge active",
        url: source.iframeUrl || result.streamUrl,
        lang: (source.lang || scrapeLang).toLowerCase(),
      }));

      if (videoServers.length === 0 && result.streamUrl) {
        videoServers.push({
          name: "AnimeSuge active",
          url: result.streamUrl,
          lang: scrapeLang.toLowerCase(),
        });
      }

      if (existingEpisode) {
        const { data: currentEp } = await supabase
          .from("episodes")
          .select("video_servers")
          .eq("id", existingEpisode.id)
          .single();

        const mergedServers = mergeVideoServers(currentEp?.video_servers, videoServers);

        await supabase
          .from("episodes")
          .update({
            video_url: result.streamUrl,
            video_servers: mergedServers,
            duration: 1440,
          })
          .eq("id", existingEpisode.id);
      } else {
        await supabase
          .from("episodes")
          .insert({
            anime_id: animeId,
            episode_number: episodeNumber,
            title: `${animeTitle || targetUrl} - Episode ${episodeNumber}`,
            video_url: result.streamUrl,
            video_servers: mergeVideoServers([], videoServers),
            duration: 1440,
            description: `Scraped from AnimeSuge`,
            created_at: new Date().toISOString(),
          });
      }

      cacheInvalidateAnime(animeId);
    }

    res.json(result);
  } catch (error) {
    console.error("❌ AnimeSuge scrape error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "AnimeSuge scrape failed",
    });
  }
});

// Streaming batch scrape endpoint for AnimeSuge with real-time progress
router.post("/api/batch-scrape-animesuge-episodes-stream", async (req, res) => {
  try {
    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    // Set headers for Server-Sent Events
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    console.log(
      `🎬 Streaming AnimeSuge batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

    // Extract overwrite option
    const overwrite = req.body.overwrite || options.overwrite || false;
    const requestedLang = (options.lang || req.body.lang || "sub").toLowerCase();

    function hasAnimeSugeServers(videoServers) {
      if (!Array.isArray(videoServers) || videoServers.length === 0) return false;
      return videoServers.some(
        (s) =>
          (s.lang || "").toLowerCase() === requestedLang &&
          s.url &&
          ((s.name || "").toLowerCase().includes("animesuge") ||
           (s.url || "").toLowerCase().includes("animesuge"))
      );
    }

    let epsToScrape = episodeNumbers;
    let skippedCount = 0;
    if (!overwrite) {
      try {
        const { data: existing } = await supabase
          .from("episodes")
          .select("episode_number, video_servers")
          .eq("anime_id", animeId)
          .in("episode_number", episodeNumbers);

        if (existing && existing.length > 0) {
          const fullyScraped = new Set(
            existing
              .filter((e) => hasAnimeSugeServers(e.video_servers))
              .map((e) => e.episode_number)
          );
          epsToScrape = episodeNumbers.filter((n) => !fullyScraped.has(n));
          skippedCount = fullyScraped.size;
          if (skippedCount > 0) {
            console.log(
              `⏭️ Skipping ${skippedCount} episodes that already have AnimeSuge servers for lang: ${requestedLang}`
            );
          }
        }
      } catch (e) {
        console.warn("⚠️ Pre-check failed, scraping all:", e.message);
      }
    } else {
      console.log(`🔄 AnimeSuge Overwrite/Rescrape requested. Scraping all requested episodes regardless of existing URLs.`);
    }

    let successCount = skippedCount;
    let errorCount = 0;

    // Send initial progress
    res.write(
      `data: ${JSON.stringify({
        type: "start",
        total: episodeNumbers.length,
        toScrape: epsToScrape.length,
        skipped: skippedCount,
        animeTitle,
      })}\n\n`
    );
    if (res.flush) res.flush();

    if (epsToScrape.length === 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount,
          errorCount: 0,
          total: episodeNumbers.length,
          skipped: skippedCount,
          successRate: 100,
        })}\n\n`
      );
      return res.end();
    }

    const cacheKey = "animesuge_watch";
    let baseWatchUrl = null;
    let browser = null;
    let isFromCache = false;

    const isUrl = /^https?:\/\//i.test(animeTitle);
    if (isUrl) {
      baseWatchUrl = animeTitle;
    }

    // 1. Try reading from DB cache if NOT a direct URL and NOT overwriting
    if (!isUrl && !overwrite) {
      try {
        const { data: cacheRow } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        if (cacheRow?.scraper_urls?.[cacheKey]) {
          baseWatchUrl = cacheRow.scraper_urls[cacheKey];
          console.log(`⚡ AnimeSuge cache HIT [${cacheKey}]: ${baseWatchUrl}`);
          isFromCache = true;
        }
      } catch (e) {
        console.warn("⚠️ AnimeSuge cache read failed:", e.message);
      }
    }

    // 2. If no cache, launch Playwright to resolve + save result
    if (!baseWatchUrl) {
      try {
        browser = await getBrowser();
        if (browser) {
          const context = await browser.newContext({
            userAgent: AnimeSugeScraperService.USER_AGENT,
            viewport: { width: 1280, height: 720 },
          });
          const page = await context.newPage();
          const resolved = await AnimeSugeScraperService.resolveWatchUrlWithPage(
            page,
            animeTitle,
            epsToScrape[0],
            options
          );
          if (resolved) {
            const urlObj = new URL(resolved);
            urlObj.pathname = urlObj.pathname.replace(/\/ep-\d+$/i, "");
            baseWatchUrl = urlObj.toString();
            console.log(`✅ AnimeSuge resolved (fresh): ${baseWatchUrl}`);

            // Save to DB cache
            try {
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), [cacheKey]: baseWatchUrl };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 AnimeSuge cache saved [${cacheKey}]: ${baseWatchUrl}`);
            } catch (saveErr) {
              console.warn("⚠️ AnimeSuge cache save failed:", saveErr.message);
            }
          }
          await context.close();
        }
      } catch (e) {
        console.warn("⚠️ Pre-resolve AnimeSuge watch URL failed:", e.message);
      }
    }

    if (!baseWatchUrl) {
      console.log(`❌ Anime/Season "${animeTitle}" not found on AnimeSuge. Aborting batch.`);
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount: 0,
          errorCount: epsToScrape.length,
          total: episodeNumbers.length,
          skipped: episodeNumbers.length - epsToScrape.length,
          successRate: 0,
          error: `Anime/Season "${animeTitle}" not found on AnimeSuge. Aborting batch.`
        })}\n\n`
      );
      return res.end();
    }

    let consecutiveFailures = 0;
    for (let i = 0; i < epsToScrape.length; i++) {
      const episodeNumber = epsToScrape[i];

      try {
        res.write(
          `data: ${JSON.stringify({
            type: "progress",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            status: "scraping",
          })}\n\n`
        );
        if (res.flush) res.flush();

        const targetSearch = baseWatchUrl || animeTitle;

        let scrapeResult = await enqueue(() =>
          AnimeSugeScraperService.scrapeAnimeEpisode(
            targetSearch,
            episodeNumber,
            {
              timeout: options.timeout || 30000,
              retries: options.retries || 2,
              lang: requestedLang,
            }
          ),
          "high"
        );

        // If batch item scrape fails and it was from cache, clear cache and retry with search
        if (!scrapeResult.success && isFromCache) {
          console.warn("⚠️ Cached AnimeSuge URL failed in batch. Clearing cache and retrying search...");
          try {
            const { data: existing } = await supabase
              .from("anime")
              .select("scraper_urls")
              .eq("id", animeId)
              .single();
            const currentCache = existing?.scraper_urls || {};
            delete currentCache[cacheKey];
            await supabase.from("anime").update({ scraper_urls: currentCache }).eq("id", animeId);
          } catch (err) {
            console.warn("⚠️ Failed to clear AnimeSuge cache in batch:", err.message);
          }

          isFromCache = false;
          baseWatchUrl = null;

          scrapeResult = await enqueue(() =>
            AnimeSugeScraperService.scrapeAnimeEpisode(
              animeTitle,
              episodeNumber,
              {
                timeout: options.timeout || 30000,
                retries: options.retries || 2,
                lang: requestedLang,
              }
            ),
            "high"
          );
        }

        if (scrapeResult.success && scrapeResult.streamUrl) {
          // If we resolved a watchUrl, cache it for subsequent episodes in this batch!
          const resolvedWatch = scrapeResult.watchUrl || scrapeResult.episodeData?.watchUrl;
          if (resolvedWatch && !baseWatchUrl) {
            try {
              const urlObj = new URL(resolvedWatch);
              urlObj.pathname = urlObj.pathname.replace(/\/ep-\d+$/i, "");
              baseWatchUrl = urlObj.toString();
              console.log(`💾 AnimeSuge dynamically cached watch URL for this batch: ${baseWatchUrl}`);

              // Also save to database scraper_urls
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), [cacheKey]: baseWatchUrl };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 AnimeSuge database cache saved: ${baseWatchUrl}`);
            } catch (err) {
              console.warn("⚠️ Failed to dynamically cache AnimeSuge watch URL:", err.message);
            }
          }

          // Save to database
          const { data: existingEpisode } = await supabase
            .from("episodes")
            .select("id, title")
            .eq("anime_id", animeId)
            .eq("episode_number", episodeNumber)
            .maybeSingle();

          const videoServers = (scrapeResult.episodeData?.sources || []).map(s => ({
            name: s.label ? `AnimeSuge - ${s.label}` : "AnimeSuge active",
            url: s.iframeUrl,
            lang: (s.lang || requestedLang).toLowerCase()
          }));

          if (videoServers.length === 0 && scrapeResult.streamUrl) {
            videoServers.push({
              name: "AnimeSuge active",
              url: scrapeResult.streamUrl,
              lang: requestedLang
            });
          }

          if (existingEpisode) {
            // Merge with existing servers
            const { data: currentEp } = await supabase
              .from("episodes")
              .select("video_servers")
              .eq("id", existingEpisode.id)
              .single();

            const mergedServers = mergeVideoServers(currentEp?.video_servers, videoServers);

            // Update
            await supabase
              .from("episodes")
              .update({
                video_url: scrapeResult.streamUrl,
                video_servers: mergedServers,
                duration: 1440,
              })
              .eq("id", existingEpisode.id);
          } else {
            // Insert
            await supabase
              .from("episodes")
              .insert({
                anime_id: animeId,
                episode_number: episodeNumber,
                title: `${animeTitle} - Episode ${episodeNumber}`,
                video_url: scrapeResult.streamUrl,
                video_servers: mergeVideoServers([], videoServers),
                duration: 1440,
                description: `Scraped from AnimeSuge`,
                created_at: new Date().toISOString(),
              });
          }

          cacheInvalidateAnime(animeId);

          successCount++;
          consecutiveFailures = 0;
          res.write(
            `data: ${JSON.stringify({
              type: "success",
              episode: episodeNumber,
              current: skippedCount + i + 1,
              total: episodeNumbers.length,
              url: scrapeResult.streamUrl,
              title: `Episode ${episodeNumber}`,
              sources: videoServers,
            })}\n\n`
          );
        } else {
          throw new Error(scrapeResult.error || "Scraping failed");
        }
      } catch (error) {
        errorCount++;
        consecutiveFailures++;
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            error: error.message,
          })}\n\n`
        );

        const errMsg = (error.message || "").toLowerCase();
        const isNotFound = errMsg.includes("not found") || errMsg.includes("404") || errMsg.includes("could not find") || errMsg.includes("no results");

        if (isNotFound || consecutiveFailures >= 3) {
          console.log(`⏹️ Stopping AnimeSuge batch: ${isNotFound ? 'Anime/episode not found' : 'consecutive failures'}`);
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: isNotFound ? `Not found: ${error.message}` : "Consecutive failures threshold met",
              stoppedAt: episodeNumber,
            })}\n\n`
          );
          break;
        }
      }

      if (res.flush) res.flush();
      // Sleep slightly between episodes
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const successRate = Math.round((successCount / episodeNumbers.length) * 100);
    res.write(
      `data: ${JSON.stringify({
        type: "complete",
        successCount,
        errorCount,
        total: episodeNumbers.length,
        skipped: skippedCount,
        successRate,
      })}\n\n`
    );
    res.end();
  } catch (error) {
    console.error("❌ Batch scrape AnimeSuge error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    } else {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: error.message,
        })}\n\n`
      );
      res.end();
    }
  }
});

// Streaming batch scrape endpoint for Re:ANIME with real-time progress
router.post("/api/batch-scrape-reanime-episodes-stream", async (req, res) => {
  try {
    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    // Set headers for Server-Sent Events
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    console.log(
      `🎬 Streaming Re:ANIME batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

    // Extract overwrite option
    const overwrite = req.body.overwrite || options.overwrite || false;

    // Pre-check: skip episodes that already have Re:ANIME servers for the requested language
    const requestedLang = (options.lang || req.body.lang || "sub").toLowerCase();

    function hasReAnimeServers(videoServers) {
      if (!Array.isArray(videoServers) || videoServers.length === 0) return false;
      return videoServers.some(
        (s) =>
          (s.lang || "").toLowerCase() === requestedLang &&
          s.url &&
          ((s.name || "").toLowerCase().includes("re:anime") ||
           (s.url || "").toLowerCase().includes("reanime"))
      );
    }

    let epsToScrape = episodeNumbers;
    let skippedCount = 0;
    if (!overwrite) {
      try {
        const { data: existing } = await supabase
          .from("episodes")
          .select("episode_number, video_servers")
          .eq("anime_id", animeId)
          .in("episode_number", episodeNumbers);

        if (existing && existing.length > 0) {
          const fullyScraped = new Set(
            existing
              .filter((e) => hasReAnimeServers(e.video_servers))
              .map((e) => e.episode_number)
          );
          epsToScrape = episodeNumbers.filter((n) => !fullyScraped.has(n));
          skippedCount = fullyScraped.size;
          if (skippedCount > 0) {
            console.log(
              `⏭️ Skipping ${skippedCount} episodes that already have Re:ANIME servers for lang: ${requestedLang}`
            );
          }
        }
      } catch (e) {
        console.warn("⚠️ Pre-check failed, scraping all:", e.message);
      }
    } else {
      console.log(`🔄 Re:ANIME Overwrite/Rescrape requested. Scraping all requested episodes regardless of existing URLs.`);
    }

    let successCount = skippedCount;
    let errorCount = 0;

    // Send initial progress
    res.write(
      `data: ${JSON.stringify({
        type: "start",
        total: episodeNumbers.length,
        toScrape: epsToScrape.length,
        skipped: skippedCount,
        animeTitle,
      })}\n\n`
    );
    if (res.flush) res.flush();

    if (epsToScrape.length === 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount,
          errorCount: 0,
          total: episodeNumbers.length,
          skipped: skippedCount,
          successRate: 100,
        })}\n\n`
      );
      return res.end();
    }

    // Pre-resolve the watch URL — check DB cache first, fall back to Playwright search.
    const cacheKey = "reanime_watch";
    let baseWatchUrl = null;
    let browser = null;

    const isUrl = /^https?:\/\//i.test(animeTitle);
    if (isUrl) {
      baseWatchUrl = animeTitle;
    }

    // 1. Try reading from DB cache
    if (!isUrl) {
      try {
        const { data: cacheRow } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        if (cacheRow?.scraper_urls?.[cacheKey]) {
          baseWatchUrl = cacheRow.scraper_urls[cacheKey];
          console.log(`⚡ Re:ANIME cache HIT [${cacheKey}]: ${baseWatchUrl}`);
        }
      } catch (e) {
        console.warn("⚠️ Re:ANIME cache read failed:", e.message);
      }
    }

    // 2. If no cache, launch Playwright to resolve + save result
    if (!baseWatchUrl) {
      try {
        browser = await getBrowser();
        if (browser) {
          const context = await browser.newContext({
            userAgent: ReAnimeScraperService.USER_AGENT,
            viewport: { width: 1280, height: 720 },
          });
          const page = await context.newPage();
          const resolved = await ReAnimeScraperService.resolveWatchUrlWithPage(
            page,
            animeTitle,
            epsToScrape[0],
            options
          );
          if (resolved) {
            const urlObj = new URL(resolved);
            urlObj.searchParams.delete("ep");
            urlObj.searchParams.delete("lang");
            baseWatchUrl = urlObj.toString();
            console.log(`✅ Re:ANIME resolved (fresh): ${baseWatchUrl}`);

            // Save to DB cache
            try {
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), [cacheKey]: baseWatchUrl };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 Re:ANIME cache saved [${cacheKey}]: ${baseWatchUrl}`);
            } catch (saveErr) {
              console.warn("⚠️ Re:ANIME cache save failed:", saveErr.message);
            }
          }
          await context.close();
        }
      } catch (e) {
        console.warn("⚠️ Pre-resolve Re:ANIME watch URL failed:", e.message);
      }
    }

    if (!baseWatchUrl) {
      console.log(`❌ Anime/Season "${animeTitle}" not found on Re:ANIME. Aborting batch.`);
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount: 0,
          errorCount: epsToScrape.length,
          total: episodeNumbers.length,
          skipped: episodeNumbers.length - epsToScrape.length,
          successRate: 0,
          error: `Anime/Season "${animeTitle}" not found on Re:ANIME. Aborting batch.`
        })}\n\n`
      );
      return res.end();
    }

    let consecutiveFailures = 0;
    for (let i = 0; i < epsToScrape.length; i++) {
      const episodeNumber = epsToScrape[i];

      try {
        res.write(
          `data: ${JSON.stringify({
            type: "progress",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            status: "scraping",
          })}\n\n`
        );
        if (res.flush) res.flush();

        const targetSearch = baseWatchUrl || animeTitle;

        const scrapeResult = await enqueue(() =>
          ReAnimeScraperService.scrapeAnimeEpisode(
            targetSearch,
            episodeNumber,
            {
              timeout: options.timeout || 30000,
              retries: options.retries || 2,
              lang: options.lang || "sub",
            }
          )
        );

        if (scrapeResult.success && scrapeResult.streamUrl) {
          // If we resolved a watchUrl, cache it for subsequent episodes in this batch!
          const resolvedWatch = scrapeResult.watchUrl || scrapeResult.episodeData?.watchUrl;
          if (resolvedWatch && !baseWatchUrl) {
            try {
              const urlObj = new URL(resolvedWatch);
              urlObj.searchParams.delete("ep");
              urlObj.searchParams.delete("lang");
              baseWatchUrl = urlObj.toString();
              console.log(`💾 Re:ANIME dynamically cached watch URL for this batch: ${baseWatchUrl}`);

              // Save to DB cache
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), [cacheKey]: baseWatchUrl };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 Re:ANIME database cache saved: ${baseWatchUrl}`);
            } catch (err) {
              console.warn("⚠️ Failed to dynamically cache Re:ANIME watch URL:", err.message);
            }
          }

          // Save to database
          const { data: existingEpisode } = await supabase
            .from("episodes")
            .select("id, title")
            .eq("anime_id", animeId)
            .eq("episode_number", episodeNumber)
            .maybeSingle();

          const scrapeLang = options.lang || "sub";
          const videoServers = (scrapeResult.episodeData?.sources || []).map(s => ({
            name: s.label ? `Re:ANIME - ${s.label}` : "Re:ANIME active",
            url: s.iframeUrl,
            lang: s.lang || scrapeLang
          }));

          if (videoServers.length === 0 && scrapeResult.streamUrl) {
            videoServers.push({
              name: "Re:ANIME active",
              url: scrapeResult.streamUrl,
              lang: scrapeLang
            });
          }

          if (existingEpisode) {
            // Merge with existing servers of other languages to prevent overwriting them
            const { data: currentEp } = await supabase
              .from("episodes")
              .select("video_servers")
              .eq("id", existingEpisode.id)
              .single();

            const mergedServers = mergeVideoServers(currentEp?.video_servers, videoServers);

            // Update
            await supabase
              .from("episodes")
              .update({
                video_url: scrapeResult.streamUrl,
                video_servers: mergedServers,
                duration: 1440,
              })
              .eq("id", existingEpisode.id);
          } else {
            // Insert
            await supabase
              .from("episodes")
              .insert({
                anime_id: animeId,
                episode_number: episodeNumber,
                title: `${animeTitle} - Episode ${episodeNumber}`,
                video_url: scrapeResult.streamUrl,
                video_servers: mergeVideoServers([], videoServers),
                duration: 1440,
                description: `Scraped from Re:ANIME`,
                created_at: new Date().toISOString(),
              });
          }

          successCount++;
          consecutiveFailures = 0;
          res.write(
            `data: ${JSON.stringify({
              type: "success",
              episode: episodeNumber,
              current: skippedCount + i + 1,
              total: episodeNumbers.length,
              url: scrapeResult.streamUrl,
              title: `Episode ${episodeNumber}`,
              sources: videoServers,
            })}\n\n`
          );
        } else {
          throw new Error(scrapeResult.error || "Scraping failed");
        }
      } catch (error) {
        errorCount++;
        consecutiveFailures++;
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            error: error.message,
          })}\n\n`
        );

        const errMsg = (error.message || "").toLowerCase();
        const isNotFound = errMsg.includes("not found") || errMsg.includes("404") || errMsg.includes("could not find") || errMsg.includes("no results");

        if (isNotFound || consecutiveFailures >= 3) {
          console.log(`⏹️ Stopping Re:ANIME batch: ${isNotFound ? 'Anime/episode not found' : 'consecutive failures'}`);
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: isNotFound ? `Not found: ${error.message}` : "Consecutive failures threshold met",
              stoppedAt: episodeNumber,
            })}\n\n`
          );
          break;
        }
      }

      if (res.flush) res.flush();
      // Sleep slightly between episodes
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const successRate = Math.round((successCount / episodeNumbers.length) * 100);
    res.write(
      `data: ${JSON.stringify({
        type: "complete",
        successCount,
        errorCount,
        total: episodeNumbers.length,
        skipped: skippedCount,
        successRate,
      })}\n\n`
    );
    res.end();
  } catch (error) {
    console.error("❌ Batch scrape Re:ANIME error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    } else {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: error.message,
        })}\n\n`
      );
      res.end();
    }
  }
});

// Streaming batch scrape endpoint for Sanji Anime with real-time progress
router.post("/api/batch-scrape-sanjianime-episodes-stream", async (req, res) => {
  try {
    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    // Set headers for Server-Sent Events
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    console.log(
      `🎬 Streaming Sanji Anime batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

    // Extract options
    const overwrite = req.body.overwrite || options.overwrite || false;
    const reqLang = options.lang || "dub"; // Default to dub for Sanji Anime

    // Helper: Returns true if video_servers contains a server from Sanji Anime for the selected lang
    function hasSanjiServers(videoServers, lang) {
      if (!Array.isArray(videoServers) || videoServers.length === 0) return false;
      return videoServers.some(
        (s) =>
          (s.lang || "").toLowerCase() === lang.toLowerCase() &&
          s.url &&
          ((s.name || "").toLowerCase().includes("sanji") ||
           (s.url || "").toLowerCase().includes("sanjianime"))
      );
    }

    let epsToScrape = episodeNumbers;
    let skippedCount = 0;
    if (!overwrite) {
      try {
        const { data: existing } = await supabase
          .from("episodes")
          .select("episode_number, video_servers")
          .eq("anime_id", animeId)
          .in("episode_number", episodeNumbers);

        if (existing && existing.length > 0) {
          const fullyScraped = new Set(
            existing
              .filter((e) => hasSanjiServers(e.video_servers, reqLang))
              .map((e) => e.episode_number)
          );
          epsToScrape = episodeNumbers.filter((n) => !fullyScraped.has(n));
          skippedCount = fullyScraped.size;
          if (skippedCount > 0) {
            console.log(
              `⏭️ Skipping ${skippedCount} episodes that already have Sanji Anime servers for ${reqLang}`
            );
          }
        }
      } catch (e) {
        console.warn("⚠️ Pre-check failed, scraping all:", e.message);
      }
    } else {
      console.log(`🔄 Sanji Anime Overwrite/Rescrape requested. Scraping all requested episodes regardless of existing URLs.`);
    }

    let successCount = skippedCount;
    let errorCount = 0;

    // Send initial progress
    res.write(
      `data: ${JSON.stringify({
        type: "start",
        total: episodeNumbers.length,
        toScrape: epsToScrape.length,
        skipped: skippedCount,
        animeTitle,
      })}\n\n`
    );
    if (res.flush) res.flush();

    if (epsToScrape.length === 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount,
          errorCount: 0,
          total: episodeNumbers.length,
          skipped: skippedCount,
          successRate: 100,
        })}\n\n`
      );
      return res.end();
    }

    // Pre-resolve watch URL — check DB cache first, fall back to Playwright search.
    const cacheKey = "sanjianime_watch";
    let baseWatchUrl = null;
    let browser = null;

    const isUrl = /^https?:\/\//i.test(animeTitle);
    if (isUrl) {
      baseWatchUrl = animeTitle;
    }

    // 1. Try reading from DB cache
    if (!isUrl) {
      try {
        const { data: cacheRow } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        if (cacheRow?.scraper_urls?.[cacheKey]) {
          baseWatchUrl = cacheRow.scraper_urls[cacheKey];
          console.log(`⚡ Sanji Anime cache HIT [${cacheKey}]: ${baseWatchUrl}`);
        }
      } catch (e) {
        console.warn("⚠️ Sanji Anime cache read failed:", e.message);
      }
    }

    // 2. If no cache, launch Playwright to resolve + save result
    if (!baseWatchUrl) {
      try {
        browser = await getBrowser();
        if (browser) {
          const context = await browser.newContext({
            userAgent: SanjiAnimeScraperService.USER_AGENT,
            viewport: { width: 1280, height: 720 },
          });
          const page = await context.newPage();
          const resolved = await SanjiAnimeScraperService.resolveWatchUrlWithPage(
            page,
            req.body.url || options.inputUrl || animeTitle,
            epsToScrape[0]
          );
          if (resolved) {
            let cleanUrl = resolved;
            const match = resolved.match(/(.*\/watch\/[^\/]+?)(?:-episode-\d+)?(?:\?|$)/i);
            if (match && match[1]) {
              cleanUrl = match[1];
            }
            baseWatchUrl = cleanUrl;
            console.log(`✅ Sanji Anime resolved (fresh): ${baseWatchUrl}`);

            // Save to DB cache
            try {
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), [cacheKey]: baseWatchUrl };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 Sanji Anime cache saved [${cacheKey}]: ${baseWatchUrl}`);
            } catch (saveErr) {
              console.warn("⚠️ Sanji Anime cache save failed:", saveErr.message);
            }
          }
          await context.close();
        }
      } catch (e) {
        console.warn("⚠️ Pre-resolve Sanji Anime watch URL failed:", e.message);
      }
    }

    if (!baseWatchUrl) {
      console.log(`❌ Anime/Season "${animeTitle}" not found on SanjiAnime. Aborting batch.`);
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount: 0,
          errorCount: epsToScrape.length,
          total: episodeNumbers.length,
          skipped: episodeNumbers.length - epsToScrape.length,
          successRate: 0,
          error: `Anime/Season "${animeTitle}" not found on SanjiAnime. Aborting batch.`
        })}\n\n`
      );
      return res.end();
    }

    let consecutiveFailures = 0;
    for (let i = 0; i < epsToScrape.length; i++) {
      const episodeNumber = epsToScrape[i];

      try {
        res.write(
          `data: ${JSON.stringify({
            type: "progress",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            status: "scraping",
          })}\n\n`
        );
        if (res.flush) res.flush();

        const targetSearch = baseWatchUrl || req.body.url || options.inputUrl || animeTitle;

        const scrapeResult = await enqueue(() =>
          SanjiAnimeScraperService.scrapeAnimeEpisode(
            targetSearch,
            episodeNumber,
            {
              timeout: options.timeout || 30000,
              retries: options.retries || 2,
              lang: reqLang,
            }
          )
        );

        if (scrapeResult.success && scrapeResult.streamUrl) {
          // If we resolved a watchUrl, cache it for subsequent episodes in this batch!
          const resolvedWatch = scrapeResult.watchUrl || scrapeResult.episodeData?.watchUrl;
          if (resolvedWatch && !baseWatchUrl) {
            try {
              const urlObj = new URL(resolvedWatch);
              urlObj.pathname = urlObj.pathname.replace(/\/episode-\d+$/i, "");
              baseWatchUrl = urlObj.toString();
              console.log(`💾 Sanji Anime dynamically cached watch URL for this batch: ${baseWatchUrl}`);

              // Save to DB cache
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), [cacheKey]: baseWatchUrl };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 Sanji Anime database cache saved: ${baseWatchUrl}`);
            } catch (err) {
              console.warn("⚠️ Failed to dynamically cache Sanji Anime watch URL:", err.message);
            }
          }

          // Save to database
          const { data: existingEpisode } = await supabase
            .from("episodes")
            .select("id, title")
            .eq("anime_id", animeId)
            .eq("episode_number", episodeNumber)
            .maybeSingle();

          const scrapeLang = reqLang;
          const videoServers = (scrapeResult.episodeData?.sources || []).map((source) => ({
            name: source.label ? `Sanji - ${source.label}` : "Sanji Anime active",
            url: source.playableUrl || source.iframeUrl || source.url || scrapeResult.streamUrl,
            lang: (source.lang || scrapeLang).toLowerCase(),
          }));

          if (videoServers.length === 0 && scrapeResult.streamUrl) {
            videoServers.push({
              name: "Sanji Anime active",
              url: scrapeResult.streamUrl,
              lang: scrapeLang.toLowerCase(),
            });
          }

          if (existingEpisode) {
            const { data: currentEp } = await supabase
              .from("episodes")
              .select("video_servers")
              .eq("id", existingEpisode.id)
              .single();

            const mergedServers = mergeVideoServers(currentEp?.video_servers, videoServers);

            await supabase
              .from("episodes")
              .update({
                video_url: scrapeResult.streamUrl,
                video_servers: mergedServers,
                duration: 1440,
              })
              .eq("id", existingEpisode.id);
          } else {
            await supabase
              .from("episodes")
              .insert({
                anime_id: animeId,
                episode_number: episodeNumber,
                title: `${animeTitle} - Episode ${episodeNumber}`,
                video_url: scrapeResult.streamUrl,
                video_servers: mergeVideoServers([], videoServers),
                duration: 1440,
                description: `Scraped from Sanji Anime`,
                created_at: new Date().toISOString(),
              });
          }

          successCount++;
          consecutiveFailures = 0;
          res.write(
            `data: ${JSON.stringify({
              type: "success",
              episode: episodeNumber,
              current: skippedCount + i + 1,
              total: episodeNumbers.length,
              url: scrapeResult.streamUrl,
              title: scrapeResult.episodeData?.title || `Episode ${episodeNumber}`,
              sources: videoServers,
            })}\n\n`
          );
        } else {
          throw new Error(scrapeResult.error || "Scraping failed");
        }
      } catch (error) {
        errorCount++;
        consecutiveFailures++;
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            error: error.message,
          })}\n\n`
        );

        const errMsg = (error.message || "").toLowerCase();
        const isNotFound = errMsg.includes("not found") || errMsg.includes("404") || errMsg.includes("could not find") || errMsg.includes("no results");

        if (isNotFound || consecutiveFailures >= 3) {
          console.log(`⏹️ Stopping Sanji Anime batch: ${isNotFound ? 'Anime/episode not found' : 'consecutive failures'}`);
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: isNotFound ? `Not found: ${error.message}` : "Consecutive failures threshold met",
              stoppedAt: episodeNumber,
            })}\n\n`
          );
          break;
        }
      }

      if (res.flush) res.flush();
      // Sleep slightly between episodes
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const successRate = Math.round((successCount / episodeNumbers.length) * 100);
    res.write(
      `data: ${JSON.stringify({
        type: "complete",
        successCount,
        errorCount,
        total: episodeNumbers.length,
        skipped: skippedCount,
        successRate,
      })}\n\n`
    );
    res.end();
  } catch (error) {
    console.error("❌ Batch scrape Sanji Anime error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    } else {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: error.message,
        })}\n\n`
      );
      res.end();
    }
  }
});

// Test gogoanime URL extraction
router.post("/api/test-gogoanime-extract", async (req, res) => {
  try {
    const { gogoanimeUrl } = req.body;

    if (!gogoanimeUrl) {
      return res.status(400).json({
        success: false,
        error: "gogoanimeUrl is required",
      });
    }

    console.log("🔍 Testing gogoanime URL extraction:", gogoanimeUrl);

    const USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // Fetch the gogoanime page
    const response = await axios.get(gogoanimeUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://9anime.org.lv/",
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const html = response.data;
    console.log("✅ Page fetched, HTML length:", html.length);

    const results = {
      megaUrls: [],
      allIframeUrls: [],
      otherVideoUrls: [],
    };

    const megaPattern =
      /https?:\/\/[^"'\s]*mega(?:play|cloud|backup|cdn|stream|\.)[^"'\s]*/gi;
    const megaMatches = [...html.matchAll(megaPattern)];
    results.megaUrls = [
      ...new Set(megaMatches.map((m) => m[0].replace(/["']/g, "").trim())),
    ];

    const iframePattern = /<iframe[^>]*src=["']([^"']+)["']/gi;
    const iframeMatches = [...html.matchAll(iframePattern)];
    results.allIframeUrls = [...new Set(iframeMatches.map((m) => m[1]))];

    const videoPattern =
      /https?:\/\/[^"'\s]*(?:player|embed|stream|video)[^"'\s]*/gi;
    const videoMatches = [...html.matchAll(videoPattern)];
    results.otherVideoUrls = [
      ...new Set(videoMatches.map((m) => m[0].replace(/["']/g, "").trim())),
    ];

    console.log("📊 Found:", {
      megaUrls: results.megaUrls.length,
      iframes: results.allIframeUrls.length,
      videos: results.otherVideoUrls.length,
    });

    res.json({
      success: true,
      url: gogoanimeUrl,
      htmlLength: html.length,
      results,
      recommended:
        results.megaUrls[0] ||
        results.allIframeUrls.find((u) =>
          u.match(/mega(play|cloud|backup|cdn|stream)/i)
        ) ||
        results.allIframeUrls[0],
    });
  } catch (error) {
    console.error("❌ Extraction Error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.status
        ? `HTTP ${error.response.status}`
        : "Request failed",
    });
  }
});

// Test scraper endpoint
router.post("/api/test-scraper", async (req, res) => {
  try {
    console.log("🧪 API: Testing scraper...");

    const { animeTitle = "One Piece", episodeNumber = 1, animeId = null } = req.body;
    console.log(
      `🎬 Testing with anime: "${animeTitle}", Episode ${episodeNumber}${animeId ? ` (ID: ${animeId})` : ''}`
    );

    const result = await NineAnimeScraperService.scrapeAnimeEpisode(
      animeTitle,
      episodeNumber,
      {
        timeout: 30000,
        retries: 2,
        dbAnimeId: animeId,
      }
    );

    res.json({
      success: result.success,
      message: result.success
        ? "Scraper test successful!"
        : "Scraper test failed",
      details: result,
    });
  } catch (error) {
    console.error("❌ Test Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Test failed",
    });
  }
});

// Resolve 9anime slug for an anime — finds the correct URL without scraping
router.post("/api/resolve-slug", async (req, res) => {
  try {
    const { animeTitle, animeId } = req.body;

    if (!animeTitle) {
      return res.status(400).json({
        success: false,
        error: "animeTitle is required",
      });
    }

    console.log(`🔍 Resolving 9anime slug for "${animeTitle}" (ID: ${animeId || 'N/A'})`);

    const result = await NineAnimeScraperService.searchAnimeWithCheerio(
      animeTitle,
      1,
      animeId || null
    );

    if (result.success) {
      res.json({
        success: true,
        slug: result.animeId,
        episodeUrl: result.animeLink,
        message: `Resolved slug: "${result.animeId}"`,
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.error || "Could not resolve slug",
      });
    }
  } catch (error) {
    console.error("❌ Resolve slug error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Batch resolve slugs for multiple anime
router.post("/api/batch-resolve-slugs", async (req, res) => {
  try {
    const { animeList } = req.body;

    if (!animeList || !Array.isArray(animeList)) {
      return res.status(400).json({
        success: false,
        error: "animeList array is required (each item: { title, id })",
      });
    }

    console.log(`🔍 Batch resolving slugs for ${animeList.length} anime...`);

    const results = [];
    for (const anime of animeList) {
      try {
        const result = await NineAnimeScraperService.searchAnimeWithCheerio(
          anime.title,
          1,
          anime.id || null
        );
        results.push({
          title: anime.title,
          id: anime.id,
          success: result.success,
          slug: result.success ? result.animeId : null,
          error: result.success ? null : result.error,
        });
      } catch (e) {
        results.push({
          title: anime.title,
          id: anime.id,
          success: false,
          slug: null,
          error: e.message,
        });
      }
      // Rate limit between requests
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const resolved = results.filter((r) => r.success).length;
    res.json({
      success: true,
      resolved,
      failed: results.length - resolved,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error("❌ Batch resolve error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Scrape all episodes endpoint
router.post("/api/scrape-all-episodes", async (req, res) => {
  try {
    console.log("🎬 API: Scraping all episodes...");

    const { animeTitle, animeId, maxEpisodes = 20 } = req.body;

    if (!animeTitle) {
      return res.status(400).json({
        success: false,
        error: "Anime title is required",
      });
    }

    if (!animeId) {
      return res.status(400).json({
        success: false,
        error: "Anime ID is required",
      });
    }

    console.log(
      `🎬 Scraping all episodes for: "${animeTitle}" (max ${maxEpisodes})`
    );

    const result = await NineAnimeScraperService.scrapeAllEpisodes(animeTitle, {
      animeId,
      dbAnimeId: animeId,
      maxEpisodes,
      timeout: 60000, // 1 minute total
      retries: 2,
    });

    if (result.success) cacheInvalidateAnime(animeId);

    res.json({
      success: result.success,
      message: result.success
        ? "All episodes scraped successfully!"
        : "Failed to scrape episodes",
      data: result,
    });
  } catch (error) {
    console.error("❌ Scrape all episodes error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Batch scrape episodes endpoint
router.post("/api/batch-scrape-episodes", async (req, res) => {
  try {
    console.log("🎬 API: Batch scraping episodes...");

    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    // Extract overwrite option
    const overwrite = req.body.overwrite || options.overwrite || false;

    // Pre-check: skip episodes that already have a video_url in the DB (only if overwrite is false)
    let epsToScrape = episodeNumbers;
    if (!overwrite) {
      try {
        const { data: existing } = await supabase
          .from('episodes')
          .select('episode_number')
          .eq('anime_id', animeId)
          .not('video_url', 'is', null)
          .in('episode_number', episodeNumbers);

        if (existing && existing.length > 0) {
          const alreadyDone = new Set(existing.map(e => e.episode_number));
          epsToScrape = episodeNumbers.filter(n => !alreadyDone.has(n));
          console.log(`⏭️ Skipping ${existing.length} episodes that already have stream URLs`);
        }
      } catch (e) {
        console.warn('⚠️ Pre-check failed, scraping all:', e.message);
      }
    } else {
      console.log(`🔄 HiAnime/9Anime Overwrite/Rescrape requested. Scraping all requested episodes regardless of existing URLs.`);
    }

    console.log(
      `🎬 Batch scraping ${epsToScrape.length}/${episodeNumbers.length} episodes for: "${animeTitle}"`
    );

    if (epsToScrape.length === 0) {
      return res.json({
        success: true,
        message: 'All episodes already have stream URLs',
        results: [],
        summary: {
          totalEpisodes: episodeNumbers.length,
          successCount: episodeNumbers.length,
          errorCount: 0,
          successRate: 100,
          skipped: episodeNumbers.length,
        },
      });
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Resolve the anime slug once — check DB cache first, fall back to search
    let resolvedSlug = null;

    // 1. Try DB cache
    try {
      const { data: cacheRow } = await supabase
        .from("anime")
        .select("scraper_urls")
        .eq("id", animeId)
        .single();

      if (cacheRow?.scraper_urls?.nineanime) {
        resolvedSlug = cacheRow.scraper_urls.nineanime;
        console.log(`⚡ 9Anime cache HIT: ${resolvedSlug}`);
      }
    } catch (e) {
      console.warn("⚠️ 9Anime cache read failed:", e.message);
    }

    // 2. If no cache, search then save
    if (!resolvedSlug) {
      const isUrl = /^https?:\/\//i.test(animeTitle);
      if (isUrl) {
        const match = animeTitle.match(/\/watch\/([^\/]+)/);
        if (match && match[1]) {
          resolvedSlug = match[1];
        }
      }

      if (!resolvedSlug) {
        try {
          const slugResult = await NineAnimeScraperService.searchAnimeWithCheerio(
            animeTitle, 1, animeId
          );
          if (slugResult.success) {
            resolvedSlug = slugResult.animeId;
            console.log(`✅ 9Anime resolved slug (fresh): ${resolvedSlug}`);

            // Save to DB cache
            try {
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), nineanime: resolvedSlug };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 9Anime slug cache saved`);
            } catch (saveErr) {
              console.warn("⚠️ 9Anime cache save failed:", saveErr.message);
            }
          }
        } catch (e) {
          console.warn("⚠️ Pre-resolve slug failed, will resolve per-episode:", e.message);
        }
      }
    }

    if (!resolvedSlug) {
      console.log(`❌ Anime/Season "${animeTitle}" not found on 9Anime. Aborting batch.`);
      return res.json({
        success: false,
        error: `Anime/Season "${animeTitle}" not found on 9Anime. Aborting batch.`,
        summary: {
          totalEpisodes: episodeNumbers.length,
          successCount: 0,
          errorCount: epsToScrape.length,
          successRate: 0,
          skipped: episodeNumbers.length - epsToScrape.length,
        },
      });
    }

    // Scrape each episode (stop early on consecutive failures — episodes are sequential)
    let consecutiveFailures = 0;
    for (const episodeNumber of epsToScrape) {
      try {
        console.log(`[Batch] Scraping episode ${episodeNumber}...`);

        let scrapeResult;
        if (resolvedSlug) {
          // Fast path: use the pre-resolved slug directly
          const episodeUrl = `${NineAnimeScraperService.BASE_URL}/${resolvedSlug}-episode-${episodeNumber}/`;
          const videoResult = await enqueue(() =>
            NineAnimeScraperService.extractVideoWithPuppeteer(
              episodeUrl, resolvedSlug, episodeNumber, { timeout: options.timeout || 30000 }
            )
          );

          if (videoResult.success && videoResult.streamUrl) {
            // Save to DB
            await NineAnimeScraperService.saveEpisodeToDatabase({
              animeId,
              episodeNumber,
              title: `${animeTitle} - Episode ${episodeNumber}`,
              videoUrl: videoResult.streamUrl,
              thumbnailUrl: null,
              duration: 1440,
              description: `Episode ${episodeNumber} of ${animeTitle}`,
              createdAt: new Date(),
            });
            scrapeResult = { success: true, streamUrl: videoResult.streamUrl, episodeData: videoResult.episodeData };
          } else {
            scrapeResult = videoResult;
          }
        } else {
          // Fallback: full resolution per episode (scrapeAndSaveEpisode saves to DB)
          scrapeResult = await NineAnimeScraperService.scrapeAndSaveEpisode(
            animeTitle, animeId, episodeNumber,
            { timeout: options.timeout || 30000, retries: options.retries || 2 }
          );
        }

        if (scrapeResult.success && scrapeResult.streamUrl) {
          successCount++;
          consecutiveFailures = 0;
          results.push({
            episode: episodeNumber,
            status: "success",
            url: scrapeResult.streamUrl,
            title: scrapeResult.episodeData?.title || `Episode ${episodeNumber}`,
            scrapedAt: new Date().toISOString(),
          });
        } else if (scrapeResult.success && scrapeResult.skipped) {
          console.log(`❌ Anime/Season not found on 9Anime. Aborting batch.`);
          results.push({
            episode: episodeNumber,
            status: "skipped",
            error: scrapeResult.error || "Anime/Season not found",
            scrapedAt: new Date().toISOString(),
          });
          break;
        } else {
          throw new Error(scrapeResult.error || "Scraping failed");
        }
      } catch (error) {
        console.error(`❌ Episode ${episodeNumber} failed:`, error.message);
        errorCount++;
        consecutiveFailures++;
        results.push({
          episode: episodeNumber,
          status: "failed",
          error: error.message,
        });

        const errMsg = (error.message || "").toLowerCase();
        const isNotFound = errMsg.includes("not found") || errMsg.includes("404") || errMsg.includes("could not find") || errMsg.includes("no results");

        if (isNotFound || consecutiveFailures >= 2) {
          console.log(`⏹️ Stopping batch: ${isNotFound ? 'Anime/episode not found' : 'consecutive failures'}`);
          break;
        }
      }

      // Add delay between episodes
      if (episodeNumber < epsToScrape[epsToScrape.length - 1]) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayBetweenEpisodes || 2000)
        );
      }
    }

    const totalDone = successCount + (episodeNumbers.length - epsToScrape.length);
    const successRate = episodeNumbers.length > 0 ? (totalDone / episodeNumbers.length) * 100 : 0;

    console.log(
      `[Batch] Scraping completed: ${successCount}/${epsToScrape.length} newly scraped, ${episodeNumbers.length - epsToScrape.length} already had URLs`
    );

    if (successCount > 0) cacheInvalidateAnime(animeId);

    res.json({
      success: true,
      message: `Batch scraping completed: ${totalDone}/${episodeNumbers.length} episodes have stream URLs`,
      results,
      summary: {
        totalEpisodes: episodeNumbers.length,
        successCount: totalDone,
        errorCount,
        successRate: Math.round(successRate * 10) / 10,
        skipped: episodeNumbers.length - epsToScrape.length,
      },
    });
  } catch (error) {
    console.error("❌ Batch scrape error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Streaming batch scrape endpoint with real-time progress
router.post("/api/batch-scrape-episodes-stream", async (req, res) => {
  try {
    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    // Set headers for Server-Sent Events
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    console.log(
      `🎬 Streaming batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

    // Extract overwrite option
    const overwrite = req.body.overwrite || options.overwrite || false;

    // Pre-check: skip episodes that already have a video_url (only if overwrite is false)
    let epsToScrape = episodeNumbers;
    let skippedCount = 0;
    if (!overwrite) {
      try {
        const { data: existing } = await supabase
          .from('episodes')
          .select('episode_number')
          .eq('anime_id', animeId)
          .not('video_url', 'is', null)
          .in('episode_number', episodeNumbers);

        if (existing && existing.length > 0) {
          const alreadyDone = new Set(existing.map(e => e.episode_number));
          epsToScrape = episodeNumbers.filter(n => !alreadyDone.has(n));
          skippedCount = existing.length;
          console.log(`⏭️ Skipping ${skippedCount} episodes that already have stream URLs`);
        }
      } catch (e) {
        console.warn('⚠️ Pre-check failed, scraping all:', e.message);
      }
    } else {
      console.log(`🔄 HiAnime/9Anime Overwrite/Rescrape requested. Scraping all requested episodes regardless of existing URLs.`);
    }

    let successCount = skippedCount;
    let errorCount = 0;

    // Send initial progress
    res.write(
      `data: ${JSON.stringify({
        type: "start",
        total: episodeNumbers.length,
        toScrape: epsToScrape.length,
        skipped: skippedCount,
        animeTitle,
      })}\n\n`
    );
    if (res.flush) res.flush();

    if (epsToScrape.length === 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount,
          errorCount: 0,
          total: episodeNumbers.length,
          skipped: skippedCount,
          successRate: 100,
        })}\n\n`
      );
      return res.end();
    }

    // Resolve the anime slug once — check DB cache first, fall back to search
    let resolvedSlug = null;

    // 1. Try DB cache
    try {
      const { data: cacheRow } = await supabase
        .from("anime")
        .select("scraper_urls")
        .eq("id", animeId)
        .single();

      if (cacheRow?.scraper_urls?.nineanime) {
        resolvedSlug = cacheRow.scraper_urls.nineanime;
        console.log(`⚡ 9Anime cache HIT: ${resolvedSlug}`);
      }
    } catch (e) {
      console.warn("⚠️ 9Anime cache read failed:", e.message);
    }

    // 2. If no cache, search then save
    if (!resolvedSlug) {
      const isUrl = /^https?:\/\//i.test(animeTitle);
      if (isUrl) {
        const match = animeTitle.match(/\/watch\/([^\/]+)/);
        if (match && match[1]) {
          resolvedSlug = match[1];
        }
      }

      if (!resolvedSlug) {
        try {
          const slugResult = await NineAnimeScraperService.searchAnimeWithCheerio(
            animeTitle, 1, animeId
          );
          if (slugResult.success) {
            resolvedSlug = slugResult.animeId;
            console.log(`✅ 9Anime resolved slug (fresh): ${resolvedSlug}`);

            try {
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), nineanime: resolvedSlug };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 9Anime slug cache saved`);
            } catch (saveErr) {
              console.warn("⚠️ 9Anime cache save failed:", saveErr.message);
            }
          }
        } catch (e) {
          console.warn("⚠️ Pre-resolve slug failed:", e.message);
        }
      }
    }

    if (!resolvedSlug) {
      console.log(`❌ Anime/Season "${animeTitle}" not found on 9Anime. Aborting batch.`);
      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          successCount: 0,
          errorCount: epsToScrape.length,
          total: episodeNumbers.length,
          skipped: episodeNumbers.length - epsToScrape.length,
          successRate: 0,
          error: `Anime/Season "${animeTitle}" not found on 9Anime. Aborting batch.`
        })}\n\n`
      );
      return res.end();
    }

    // Scrape each episode (stop early on consecutive failures)
    let consecutiveFailures = 0;
    for (let i = 0; i < epsToScrape.length; i++) {
      const episodeNumber = epsToScrape[i];

      try {
        res.write(
          `data: ${JSON.stringify({
            type: "progress",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            status: "scraping",
          })}\n\n`
        );

        let scrapeResult;
        if (resolvedSlug) {
          const episodeUrl = `${NineAnimeScraperService.BASE_URL}/${resolvedSlug}-episode-${episodeNumber}/`;
          const videoResult = await enqueue(() =>
            NineAnimeScraperService.extractVideoWithPuppeteer(
              episodeUrl, resolvedSlug, episodeNumber, { timeout: options.timeout || 30000 }
            )
          );

          if (videoResult.success && videoResult.streamUrl) {
            await NineAnimeScraperService.saveEpisodeToDatabase({
              animeId,
              episodeNumber,
              title: `${animeTitle} - Episode ${episodeNumber}`,
              videoUrl: videoResult.streamUrl,
              thumbnailUrl: null,
              duration: 1440,
              description: `Episode ${episodeNumber} of ${animeTitle}`,
              createdAt: new Date(),
            });
            scrapeResult = { success: true, streamUrl: videoResult.streamUrl, episodeData: videoResult.episodeData };
          } else {
            scrapeResult = videoResult;
          }
        } else {
          // Fallback: full resolution per episode (scrapeAndSaveEpisode saves to DB)
          scrapeResult = await NineAnimeScraperService.scrapeAndSaveEpisode(
            animeTitle, animeId, episodeNumber,
            { timeout: options.timeout || 30000, retries: options.retries || 2 }
          );
        }

        if (scrapeResult.success && scrapeResult.streamUrl) {
          successCount++;
          consecutiveFailures = 0;
          res.write(
            `data: ${JSON.stringify({
              type: "success",
              episode: episodeNumber,
              current: skippedCount + i + 1,
              total: episodeNumbers.length,
              url: scrapeResult.streamUrl,
              title: scrapeResult.episodeData?.title || `Episode ${episodeNumber}`,
            })}\n\n`
          );
        } else if (scrapeResult.success && scrapeResult.skipped) {
          console.log(`❌ Anime/Season not found on 9Anime. Aborting batch.`);
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              episode: episodeNumber,
              current: skippedCount + i + 1,
              total: episodeNumbers.length,
              error: `Skipped: ${scrapeResult.error || "Anime/Season not found"}`,
            })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: `Anime/Season not found on 9Anime: ${scrapeResult.error || "Not found"}`,
              stoppedAt: episodeNumber,
            })}\n\n`
          );
          break;
        } else {
          throw new Error(scrapeResult.error || "Scraping failed");
        }
      } catch (error) {
        errorCount++;
        consecutiveFailures++;
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            episode: episodeNumber,
            current: skippedCount + i + 1,
            total: episodeNumbers.length,
            error: error.message,
          })}\n\n`
        );

        const errMsg = (error.message || "").toLowerCase();
        const isNotFound = errMsg.includes("not found") || errMsg.includes("404") || errMsg.includes("could not find") || errMsg.includes("no results");

        if (isNotFound || consecutiveFailures >= 2) {
          console.log(`⏹️ Stopping batch: ${isNotFound ? 'Anime/episode not found' : 'consecutive failures'}`);
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: isNotFound ? `Not found: ${error.message}` : "Consecutive failures threshold met",
              stoppedAt: episodeNumber,
            })}\n\n`
          );
          break;
        }
      }

      if (i < epsToScrape.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayBetweenEpisodes || 2000)
        );
      }
    }

    if (successCount > skippedCount) cacheInvalidateAnime(animeId);

    res.write(
      `data: ${JSON.stringify({
        type: "complete",
        successCount,
        errorCount,
        total: episodeNumbers.length,
        skipped: skippedCount,
        successRate:
          Math.round((successCount / episodeNumbers.length) * 100 * 10) / 10,
      })}\n\n`
    );

    res.end();
  } catch (error) {
    console.error("❌ Streaming batch scrape error:", error);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: error.message,
      })}\n\n`
    );
    res.end();
  }
});

export default router;
