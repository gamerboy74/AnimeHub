import express from "express";
import { supabase } from "../../config/supabase.js";
import { enqueue } from "../../services/queue.js";
import { cacheInvalidateAnime } from "../../services/cache.js";
import { CinevoScraperService } from "../../scrapers/cinevo.js";
import { mergeVideoServers } from "../../scrapers/manager.js";
import { requireAdmin } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

// Single episode Cinevo scraping endpoint
router.post("/scrape-cinevo-episode", async (req, res) => {
  try {
    const {
      url,
      watchUrl,
      animeUrl,
      animeTitle,
      episodeNumber = 1,
      options = {},
    } = req.body;

    const targetUrl = url || watchUrl || animeUrl || animeTitle;
    const animeId = req.body.animeId || options.animeId;

    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: url, watchUrl, animeUrl, or animeTitle",
      });
    }

    console.log(
      `🎬 API: Scraping Cinevo for ${targetUrl} (episode ${episodeNumber})`
    );

    let resolvedInputUrl = targetUrl;
    const cacheKey = "cinevo_watch";

    if (animeId && !/^https?:\/\//i.test(targetUrl)) {
      try {
        const { data: cacheRow } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const cachedWatchBase = cacheRow?.scraper_urls?.[cacheKey];
        if (cachedWatchBase) {
          console.log(`⚡ Cinevo cache HIT [${cacheKey}]: ${cachedWatchBase}`);
          resolvedInputUrl = cachedWatchBase;
        }
      } catch (e) {
        console.warn("⚠️ Cinevo cache read failed:", e.message);
      }
    }

    const result = await enqueue(() =>
      CinevoScraperService.scrapeAnimeEpisode(resolvedInputUrl, episodeNumber, {
        timeout: 45000,
        retries: 2,
        ...options,
      }),
      "high"
    );

    if (result.success && result.watchUrl && animeId) {
      try {
        const watchBase = new URL(result.watchUrl);
        watchBase.searchParams.delete("ep");
        watchBase.searchParams.delete("season");
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
          console.log(`💾 Cinevo watch URL cached: ${baseWatchUrl}`);
        }
      } catch (e) {
        console.warn("⚠️ Cinevo cache save failed:", e.message);
      }
    }

    if (result.success && result.streamUrl && animeId) {
      console.log(`💾 API: Saving Cinevo scraped episode to database for anime ${animeId}`);

      const { data: existingEpisode } = await supabase
        .from("episodes")
        .select("id, title")
        .eq("anime_id", animeId)
        .eq("episode_number", episodeNumber)
        .maybeSingle();

      const scrapeLang = options.lang || "sub";
      const videoServers = (result.episodeData?.sources || []).map(s => ({
        name: s.label ? `Cinevo - ${s.label}` : "Cinevo active",
        url: s.iframeUrl,
        lang: s.lang || scrapeLang
      }));

      if (videoServers.length === 0 && result.streamUrl) {
        videoServers.push({
          name: "Cinevo active",
          url: result.streamUrl,
          lang: scrapeLang
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
            description: `Scraped from Cinevo`,
            created_at: new Date().toISOString(),
          });
      }
      cacheInvalidateAnime(animeId);
    }

    res.json(result);
  } catch (error) {
    console.error("❌ Cinevo scrape error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Cinevo scrape failed",
    });
  }
});

export default router;
