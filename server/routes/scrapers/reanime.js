import express from "express";
import { supabase } from "../../config/supabase.js";
import { enqueue, getBrowser } from "../../services/queue.js";
import { cacheInvalidateAnime } from "../../services/cache.js";
import { ReAnimeScraperService } from "../../scrapers/reanime.js";
import { mergeVideoServers } from "../../scrapers/manager.js";
import { requireAdmin } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

// Single episode Re:ANIME scraping endpoint
router.post("/scrape-reanime-episode", async (req, res) => {
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

// Streaming batch scrape endpoint for Re:ANIME with real-time progress
router.post("/batch-scrape-reanime-episodes-stream", async (req, res) => {
  try {
    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    console.log(
      `🎬 Streaming Re:ANIME batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

    const overwrite = req.body.overwrite || options.overwrite || false;
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

    const cacheKey = "reanime_watch";
    let baseWatchUrl = null;

    const isUrl = /^https?:\/\//i.test(animeTitle);
    if (isUrl) {
      baseWatchUrl = animeTitle;
    }

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

    if (!baseWatchUrl) {
      try {
        const browser = await getBrowser();
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
          const resolvedWatch = scrapeResult.watchUrl || scrapeResult.episodeData?.watchUrl;
          if (resolvedWatch && !baseWatchUrl) {
            try {
              const urlObj = new URL(resolvedWatch);
              urlObj.searchParams.delete("ep");
              urlObj.searchParams.delete("lang");
              baseWatchUrl = urlObj.toString();
              console.log(`💾 Re:ANIME dynamically cached watch URL for this batch: ${baseWatchUrl}`);

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
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
