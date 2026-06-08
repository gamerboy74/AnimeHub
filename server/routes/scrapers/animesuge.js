import express from "express";
import { supabase } from "../../config/supabase.js";
import { enqueue, getBrowser } from "../../services/queue.js";
import { cacheInvalidateAnime } from "../../services/cache.js";
import { AnimeSugeScraperService } from "../../scrapers/animesuge.js";
import { mergeVideoServers } from "../../scrapers/manager.js";
import { requireAdmin } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

// Single episode AnimeSuge scraping endpoint
router.post("/scrape-animesuge-episode", async (req, res) => {
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
router.post("/batch-scrape-animesuge-episodes-stream", async (req, res) => {
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
      `🎬 Streaming AnimeSuge batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

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
    let isFromCache = false;

    const isUrl = /^https?:\/\//i.test(animeTitle);
    if (isUrl) {
      baseWatchUrl = animeTitle;
    }

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

    if (!baseWatchUrl) {
      try {
        const browser = await getBrowser();
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
          const resolvedWatch = scrapeResult.watchUrl || scrapeResult.episodeData?.watchUrl;
          if (resolvedWatch && !baseWatchUrl) {
            try {
              const urlObj = new URL(resolvedWatch);
              urlObj.pathname = urlObj.pathname.replace(/\/ep-\d+$/i, "");
              baseWatchUrl = urlObj.toString();
              console.log(`💾 AnimeSuge dynamically cached watch URL for this batch: ${baseWatchUrl}`);

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
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
