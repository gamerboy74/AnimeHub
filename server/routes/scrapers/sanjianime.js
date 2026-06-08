import express from "express";
import { supabase } from "../../config/supabase.js";
import { enqueue, getBrowser } from "../../services/queue.js";
import { cacheInvalidateAnime } from "../../services/cache.js";
import { SanjiAnimeScraperService } from "../../scrapers/sanjianime.js";
import { mergeVideoServers } from "../../scrapers/manager.js";
import { requireAdmin } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

// Single episode Sanji Anime scraping endpoint
router.post("/scrape-sanjianime-episode", async (req, res) => {
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
    const isRawUrl = /^https?:\/\//i.test(targetUrl);

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

    // If still using the raw title (no cache hit, no URL given), pre-resolve and
    // cache the base watch URL BEFORE scraping — so a failed stream extraction
    // (e.g. ep1 "not available") doesn't lose the resolved anime URL.
    if (animeId && !isRawUrl && resolvedInputUrl === targetUrl) {
      try {
        const browser = await getBrowser();
        if (browser) {
          const ctx = await browser.newContext({
            userAgent: SanjiAnimeScraperService.USER_AGENT,
            viewport: { width: 1280, height: 720 },
          });
          const pg = await ctx.newPage();
          const preResolved = await SanjiAnimeScraperService.resolveWatchUrlWithPage(
            pg, targetUrl, episodeNumber
          );
          await ctx.close();

          if (preResolved) {
            // Strip episode suffix to get the base watch URL
            let cleanBase = preResolved;
            const m = preResolved.match(/(.*\/watch\/[^\/]+?)(?:-episode-\d+)?(?:\?|$)/i);
            if (m && m[1]) cleanBase = m[1];

            resolvedInputUrl = preResolved; // use full URL (with ep) for this scrape
            console.log(`🔗 Sanji Anime pre-resolved watch URL: ${preResolved}`);

            // Save base URL to DB cache right now
            try {
              const { data: existing } = await supabase
                .from("anime")
                .select("scraper_urls")
                .eq("id", animeId)
                .single();
              const merged = { ...(existing?.scraper_urls || {}), [cacheKey]: cleanBase };
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
              console.log(`💾 Sanji Anime base URL pre-cached [${cacheKey}]: ${cleanBase}`);
            } catch (saveErr) {
              console.warn("⚠️ Sanji Anime pre-cache save failed:", saveErr.message);
            }
          }
        }
      } catch (preErr) {
        console.warn("⚠️ Sanji Anime pre-resolve failed, falling back to title search:", preErr.message);
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

    // Update the cache if the scrape returned a (possibly more specific) watchUrl
    if (result.success && result.watchUrl && animeId) {
      try {
        // Normalise to base watch URL (strip -episode-N suffix)
        let cacheBase = result.watchUrl;
        const m = result.watchUrl.match(/(.*\/watch\/[^\/]+?)(?:-episode-\d+)?(?:\?|$)/i);
        if (m && m[1]) cacheBase = m[1];

        const { data: existing } = await supabase
          .from("anime")
          .select("scraper_urls")
          .eq("id", animeId)
          .single();

        const currentCache = existing?.scraper_urls || {};
        if (currentCache[cacheKey] !== cacheBase) {
          const merged = { ...currentCache, [cacheKey]: cacheBase };
          await supabase.from("anime").update({ scraper_urls: merged }).eq("id", animeId);
          console.log(`💾 Sanji Anime watch URL cached (post-scrape): ${cacheBase}`);
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

// Streaming batch scrape endpoint for Sanji Anime with real-time progress
router.post("/batch-scrape-sanjianime-episodes-stream", async (req, res) => {
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
      `🎬 Streaming Sanji Anime batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

    const overwrite = req.body.overwrite || options.overwrite || false;
    const reqLang = options.lang || "dub";

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

    const cacheKey = "sanjianime_watch";
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
          console.log(`⚡ Sanji Anime cache HIT [${cacheKey}]: ${baseWatchUrl}`);
        }
      } catch (e) {
        console.warn("⚠️ Sanji Anime cache read failed:", e.message);
      }
    }

    if (!baseWatchUrl) {
      try {
        const browser = await getBrowser();
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
          const resolvedWatch = scrapeResult.watchUrl || scrapeResult.episodeData?.watchUrl;
          if (resolvedWatch && !baseWatchUrl) {
            try {
              const urlObj = new URL(resolvedWatch);
              urlObj.pathname = urlObj.pathname.replace(/\/episode-\d+$/i, "");
              baseWatchUrl = urlObj.toString();
              console.log(`💾 Sanji Anime dynamically cached watch URL for this batch: ${baseWatchUrl}`);

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

        // Only stop the entire batch when the ANIME itself is not on the site.
        // Per-episode errors (redirect, "not available yet", no playable URL) are
        // transient — log them and keep going.
        const isAnimeNotFound =
          errMsg.includes("could not find a secure search result") ||
          errMsg.includes("no results") ||
          (errMsg.includes("not found") && !errMsg.includes("episode") && !errMsg.includes("redirected") && !errMsg.includes("not available"));

        if (isAnimeNotFound) {
          console.log(`⏹️ Stopping Sanji Anime batch: anime not found on site`);
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: `Anime not found on SanjiAnime: ${error.message}`,
              stoppedAt: episodeNumber,
            })}\n\n`
          );
          break;
        }

        if (consecutiveFailures >= 3) {
          console.log(`⏹️ Stopping Sanji Anime batch: ${consecutiveFailures} consecutive failures`);
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: "Consecutive failures threshold met",
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
    console.error("❌ Batch scrape Sanji Anime error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
