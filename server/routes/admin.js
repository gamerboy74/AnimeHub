import express from "express";
import axios from "axios";
import { supabase } from "../config/supabase.js";
import { cacheGet, cacheSet, cacheInvalidateAnime, cacheMiddleware } from "../services/cache.js";
import { NineAnimeScraperService } from "../scrapers/nineanime.js";
import { formatDuration } from "../scheduler.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// Secure all /api/admin/* endpoints
router.use("/api/admin", requireAdmin);

// Add scraped episode to database endpoint
router.post("/api/add-scraped-episode", requireAdmin, async (req, res) => {
  try {
    console.log("💾 API: Adding scraped episode to database...");

    const { animeId, episodeData } = req.body;

    if (!animeId || !episodeData) {
      return res.status(400).json({
        success: false,
        error: "Anime ID and episode data are required",
      });
    }

    const { data: existingEpisode, error: checkError } = await supabase
      .from("episodes")
      .select("id, title")
      .eq("anime_id", animeId)
      .eq("episode_number", episodeData.number)
      .maybeSingle();

    let data, error;

    const scrapeLang = episodeData.lang || (episodeData.streamUrl && episodeData.streamUrl.toLowerCase().includes('dub') ? 'dub' : 'sub');
    const newServers = (episodeData.servers || (episodeData.streamUrl ? [{ name: "Server 1", url: episodeData.streamUrl }] : [])).map(s => ({
      name: s.name || s.label || "Server",
      url: s.url || s.iframeUrl,
      lang: s.lang || scrapeLang
    }));

    if (existingEpisode && !checkError) {
      console.log(
        `📝 Updating existing episode ${episodeData.number} for anime ${animeId}`
      );

      const hasBeautifulTitle = existingEpisode.title &&
        !existingEpisode.title.toLowerCase().startsWith("episode") &&
        existingEpisode.title.trim() !== String(episodeData.number);

      const titleToUpdate = hasBeautifulTitle ? existingEpisode.title : episodeData.title;

      const { data: currentEp } = await supabase
        .from("episodes")
        .select("video_servers")
        .eq("id", existingEpisode.id)
        .single();

      let mergedServers = [...newServers];
      if (currentEp && Array.isArray(currentEp.video_servers)) {
        const otherServers = currentEp.video_servers.filter(
          existS => !newServers.some(newS => newS.url === existS.url)
        );
        mergedServers = [...otherServers, ...newServers];
      }

      const updateResult = await supabase
        .from("episodes")
        .update({
          title: titleToUpdate,
          video_url: episodeData.streamUrl,
          video_servers: mergedServers,
          duration: episodeData.duration || 1440,
          description: `Scraped from 9anime.org.lv - ${episodeData.embeddingProtected
            ? "May have embedding protection"
            : "Embedding friendly"
            }`,
        })
        .eq("anime_id", animeId)
        .eq("episode_number", episodeData.number)
        .select()
        .single();

      data = updateResult.data;
      error = updateResult.error;
    } else {
      console.log(
        `➕ Inserting new episode ${episodeData.number} for anime ${animeId}`
      );
      const insertResult = await supabase
        .from("episodes")
        .insert({
          anime_id: animeId,
          episode_number: episodeData.number,
          title: episodeData.title,
          video_url: episodeData.streamUrl,
          video_servers: newServers,
          duration: episodeData.duration || 1440,
          thumbnail_url: null,
          description: `Scraped from 9anime.org.lv - ${episodeData.embeddingProtected
            ? "May have embedding protection"
            : "Embedding friendly"
            }`,
          is_premium: false,
        })
        .select()
        .single();

      data = insertResult.data;
      error = insertResult.error;
    }

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    console.log(
      `` + `✅ Episode ${episodeData.number} ${existingEpisode ? "updated" : "added"} to database`
    );

    cacheInvalidateAnime(animeId);

    res.json({
      success: true,
      message: `Episode ${episodeData.number} ${existingEpisode ? "updated" : "added"} successfully!`,
      episode: data,
    });
  } catch (error) {
    console.error("❌ Add episode error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Create anime
router.post("/api/admin/anime", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("anime")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error("❌ Admin create anime error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update anime
router.put("/api/admin/anime/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("anime")
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error("❌ Admin update anime error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete anime
router.delete("/api/admin/anime/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("anime")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Admin delete anime error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk delete anime
router.post("/api/admin/anime/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ success: false, error: "ids required" });
    const { error } = await supabase.from("anime").delete().in("id", ids);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Admin bulk delete anime error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create episode
router.post("/api/admin/episodes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("episodes")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error("❌ Admin create episode error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update episode
router.put("/api/admin/episodes/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("episodes")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error("❌ Admin update episode error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete episode
router.delete("/api/admin/episodes/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("episodes")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Admin delete episode error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update anime request status
router.put("/api/admin/anime-requests/:id", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: "status required" });
    const { data, error } = await supabase
      .from("anime_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error("❌ Admin update anime request status error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start large anime scraping job
router.post("/api/start-large-scrape", requireAdmin, async (req, res) => {
  try {
    console.log("🎬 API: Starting large anime scraping job...");

    const { animeId, animeTitle, totalEpisodes, chunkSize = 50 } = req.body;

    if (!animeId || !animeTitle || !totalEpisodes) {
      return res.status(400).json({
        success: false,
        error: "Anime ID, title, and total episodes are required",
      });
    }

    const totalChunks = Math.ceil(totalEpisodes / chunkSize);

    const { data: progressData, error: progressError } = await supabase
      .from("scraping_progress")
      .upsert(
        {
          anime_id: animeId,
          anime_title: animeTitle,
          total_episodes: totalEpisodes,
          completed_episodes: 0,
          failed_episodes: 0,
          current_chunk: 1,
          total_chunks: totalChunks,
          chunk_size: chunkSize,
          status: "in_progress",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "anime_id",
        }
      )
      .select()
      .single();

    if (progressError) {
      throw new Error(`Database error: ${progressError.message}`);
    }

    const episodeLogs = [];
    for (let episode = 1; episode <= totalEpisodes; episode++) {
      const chunkNumber = Math.ceil(episode / chunkSize);
      episodeLogs.push({
        scraping_progress_id: progressData.id,
        episode_number: episode,
        chunk_number: chunkNumber,
        status: "pending",
        created_at: new Date().toISOString(),
      });
    }

    const { error: logError } = await supabase
      .from("episode_scraping_log")
      .upsert(episodeLogs, {
        onConflict: "scraping_progress_id,episode_number",
      });

    if (logError) {
      console.warn("Warning: Could not create episode logs:", logError.message);
    }

    console.log(
      `✅ Large scraping job started: ${animeTitle} (${totalEpisodes} episodes, ${totalChunks} chunks)`
    );

    res.json({
      success: true,
      message: `Large scraping job started for ${animeTitle}`,
      jobId: progressData.id,
      totalEpisodes,
      totalChunks,
      chunkSize,
    });
  } catch (error) {
    console.error("❌ Start large scrape error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get scraping progress
router.get(
  "/api/scraping-progress/:animeId",
  requireAdmin,
  cacheMiddleware(3_000),
  async (req, res) => {
    try {
      const { animeId } = req.params;

      const { data: progress, error } = await supabase
        .from("scraping_progress")
        .select(
          `
        *,
        episode_scraping_log (
          episode_number,
          status,
          error_message,
          scraped_at
        )
      `
        )
        .eq("anime_id", animeId)
        .single();

      if (error) {
        return res.status(404).json({
          success: false,
          error: "Scraping progress not found",
        });
      }

      const progressPercentage =
        progress.total_episodes > 0
          ? Math.round(
            (progress.completed_episodes / progress.total_episodes) * 100
          )
          : 0;

      const startedAt = new Date(progress.started_at);
      const now = new Date();
      const elapsedMs = now - startedAt;
      const episodesPerMs = progress.completed_episodes / elapsedMs;
      const remainingEpisodes =
        progress.total_episodes - progress.completed_episodes;
      const estimatedMsRemaining =
        episodesPerMs > 0 ? remainingEpisodes / episodesPerMs : 0;

      const estimatedTimeRemaining =
        estimatedMsRemaining > 0
          ? formatDuration(estimatedMsRemaining)
          : "Calculating...";

      res.json({
        success: true,
        progress: {
          ...progress,
          progressPercentage,
          estimatedTimeRemaining,
          episodesPerMs: episodesPerMs * 1000,
        },
      });
    } catch (error) {
      console.error("❌ Get progress error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Scrape a single chunk
router.post("/api/scrape-chunk", requireAdmin, async (req, res) => {
  try {
    console.log("🎬 API: Scraping chunk...");

    const {
      animeId,
      animeTitle,
      chunkNumber,
      chunkSize = 50,
      progressId,
    } = req.body;

    if (!animeId || !animeTitle || chunkNumber === undefined || !progressId) {
      return res.status(400).json({
        success: false,
        error: "Anime ID, title, chunk number, and progress ID are required",
      });
    }

    const { data: episodesToScrape, error: logError } = await supabase
      .from("episode_scraping_log")
      .select("episode_number")
      .eq("scraping_progress_id", progressId)
      .eq("chunk_number", chunkNumber)
      .in("status", ["pending", "failed"]);

    if (logError) {
      throw new Error(`Database error: ${logError.message}`);
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const episodeLog of episodesToScrape) {
      const episodeNumber = episodeLog.episode_number;

      try {
        await supabase
          .from("episode_scraping_log")
          .update({ status: "scraping" })
          .eq("scraping_progress_id", progressId)
          .eq("episode_number", episodeNumber);

        const scrapeResult = await NineAnimeScraperService.scrapeAnimeEpisode(
          animeTitle,
          episodeNumber,
          {
            timeout: 30000,
            retries: 2,
            dbAnimeId: animeId,
          }
        );

        if (scrapeResult.success && scrapeResult.streamUrl) {
          const { error: saveError } = await supabase.from("episodes").upsert(
            {
              anime_id: animeId,
              episode_number: episodeNumber,
              title:
                scrapeResult.episodeData?.title || `Episode ${episodeNumber}`,
              video_url: scrapeResult.streamUrl,
              description: `Scraped from 9anime - Chunk ${chunkNumber}`,
              is_premium: false,
            },
            {
              onConflict: "anime_id,episode_number",
            }
          );

          if (saveError) {
            throw new Error(`Database save error: ${saveError.message}`);
          }

          await supabase
            .from("episode_scraping_log")
            .update({
              status: "success",
              video_url: scrapeResult.streamUrl,
              scraped_at: new Date().toISOString(),
            })
            .eq("scraping_progress_id", progressId)
            .eq("episode_number", episodeNumber);

          successCount++;
          results.push({
            episode: episodeNumber,
            status: "success",
            url: scrapeResult.streamUrl,
          });
        } else {
          throw new Error(scrapeResult.error || "Scraping failed");
        }
      } catch (error) {
        console.error(`❌ Episode ${episodeNumber} failed:`, error.message);

        await supabase
          .from("episode_scraping_log")
          .update({
            status: "failed",
            error_message: error.message,
          })
          .eq("scraping_progress_id", progressId)
          .eq("episode_number", episodeNumber);

        errorCount++;
        results.push({
          episode: episodeNumber,
          status: "failed",
          error: error.message,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const { error: updateError } = await supabase
      .from("scraping_progress")
      .update({
        completed_episodes: supabase.raw("completed_episodes + ?", [
          successCount,
        ]),
        failed_episodes: supabase.raw("failed_episodes + ?", [errorCount]),
        current_chunk: chunkNumber + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("anime_id", animeId);

    if (updateError) {
      console.warn("Warning: Could not update progress:", updateError.message);
    }

    console.log(
      `✅ Chunk ${chunkNumber} completed: ${successCount} success, ${errorCount} failed`
    );

    if (successCount > 0) cacheInvalidateAnime(animeId);

    res.json({
      success: true,
      message: `Chunk ${chunkNumber} completed`,
      results,
      summary: {
        totalEpisodes: episodesToScrape.length,
        successCount,
        errorCount,
        successRate:
          episodesToScrape.length > 0
            ? (successCount / episodesToScrape.length) * 100
            : 0,
      },
    });
  } catch (error) {
    console.error("❌ Scrape chunk error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Image proxy endpoint to bypass CORS restrictions
router.get("/api/image-proxy", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL parameter is required",
      });
    }

    let imageUrl;
    try {
      imageUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid URL provided",
      });
    }

    if (imageUrl.protocol !== "https:") {
      return res.status(400).json({
        success: false,
        error: "Only HTTPS URLs are allowed",
      });
    }

    console.log("🖼️ Proxying image:", url);

    const cacheKey = `img:${url}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      console.log("✅ Image from cache");
      const buffer = Buffer.from(cached.data, "base64");
      res.set({
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Cache": "HIT",
      });
      return res.send(buffer);
    }

    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: imageUrl.origin,
      },
      timeout: 10000,
      maxContentLength: 10 * 1024 * 1024,
    });

    const contentType = response.headers["content-type"] || "image/jpeg";
    const buffer = Buffer.from(response.data);

    try {
      await cacheSet(
        cacheKey,
        {
          data: buffer.toString("base64"),
          contentType,
        },
        24 * 60 * 60 * 1000
      );
    } catch (cacheErr) {
      console.warn("Failed to cache image:", cacheErr.message);
    }

    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Cache": "MISS",
      "Access-Control-Allow-Origin": "*",
    });

    res.send(buffer);
  } catch (error) {
    console.error("❌ Image proxy error:", error.message);

    if (url && typeof url === "string") {
      return res.redirect(302, url);
    }

    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return res.status(504).json({
        success: false,
        error: "Image request timed out",
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        error: `Failed to fetch image: ${error.response.statusText}`,
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to proxy image",
    });
  }
});

// Stream proxy endpoint for HLS manifests and segments
router.get("/api/stream-proxy", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url param required" });
    }

    let targetUrl;
    try {
      targetUrl = new URL(decodeURIComponent(url));
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const allowedHosts = [
      "megacloud.tv",
      "megaplay.buzz",
      "megacloud.bloggy.click",
      "rapidcloud.cc",
      "streamsb.net",
      "streamtape.com",
      "hianime.to",
      "cdn.videas.fr",
    ];

    const isAllowed = allowedHosts.some((host) => targetUrl.hostname.includes(host));
    if (!isAllowed) {
      return res.status(403).json({ error: `Host not allowed: ${targetUrl.hostname}` });
    }

    const upstream = await axios.get(targetUrl.toString(), {
      responseType: "arraybuffer",
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        Referer: "https://hianime.to/",
        Origin: "https://hianime.to",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
    });

    const contentType = upstream.headers["content-type"] || "";
    const isM3U8 =
      targetUrl.pathname.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegURL");

    if (isM3U8) {
      const text = Buffer.from(upstream.data).toString("utf-8");
      const baseUrl = targetUrl.toString().substring(0, targetUrl.toString().lastIndexOf("/") + 1);
      const proxyBase = `${req.protocol}://${req.get("host")}/api/stream-proxy?url=`;

      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("#") || trimmed === "") return line;

          if (trimmed.startsWith("http")) {
            return `${proxyBase}${encodeURIComponent(trimmed)}`;
          }

          return `${proxyBase}${encodeURIComponent(baseUrl + trimmed)}`;
        })
        .join("\n");

      return res
        .status(200)
        .set({
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        })
        .send(rewritten);
    }

    res.set({
      "Content-Type": contentType || "video/mp2t",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    });

    return res.send(Buffer.from(upstream.data));
  } catch (error) {
    console.error("[StreamProxy] Error fetching stream", error.message);
    return res.status(502).json({ error: "Failed to proxy stream", details: error.message });
  }
});

export default router;
