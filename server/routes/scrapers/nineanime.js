import express from "express";
import axios from "axios";
import { supabase } from "../../config/supabase.js";
import { enqueue } from "../../services/queue.js";
import { cacheInvalidateAnime } from "../../services/cache.js";
import { NineAnimeScraperService } from "../../scrapers/nineanime.js";
import { requireAdmin } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

// Test gogoanime URL extraction
router.post("/test-gogoanime-extract", async (req, res) => {
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

    const response = await axios.get(gogoanimeUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
router.post("/test-scraper", async (req, res) => {
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
router.post("/resolve-slug", async (req, res) => {
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
router.post("/batch-resolve-slugs", async (req, res) => {
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

// Scrape all episodes endpoint (9Anime)
router.post("/scrape-all-episodes", async (req, res) => {
  try {
    console.log("🎬 API: Scraping all episodes...");

    const { animeTitle, animeId, maxEpisodes = 20 } = req.body;

    if (!animeTitle) {
      return res.status(400).json({ success: false, error: "Anime title is required" });
    }

    if (!animeId) {
      return res.status(400).json({ success: false, error: "Anime ID is required" });
    }

    console.log(`🎬 Scraping all episodes for: "${animeTitle}" (max ${maxEpisodes})`);

    const result = await NineAnimeScraperService.scrapeAllEpisodes(animeTitle, {
      animeId,
      dbAnimeId: animeId,
      maxEpisodes,
      timeout: 60000,
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch scrape episodes endpoint (9Anime, non-streaming)
router.post("/batch-scrape-episodes", async (req, res) => {
  try {
    console.log("🎬 API: Batch scraping episodes...");

    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    const overwrite = req.body.overwrite || options.overwrite || false;

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

    // Resolve the anime slug once
    let resolvedSlug = null;

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

    if (!resolvedSlug) {
      const isUrl = /^https?:\/\//i.test(animeTitle);
      if (isUrl) {
        const match = animeTitle.match(/\/watch\/([^\/]+)/);
        if (match && match[1]) resolvedSlug = match[1];
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

    let consecutiveFailures = 0;
    for (const episodeNumber of epsToScrape) {
      try {
        console.log(`[Batch] Scraping episode ${episodeNumber}...`);

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
    res.status(500).json({ success: false, error: error.message });
  }
});

// Streaming batch scrape endpoint with real-time progress (9Anime)
router.post("/batch-scrape-episodes-stream", async (req, res) => {
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
      `🎬 Streaming batch scrape for ${episodeNumbers.length} episodes: "${animeTitle}"`
    );

    const overwrite = req.body.overwrite || options.overwrite || false;

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

    // Resolve the anime slug once
    let resolvedSlug = null;

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

    if (!resolvedSlug) {
      const isUrl = /^https?:\/\//i.test(animeTitle);
      if (isUrl) {
        const match = animeTitle.match(/\/watch\/([^\/]+)/);
        if (match && match[1]) resolvedSlug = match[1];
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
