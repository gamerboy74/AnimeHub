import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import axios from "axios";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
// Redis removed - using in-memory cache only
// import Redis from 'ioredis';
import { promises as fs } from "fs";
import { resolve as resolvePath, join, dirname } from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";
import crypto from "crypto";
import {
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.js";
import {
  getHelmetConfig,
  getCorsConfig,
  rateLimiter,
  sanitizeInput,
  validateRequestSize,
} from "./middleware/security.js";
import { getHealthHandler, getDetailedHealthHandler } from "./routes/health.js";

// Get the directory name of the current module (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (one level up from server/)
dotenv.config({ path: join(__dirname, "..", ".env") });

// Apply stealth plugin to avoid detection
chromium.use(StealthPlugin());

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const app = express();
const PORT = process.env.PORT || 3001;

// Using in-memory cache (Redis disabled)
const inMemoryCache = new Map();
const IN_MEMORY_MAX_ENTRIES = parseInt(
  process.env.IN_MEMORY_MAX_ENTRIES || "1000",
  10
);
let redis = null; // Redis disabled
console.log("✅ Using in-memory cache for performance optimization");

async function cacheGet(key) {
  // Using in-memory cache only
  const entry = inMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    inMemoryCache.delete(key);
    return null;
  }
  return entry.value;
}
async function cacheSet(key, value, ttlMs = 60_000) {
  // Using in-memory cache only
  inMemoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  // LRU-style trim when exceeding capacity
  if (inMemoryCache.size > IN_MEMORY_MAX_ENTRIES) {
    const toDelete = inMemoryCache.size - IN_MEMORY_MAX_ENTRIES;
    let i = 0;
    for (const k of inMemoryCache.keys()) {
      inMemoryCache.delete(k);
      i++;
      if (i >= toDelete) break;
    }
  }
}
function cacheInvalidatePattern(pattern) {
  const regex = new RegExp(pattern);
  let count = 0;
  for (const key of inMemoryCache.keys()) {
    if (regex.test(key)) {
      inMemoryCache.delete(key);
      count++;
    }
  }
  if (count > 0) console.log(`🗑️ Invalidated ${count} cache entries matching /${pattern}/`);
}

function cacheInvalidateAnime(animeId) {
  // Invalidate episode list cache and all anime list caches
  if (animeId) cacheInvalidatePattern(`episodes.*${animeId}|${animeId}.*episodes`);
  cacheInvalidatePattern('GET:/api/anime');
}

function cacheMiddleware(ttlMs = 60_000) {
  return async (req, res, next) => {
    if (req.method !== "GET") return next();
    const key = `${req.method}:${req.originalUrl}`;
    try {
      const cached = await cacheGet(key);
      if (cached) {
        res.set("X-Cache", "HIT");
        return res.json(cached);
      }
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        res.set("X-Cache", "MISS");
        try {
          void cacheSet(key, body, ttlMs);
        } catch {}
        return originalJson(body);
      };
      next();
    } catch (err) {
      // On cache error, proceed without cache
      next();
    }
  };
}

// Middleware
app.use(requestIdMiddleware); // Request ID for error correlation
app.use(helmet(getHelmetConfig())); // Enhanced security headers
// Enable HTTP keep-alive
app.use((req, res, next) => {
  res.set("Connection", "keep-alive");
  next();
});
app.use(cors(getCorsConfig())); // Configurable CORS
app.use(validateRequestSize()); // Request size validation
app.use(sanitizeInput); // Input sanitization
// Tune compression; skip small bodies and likely already-compressed content
app.use(
  compression({
    threshold: 4096,
    filter: (req, res) => {
      const url = req.url || "";
      if (url.endsWith(".m3u8") || url.endsWith(".mpd") || url.endsWith(".ts"))
        return false;
      return compression.filter(req, res);
    },
  })
);
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Axios: enable HTTP keep-alive agents for upstream requests
axios.defaults.timeout = 15000;
axios.defaults.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
axios.defaults.httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
});

// Rate limiting - general API rate limit
app.use("/api", rateLimiter.middleware(60_000, 60)); // 60 requests per minute

// Stricter rate limiting for scraper endpoints
app.use("/api/scrape", rateLimiter.middleware(60_000, 10)); // 10 requests per minute

// Performance metrics collector
app.post("/api/perf-metrics", async (req, res) => {
  try {
    const payload = req.body;
    const filePath = resolvePath(process.cwd(), "performance-report.json");
    let existing = [];
    try {
      const content = await fs.readFile(filePath, "utf-8");
      existing = JSON.parse(content);
      if (!Array.isArray(existing)) existing = [];
    } catch {}
    existing.push(payload);
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error("perf-metrics write failed", e);
    res.status(500).json({ success: false });
  }
});

// Playwright browser pooling and concurrency control
let sharedBrowser = null;
const maxConcurrency = parseInt(process.env.SCRAPER_MAX_CONCURRENCY || "2", 10);
let activeCount = 0;
const queue = [];
// Circuit breaker for scraper
let breakerFailures = 0;
let breakerOpenedAt = 0;
const BREAKER_THRESHOLD = parseInt(
  process.env.SCRAPER_BREAKER_THRESHOLD || "8",
  10
);
const BREAKER_COOLDOWN_MS = parseInt(
  process.env.SCRAPER_BREAKER_COOLDOWN_MS || "30000",
  10
);

async function getBrowser() {
  try {
    if (sharedBrowser) {
      // Verify browser is valid by checking for newContext method
      if (typeof sharedBrowser.newContext === "function") {
        return sharedBrowser;
      } else {
        // Browser is invalid, reset it
        console.log("⚠️ Shared browser is invalid, resetting...");
        sharedBrowser = null;
      }
    }
    console.log("🔄 Launching new browser instance...");

    // Configure browser launch options
    const launchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    };

    // Only set executablePath if explicitly provided via environment variable
    // On Windows, Playwright will use its bundled browser automatically
    // On Linux/Docker, use the provided path or default to system Chromium
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      launchOptions.executablePath =
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
      console.log(`Using Chromium at: ${launchOptions.executablePath}`);
    } else if (process.platform === "linux") {
      // Only use Linux path on Linux systems
      launchOptions.executablePath = "/usr/bin/chromium-browser";
      console.log(`Using Chromium at: ${launchOptions.executablePath}`);
    } else {
      // On Windows/Mac, let Playwright use its bundled browser
      console.log("Using Playwright's bundled Chromium");
    }

    sharedBrowser = await chromium.launch(launchOptions);
    if (!sharedBrowser) {
      throw new Error("chromium.launch() returned null/undefined");
    }
    console.log("✅ Browser instance created successfully");
    return sharedBrowser;
  } catch (error) {
    console.error("❌ Failed to get browser:", error);
    sharedBrowser = null; // Reset on error
    throw error;
  }
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    // Circuit breaker: fast-fail when open
    if (breakerOpenedAt && Date.now() - breakerOpenedAt < BREAKER_COOLDOWN_MS) {
      return reject(
        new Error("Scraper temporarily unavailable (circuit open)")
      );
    }
    const run = async () => {
      activeCount++;
      try {
        const result = await task();
        // reset breaker on success
        breakerFailures = 0;
        breakerOpenedAt = 0;
        resolve(result);
      } catch (e) {
        breakerFailures++;
        if (breakerFailures >= BREAKER_THRESHOLD) {
          breakerOpenedAt = Date.now();
        }
        reject(e);
      } finally {
        activeCount--;
        if (queue.length > 0) {
          const next = queue.shift();
          next();
        }
      }
    };

    if (activeCount < maxConcurrency) {
      void run();
    } else {
      queue.push(run);
    }
  });
}

// Scraper service
class NineAnimeScraperService {
  static BASE_URL = "https://9anime.org.lv";
  static USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  static async scrapeAnimeEpisode(animeTitle, episodeNumber = 1, options = {}) {
    const { timeout = 45000, retries = 3, dbAnimeId = null } = options;

    console.log(
      `🎬 Scraping 9anime.org.lv for "${animeTitle}", Episode ${episodeNumber}${dbAnimeId ? ` (DB ID: ${dbAnimeId})` : ''}...`
    );

    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Step 1: Use Cheerio for fast search (with multi-title resolution)
        const searchResult = await this.searchAnimeWithCheerio(
          animeTitle,
          episodeNumber,
          dbAnimeId
        );

        if (!searchResult.success) {
          throw new Error(searchResult.error || "Search failed");
        }

        const { animeLink, animeId } = searchResult;
        console.log(
          `🔍 DEBUG: animeLink = ${animeLink}, episodeNumber = ${episodeNumber}`
        );

        // Step 2: Use Puppeteer for dynamic video extraction (queued)
        const videoResult = await enqueue(() =>
          this.extractVideoWithPuppeteer(animeLink, animeId, episodeNumber, {
            timeout,
          })
        );

        if (!videoResult.success) {
          throw new Error(videoResult.error || "Video extraction failed");
        }

        // Step 3: Check for anti-embedding protection
        const embeddingCheck = await this.checkEmbeddingProtection(
          videoResult.streamUrl
        );

        const finalEpisodeData = {
          animeTitle,
          animeId,
          animeLink,
          ...videoResult.episodeData,
          episodeNumber, // Put this after the spread to ensure it's not overwritten
        };

        console.log(
          `🔍 DEBUG: Final episodeData = ${JSON.stringify(finalEpisodeData)}`
        );
        console.log(
          "📦 DEBUG: Returning from scrapeAnimeEpisode - streamUrl:",
          videoResult.streamUrl
        );

        return {
          success: true,
          streamUrl: videoResult.streamUrl,
          embeddingProtected: embeddingCheck.protected,
          embeddingReason: embeddingCheck.reason,
          episodeData: finalEpisodeData,
        };
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);

        if (attempt < retries) {
          console.log(`⏳ Retrying in 2 seconds... (${attempt}/${retries})`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || "Unknown error occurred",
    };
  }

  // New method to scrape all available episodes
  static async scrapeAllEpisodes(animeTitle, options = {}) {
    const { maxEpisodes = 50, timeout = 45000, retries = 2, dbAnimeId = null } = options;

    console.log(
      `🎬 Scraping all episodes for "${animeTitle}" (max ${maxEpisodes})...`
    );

    try {
      // Step 1: Find the anime and get episode list (use episode 1 for initial search)
      const searchResult = await this.searchAnimeWithCheerio(animeTitle, 1, dbAnimeId);

      if (!searchResult.success) {
        return { success: false, error: searchResult.error || "Search failed" };
      }

      const { animeLink, animeId } = searchResult;

      // Step 2: Get available episodes from the anime page
      const episodesResult = await this.getAvailableEpisodes(
        animeLink,
        animeId,
        maxEpisodes
      );

      if (!episodesResult.success) {
        return {
          success: false,
          error: episodesResult.error || "Failed to get episodes",
        };
      }

      const { episodes, totalEpisodes } = episodesResult;
      console.log(
        `📺 Found ${totalEpisodes} total episodes, checking first ${episodes.length}...`
      );

      // Step 3: Scrape each episode
      const scrapedEpisodes = [];
      const failedEpisodes = [];

      for (const episode of episodes) {
        try {
          console.log(
            `🎬 Scraping Episode ${episode.number}: "${episode.title}"`
          );

          const episodeResult = await this.scrapeAnimeEpisode(
            animeTitle,
            episode.number,
            {
              timeout: timeout / episodes.length, // Distribute timeout across episodes
              retries,
              dbAnimeId,
            }
          );

          if (episodeResult.success) {
            scrapedEpisodes.push({
              ...episode,
              streamUrl: episodeResult.streamUrl,
              embeddingProtected: episodeResult.embeddingProtected,
              embeddingReason: episodeResult.embeddingReason,
              scrapedAt: new Date().toISOString(),
            });
            console.log(`✅ Episode ${episode.number} scraped successfully`);
          } else {
            failedEpisodes.push({
              ...episode,
              error: episodeResult.error,
            });
            console.log(
              `❌ Episode ${episode.number} failed: ${episodeResult.error}`
            );
          }

          // Small delay between episodes to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          failedEpisodes.push({
            ...episode,
            error: error.message,
          });
          console.log(`❌ Episode ${episode.number} error: ${error.message}`);
        }
      }

      return {
        success: true,
        animeTitle,
        animeId,
        totalEpisodes,
        scrapedEpisodes,
        failedEpisodes,
        summary: {
          total: episodes.length,
          successful: scrapedEpisodes.length,
          failed: failedEpisodes.length,
          embeddingProtected: scrapedEpisodes.filter(
            (ep) => ep.embeddingProtected
          ).length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Get available episodes from anime page
  static async getAvailableEpisodes(animeLink, animeId, maxEpisodes = 50) {
    try {
      console.log("📺 Getting available episodes...");

      const response = await axios.get(animeLink, {
        headers: { "User-Agent": this.USER_AGENT },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);

      // Extract anime slug from the URL for filtering
      const animeSlug =
        animeLink.match(/\/([^\/]+)-episode-\d+/)?.[1] ||
        animeLink.match(/anime\/([^\/]+)/)?.[1] ||
        animeId;

      console.log(`🔍 Looking for episodes with anime slug: ${animeSlug}`);

      // Look for episode lists in specific containers ONLY (not all links)
      const episodes = [];

      // Method 1: Look for episode lists in specific containers ONLY
      const episodeContainers = $(
        '.episode-list, .episodes, .episode-item, [class*="episode"]'
      );

      episodeContainers.each((i, container) => {
        const episodeItems = $(container).find(
          'a, .episode, [class*="episode"]'
        );

        episodeItems.each((j, item) => {
          const text = $(item).text().trim();
          const href = $(item).attr("href");

          if (text && href) {
            // Check if this link belongs to the same anime
            const isSameAnime =
              href.includes(animeSlug) ||
              href.includes(animeId) ||
              href.includes(animeLink.split("/").pop()?.split("-episode")[0]);

            if (isSameAnime) {
              // Extract episode number from URL or text
              const episodeMatch =
                href.match(/-episode-(\d+)/) ||
                href.match(/\/episode\/(\d+)/) ||
                href.match(/\/watch\/.*?(\d+)/) ||
                text.match(/episode\s*(\d+)/i) ||
                text.match(/ep\s*(\d+)/i);

              if (episodeMatch) {
                const episodeNumber = parseInt(episodeMatch[1]);
                if (episodeNumber && episodeNumber <= maxEpisodes) {
                  episodes.push({
                    number: episodeNumber,
                    title: text,
                    url: href.startsWith("http") ? href : this.BASE_URL + href,
                  });
                }
              } else if (text.match(/\d+/)) {
                // Fallback: extract number from text
                const episodeNumber = parseInt(text.match(/\d+/)[0]);
                if (episodeNumber && episodeNumber <= maxEpisodes) {
                  episodes.push({
                    number: episodeNumber,
                    title: text,
                    url: href.startsWith("http") ? href : this.BASE_URL + href,
                  });
                }
              }
            }
          }
        });
      });

      // Remove duplicates and sort by episode number
      const uniqueEpisodes = episodes
        .filter(
          (ep, index, self) =>
            index === self.findIndex((e) => e.number === ep.number)
        )
        .sort((a, b) => a.number - b.number);

      // If no episodes found, try to construct episode URLs based on the anime pattern
      let filteredEpisodes = uniqueEpisodes;
      if (uniqueEpisodes.length === 0) {
        console.log("⚠️ No episodes found, constructing episode URLs...");

        // For movies, there should only be 1 episode
        if (
          animeSlug.toLowerCase().includes("film") ||
          animeSlug.toLowerCase().includes("movie")
        ) {
          filteredEpisodes.push({
            number: 1,
            title: "Movie",
            url: animeLink, // Use the original link as it's already episode 1
          });
        } else {
          // For regular anime, try to construct episode URLs
          for (let i = 1; i <= Math.min(12, maxEpisodes); i++) {
            const episodeUrl = animeLink.replace(
              /-episode-\d+/,
              `-episode-${i}`
            );
            filteredEpisodes.push({
              number: i,
              title: `Episode ${i}`,
              url: episodeUrl,
            });
          }
        }
      }

      // Additional filtering: Remove episodes that don't belong to this anime
      filteredEpisodes = filteredEpisodes.filter((episode) => {
        // For movies, only allow episode 1
        if (
          animeSlug.toLowerCase().includes("film") ||
          animeSlug.toLowerCase().includes("movie")
        ) {
          return episode.number === 1;
        }
        // For regular anime, check if the episode URL actually exists (we'll let the scraper handle validation)
        return true;
      });

      console.log(
        `✅ Found ${filteredEpisodes.length} episodes for ${animeSlug}`
      );
      console.log(
        "Episodes:",
        filteredEpisodes.map((ep) => `Ep ${ep.number}: ${ep.title}`)
      );

      return {
        success: true,
        episodes: filteredEpisodes,
        totalEpisodes: filteredEpisodes.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Check if video source has anti-embedding protection
  static async checkEmbeddingProtection(videoUrl) {
    try {
      console.log("🔍 Checking for anti-embedding protection...");

      const response = await axios.get(videoUrl, {
        headers: { "User-Agent": this.USER_AGENT },
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      const html = response.data;

      // Check for common anti-embedding patterns
      const antiEmbeddingPatterns = [
        /if\s*\(\s*window\s*==\s*window\.top\s*\)/i,
        /window\.location\.replace/i,
        /window\.top\.location/i,
        /parent\.location/i,
        /top\.location/i,
        /frameElement/i,
        /anti-embed/i,
        /embedding.*block/i,
        /no.*embed/i,
      ];

      const protectionReasons = [];

      for (const pattern of antiEmbeddingPatterns) {
        if (pattern.test(html)) {
          protectionReasons.push(pattern.toString());
        }
      }

      // Check for Cloudflare protection (but be lenient with all mega domains)
      if (html.includes("cloudflare") || html.includes("challenge-platform")) {
        if (videoUrl.match(/mega(play|cloud|backup|cdn|stream)/i)) {
          console.log(
            "🎯 Mega domain detected - Cloudflare protection is usually embeddable"
          );
          // Don't add to protection reasons for mega domains
        } else {
          protectionReasons.push("Cloudflare protection detected");
        }
      }

      // Check for dynamic iframe loading
      if (html.includes("data-src") && !html.includes("src=")) {
        protectionReasons.push("Dynamic iframe loading detected");
      }

      // Special case: All mega domains are generally embeddable even with some protection
      const isProtected =
        protectionReasons.length > 0 &&
        !videoUrl.match(/mega(play|cloud|backup|cdn|stream)/i);

      console.log(
        `${isProtected ? "⚠️" : "✅"} Embedding protection: ${
          isProtected ? "DETECTED" : "NONE"
        }`
      );
      if (isProtected) {
        console.log("Reasons:", protectionReasons);
      }

      return {
        protected: isProtected,
        reason: isProtected ? protectionReasons.join(", ") : null,
      };
    } catch (error) {
      console.log("⚠️ Could not check embedding protection:", error.message);
      return {
        protected: true, // Assume protected if we can't check
        reason: `Check failed: ${error.message}`,
      };
    }
  }

  static async searchAnimeWithCheerio(animeTitle, episodeNumber = 1, dbAnimeId = null) {
    // Cached search to reduce upstream calls
    try {
      const cached = await cacheGet(`search:${animeTitle}:${episodeNumber}`);
      if (cached) return cached;
    } catch {}
    try {
      // =====================================================================
      // STEP 0: Check if we already have a verified 9anime slug in the DB
      // =====================================================================
      if (dbAnimeId) {
        try {
          const { data: animeRecord } = await supabase
            .from("anime")
            .select("nine_anime_slug, title_english, title_romaji, title_japanese, title_synonyms, mal_id")
            .eq("id", dbAnimeId)
            .maybeSingle();

          if (animeRecord?.nine_anime_slug) {
            const slugUrl = `${this.BASE_URL}/${animeRecord.nine_anime_slug}-episode-${episodeNumber}/`;
            console.log(`🔗 Using cached 9anime slug: ${slugUrl}`);
            try {
              const testResp = await axios.get(slugUrl, {
                headers: { "User-Agent": this.USER_AGENT },
                timeout: 5000,
                validateStatus: (s) => s < 500,
              });
              if (testResp.status === 200) {
                const result = { success: true, animeLink: slugUrl, animeId: animeRecord.nine_anime_slug };
                try { await cacheSet(`search:${animeTitle}:${episodeNumber}`, result, 300_000); } catch {}
                return result;
              }
            } catch {}

            // Episode URL didn't work — verify the slug itself is still valid via episode 1
            if (episodeNumber > 1) {
              try {
                const ep1Url = `${this.BASE_URL}/${animeRecord.nine_anime_slug}-episode-1/`;
                const ep1Resp = await axios.get(ep1Url, {
                  headers: { "User-Agent": this.USER_AGENT },
                  timeout: 5000,
                  validateStatus: (s) => s < 500,
                });
                if (ep1Resp.status === 200) {
                  // Slug is valid — this episode just isn't available yet
                  console.log(`ℹ️ Slug "${animeRecord.nine_anime_slug}" is valid but episode ${episodeNumber} is not available yet on 9anime`);
                  return {
                    success: false,
                    error: `Episode ${episodeNumber} not yet available on 9anime`,
                    slugValid: true,
                  };
                }
              } catch {}
            }

            console.log("⚠️ Cached slug no longer works, re-resolving...");
          }
        } catch (e) {
          console.log("⚠️ DB lookup for slug failed:", e.message);
        }
      }

      // =====================================================================
      // STEP 1: Build multiple title variants to try
      // =====================================================================
      const titleVariants = await this.getTitleVariants(animeTitle, dbAnimeId);
      console.log(`📝 Title variants to try: ${JSON.stringify(titleVariants)}`);

      // =====================================================================
      // STEP 2: Try direct URL construction with each title variant
      // =====================================================================
      for (const variant of titleVariants) {
        const slug = this.buildSlug(variant);
        if (!slug) continue;

        const directUrl = `${this.BASE_URL}/${slug}-episode-${episodeNumber}/`;
        console.log(`🔗 Testing direct URL: ${directUrl} (from: "${variant}")`);

        try {
          const testResponse = await axios.get(directUrl, {
            headers: { "User-Agent": this.USER_AGENT },
            timeout: 5000,
            validateStatus: (status) => status < 500,
          });

          if (testResponse.status === 200) {
            // Verify this is actually the right anime by checking page content
            const pageTitle = this.extractPageTitle(testResponse.data);
            const similarity = this.titleSimilarity(animeTitle, pageTitle);
            
            if (similarity >= 0.75) {
              console.log(`✅ Direct URL verified (similarity: ${similarity.toFixed(2)}): ${directUrl}`);
              // Save the verified slug to DB for future use
              await this.saveVerifiedSlug(dbAnimeId, slug);
              const result = { success: true, animeLink: directUrl, animeId: slug };
              try { await cacheSet(`search:${animeTitle}:${episodeNumber}`, result, 300_000); } catch {}
              return result;
            } else {
              console.log(`⚠️ Direct URL exists but title mismatch (similarity: ${similarity.toFixed(2)}): page="${pageTitle}" vs expected="${animeTitle}"`);
            }
          }
        } catch (error) {
          console.log(`❌ Direct URL test failed for "${variant}": ${error.message}`);
        }
      }

      // =====================================================================
      // STEP 3: Search 9anime with each title variant
      // =====================================================================
      console.log("🔍 Direct URLs failed, searching 9anime...");

      for (const variant of titleVariants) {
        const searchResult = await this.search9animeByKeyword(variant, animeTitle, episodeNumber);
        if (searchResult.success) {
          // Save verified slug
          const foundSlug = searchResult.animeId;
          await this.saveVerifiedSlug(dbAnimeId, foundSlug);
          try { await cacheSet(`search:${animeTitle}:${episodeNumber}`, searchResult, 300_000); } catch {}
          return searchResult;
        }
      }

      // =====================================================================
      // STEP 4: Last resort — use Jikan API to find the English title
      // =====================================================================
      console.log("🔍 All variants failed, trying Jikan API title resolution...");
      const jikanTitles = await this.resolveViaTitleFromJikan(animeTitle);
      
      for (const jikanTitle of jikanTitles) {
        // Skip if we already tried this
        if (titleVariants.some(v => v.toLowerCase() === jikanTitle.toLowerCase())) continue;

        // Don't accept a different season (e.g. "Season 2" when looking for "Season 3")
        if (this.hasDifferentSeason(animeTitle, jikanTitle)) {
          console.log(`⚠️ Skipping Jikan result "${jikanTitle}" — different season from "${animeTitle}"`);
          continue;
        }

        const slug = this.buildSlug(jikanTitle);
        if (!slug) continue;

        const directUrl = `${this.BASE_URL}/${slug}-episode-${episodeNumber}/`;
        console.log(`🔗 Testing Jikan-resolved URL: ${directUrl} (from: "${jikanTitle}")`);

        try {
          const testResponse = await axios.get(directUrl, {
            headers: { "User-Agent": this.USER_AGENT },
            timeout: 5000,
            validateStatus: (s) => s < 500,
          });

          if (testResponse.status === 200) {
            console.log(`✅ Jikan-resolved URL works: ${directUrl}`);
            await this.saveVerifiedSlug(dbAnimeId, slug);
            // Also update the English title in DB if we found one
            await this.updateTitleEnglish(dbAnimeId, jikanTitle);
            const result = { success: true, animeLink: directUrl, animeId: slug };
            try { await cacheSet(`search:${animeTitle}:${episodeNumber}`, result, 300_000); } catch {}
            return result;
          }
        } catch {}

        // Also try searching 9anime with the Jikan title
        const searchResult = await this.search9animeByKeyword(jikanTitle, animeTitle, episodeNumber);
        if (searchResult.success) {
          await this.saveVerifiedSlug(dbAnimeId, searchResult.animeId);
          await this.updateTitleEnglish(dbAnimeId, jikanTitle);
          try { await cacheSet(`search:${animeTitle}:${episodeNumber}`, searchResult, 300_000); } catch {}
          return searchResult;
        }
      }

      return {
        success: false,
        error: `Could not find "${animeTitle}" on 9anime after trying ${titleVariants.length} title variants + Jikan resolution`,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // =========================================================================
  // HELPER: Build a URL slug from a title
  // =========================================================================
  // Check if two titles refer to different seasons of the same show
  static hasDifferentSeason(originalTitle, resolvedTitle) {
    const seasonRegex = /(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s*season)/i;
    const origMatch = originalTitle.match(seasonRegex);
    const resolvedMatch = resolvedTitle.match(seasonRegex);

    // One title has an explicit season and the other doesn't → different season
    // (e.g. "[Oshi No Ko]" vs "[Oshi No Ko] Season 2")
    if ((!origMatch && resolvedMatch) || (origMatch && !resolvedMatch)) return true;
    // Neither has a season number → same (both are season 1 / base title)
    if (!origMatch && !resolvedMatch) return false;
    // Both have season numbers — compare them
    const origSeason = origMatch[1] || origMatch[2];
    const resolvedSeason = resolvedMatch[1] || resolvedMatch[2];
    return origSeason !== resolvedSeason;
  }

  static buildSlug(title) {
    if (!title) return null;
    return title
      .toLowerCase()
      .replace(/[''""`]/g, "")               // Remove quotes/apostrophes (e.g., "don't" → "dont")
      .replace(/[&]/g, "and")                 // & → and
      .replace(/[@]/g, "at")                  // @ → at
      .replace(/[^a-z0-9\s-]/g, "")          // Remove non-alphanumeric (keep spaces & hyphens)
      .replace(/\s+/g, "-")                   // Spaces → hyphens
      .replace(/-+/g, "-")                    // Collapse multiple hyphens
      .replace(/^-|-$/g, "")                  // Trim leading/trailing hyphens
      .trim();
  }

  // =========================================================================
  // HELPER: Get all title variants to try for URL resolution
  // =========================================================================
  static async getTitleVariants(animeTitle, dbAnimeId) {
    const variants = new Set();
    
    // Always add the provided title first
    variants.add(animeTitle);

    // If we have a DB ID, fetch all stored title variants  
    if (dbAnimeId) {
      try {
        const { data: animeRecord } = await supabase
          .from("anime")
          .select("title, title_english, title_romaji, title_japanese, title_synonyms")
          .eq("id", dbAnimeId)
          .maybeSingle();

        if (animeRecord) {
          if (animeRecord.title) variants.add(animeRecord.title);
          if (animeRecord.title_english) variants.add(animeRecord.title_english);
          if (animeRecord.title_romaji) variants.add(animeRecord.title_romaji);
          // Don't add Japanese title — it won't produce valid URL slugs
          if (animeRecord.title_synonyms && Array.isArray(animeRecord.title_synonyms)) {
            for (const syn of animeRecord.title_synonyms) {
              // Only add Latin-script synonyms (skip Japanese/Chinese/Korean)
              if (syn && /^[a-zA-Z0-9\s\-':!,.&]+$/.test(syn)) {
                variants.add(syn);
              }
            }
          }
        }
      } catch (e) {
        console.log("⚠️ Failed to fetch title variants from DB:", e.message);
      }
    }

    // Generate common variations of the title
    const baseVariants = [...variants];
    for (const v of baseVariants) {
      // "Season 2" → "2nd season", "season-2" etc.
      if (/season\s*(\d+)/i.test(v)) {
        const num = v.match(/season\s*(\d+)/i)[1];
        variants.add(v.replace(/season\s*\d+/i, `${num}nd-season`).trim());
        variants.add(v.replace(/season\s*\d+/i, `season-${num}`).trim());
        variants.add(v.replace(/\s*season\s*\d+/i, "").trim()); // Without season suffix
      }
      // "Part 2" → "part-2" etc.
      if (/part\s*(\d+)/i.test(v)) {
        const num = v.match(/part\s*(\d+)/i)[1];
        variants.add(v.replace(/part\s*\d+/i, `part-${num}`).trim());
      }
      // Handle "II", "III" → "2", "3"
      if (/\bII\b/.test(v)) {
        variants.add(v.replace(/\bII\b/, "2").trim());
        variants.add(v.replace(/\bII\b/, "2nd-season").trim());
      }
      if (/\bIII\b/.test(v)) {
        variants.add(v.replace(/\bIII\b/, "3").trim());
        variants.add(v.replace(/\bIII\b/, "3rd-season").trim());
      }
      // Handle "The" prefix — try without it
      if (/^the\s+/i.test(v)) {
        variants.add(v.replace(/^the\s+/i, "").trim());
      }
      // Handle colons — 9anime sometimes drops them
      if (v.includes(":")) {
        variants.add(v.replace(/:/g, "").trim());
        variants.add(v.replace(/:/g, " -").trim());
      }
    }

    return [...variants].filter(Boolean);
  }

  // =========================================================================
  // HELPER: Search 9anime by keyword and validate the result
  // =========================================================================
  static async search9animeByKeyword(searchTitle, originalTitle, episodeNumber) {
    try {
      const searchUrl = `${this.BASE_URL}/search?keyword=${encodeURIComponent(searchTitle)}`;
      console.log(`🔍 Searching 9anime: ${searchUrl}`);

      const searchResponse = await axios.get(searchUrl, {
        headers: {
          "User-Agent": this.USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate",
          DNT: "1",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(searchResponse.data);

      // Collect all candidate links with their text
      const candidates = [];
      const linkSelectors = 'a[href*="/category/"], a[href*="/anime/"], a[href*="/v/"], a[href*="/watch/"], a[href*="-episode-"]';
      
      $(linkSelectors).each((i, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        if (href && text) {
          const fullUrl = href.startsWith("http") ? href : this.BASE_URL + href;
          candidates.push({ url: fullUrl, text, href });
        }
      });

      console.log(`🔍 Found ${candidates.length} candidate links for "${searchTitle}"`);

      // Score each candidate by title similarity
      const scoredCandidates = candidates.map(c => ({
        ...c,
        similarity: Math.max(
          this.titleSimilarity(originalTitle, c.text),
          this.titleSimilarity(searchTitle, c.text),
          this.titleSimilarity(originalTitle, this.slugToTitle(c.href)),
          this.titleSimilarity(searchTitle, this.slugToTitle(c.href))
        ),
      }));

      // Sort by similarity descending
      scoredCandidates.sort((a, b) => b.similarity - a.similarity);

      // Log top candidates for debugging
      const topN = scoredCandidates.slice(0, 5);
      for (const c of topN) {
        console.log(`   📊 Score ${c.similarity.toFixed(2)}: "${c.text}" → ${c.url}`);
      }

      // Accept only candidates with decent similarity (>= 0.6)
      const bestMatch = scoredCandidates.find(c => c.similarity >= 0.6);

      if (!bestMatch) {
        console.log(`❌ No good match found for "${searchTitle}" (best similarity: ${scoredCandidates[0]?.similarity?.toFixed(2) || 'N/A'})`);
        return { success: false, error: "No matching anime found in search results" };
      }

      let animeLink = bestMatch.url;

      // Extract the anime slug from the matched URL
      let animeSlug =
        animeLink.match(/\/([^\/]+)-episode-\d+/)?.[1] ||
        animeLink.match(/\/([^\/]+)-film-/)?.[1] ||
        animeLink.match(/\/([^\/]+)-movie-/)?.[1] ||
        animeLink.match(/category\/([^?\/]+)/)?.[1] ||
        animeLink.match(/anime\/([^?\/]+)/)?.[1] ||
        animeLink.match(/v\/([^?\/]+)/)?.[1] ||
        animeLink.match(/watch\/([^?\/]+)/)?.[1] ||
        null;

      if (!animeSlug) {
        return { success: false, error: "Could not extract anime slug from URL" };
      }

      // Construct the correct episode URL
      if (!animeLink.includes(`-episode-${episodeNumber}`)) {
        if (animeLink.includes("-episode-")) {
          animeLink = animeLink.replace(/-episode-\d+/, `-episode-${episodeNumber}`);
        } else {
          animeLink = `${this.BASE_URL}/${animeSlug}-episode-${episodeNumber}/`;
        }
      }

      console.log(`✅ Best match (similarity: ${bestMatch.similarity.toFixed(2)}): ${animeLink}`);
      return { success: true, animeLink, animeId: animeSlug };
    } catch (error) {
      console.log(`❌ 9anime search failed for "${searchTitle}": ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // =========================================================================
  // HELPER: Resolve titles via Jikan (MAL) API
  // =========================================================================
  static async resolveViaTitleFromJikan(animeTitle) {
    try {
      const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(animeTitle)}&limit=3`;
      console.log(`🔍 Jikan API lookup: ${searchUrl}`);

      const response = await axios.get(searchUrl, { timeout: 10000 });
      const results = response.data?.data || [];

      const titles = [];
      for (const anime of results) {
        // Add English title (most likely to match 9anime)
        if (anime.title_english) titles.push(anime.title_english);
        // Add default title (usually romaji)
        if (anime.title) titles.push(anime.title);
        // Add synonyms (alternate transliterations)
        if (anime.title_synonyms && Array.isArray(anime.title_synonyms)) {
          for (const syn of anime.title_synonyms) {
            if (syn && /^[a-zA-Z0-9\s\-':!,.&]+$/.test(syn)) {
              titles.push(syn);
            }
          }
        }
      }

      // Deduplicate and filter out titles from different seasons
      const uniqueTitles = [...new Set(titles)].filter(
        t => !this.hasDifferentSeason(animeTitle, t)
      );
      console.log(`📝 Jikan resolved ${uniqueTitles.length} title variants: ${JSON.stringify(uniqueTitles)}`);
      return uniqueTitles;
    } catch (error) {
      console.log(`⚠️ Jikan API lookup failed: ${error.message}`);
      return [];
    }
  }

  // =========================================================================
  // HELPER: Save a verified 9anime slug to the database
  // =========================================================================
  static async saveVerifiedSlug(dbAnimeId, slug) {
    if (!dbAnimeId || !slug) return;
    try {
      await supabase
        .from("anime")
        .update({ nine_anime_slug: slug, updated_at: new Date().toISOString() })
        .eq("id", dbAnimeId);
      console.log(`💾 Saved verified 9anime slug "${slug}" for anime ${dbAnimeId}`);
    } catch (e) {
      console.log(`⚠️ Failed to save slug: ${e.message}`);
    }
  }

  // =========================================================================
  // HELPER: Update title_english in DB when resolved via Jikan
  // =========================================================================
  static async updateTitleEnglish(dbAnimeId, englishTitle) {
    if (!dbAnimeId || !englishTitle) return;
    try {
      await supabase
        .from("anime")
        .update({ title_english: englishTitle, updated_at: new Date().toISOString() })
        .eq("id", dbAnimeId);
      console.log(`💾 Updated title_english to "${englishTitle}" for anime ${dbAnimeId}`);
    } catch (e) {
      console.log(`⚠️ Failed to update title_english: ${e.message}`);
    }
  }

  // =========================================================================
  // HELPER: Calculate title similarity (Jaccard on words + contains check)
  // =========================================================================
  static titleSimilarity(title1, title2) {
    if (!title1 || !title2) return 0;

    const normalise = (s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const a = normalise(title1);
    const b = normalise(title2);

    // Exact match
    if (a === b) return 1.0;

    // Contains check — but penalise large length differences
    // "one piece" ⊂ "one piece the movie" should NOT score 0.85
    if (a.includes(b) || b.includes(a)) {
      const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      // Only give high score if the strings are similar in length (ratio > 0.8)
      // Otherwise scale down: e.g. 9/19 = 0.47 → score ~0.55
      return ratio >= 0.8 ? 0.9 : 0.4 + ratio * 0.5;
    }

    // Jaccard similarity on words
    const wordsA = new Set(a.split(" ").filter((w) => w.length > 1));
    const wordsB = new Set(b.split(" ").filter((w) => w.length > 1));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    const jaccard = intersection.size / union.size;

    // Also check order-aware similarity with significant words
    const significantA = [...wordsA].filter((w) => w.length > 2);
    const significantB = [...wordsB].filter((w) => w.length > 2);
    const significantMatches = significantA.filter((w) => significantB.includes(w)).length;
    const significantRatio = significantA.length > 0 ? significantMatches / Math.max(significantA.length, significantB.length) : 0;

    return Math.max(jaccard, significantRatio);
  }

  // =========================================================================
  // HELPER: Extract the page title from an HTML response
  // =========================================================================
  static extractPageTitle(html) {
    try {
      const $ = cheerio.load(html);
      // Try 9anime-specific title selectors first
      const pageTitle =
        $("h1.title").text().trim() ||
        $("h1").first().text().trim() ||
        $(".anime-title").text().trim() ||
        $('meta[property="og:title"]').attr("content")?.trim() ||
        $("title").text().trim() ||
        "";
      // Clean up — remove "Episode X" suffix and site name
      return pageTitle
        .replace(/\s*-?\s*episode\s*\d+.*/i, "")
        .replace(/\s*\|\s*9anime.*/i, "")
        .replace(/\s*-\s*watch\s*online.*/i, "")
        .trim();
    } catch {
      return "";
    }
  }

  // =========================================================================
  // HELPER: Convert a URL slug back to a human-readable title for comparison
  // =========================================================================
  static slugToTitle(urlOrSlug) {
    try {
      // Extract slug from URL
      const slug =
        urlOrSlug.match(/\/([^\/]+)-episode-\d+/)?.[1] ||
        urlOrSlug.match(/category\/([^?\/]+)/)?.[1] ||
        urlOrSlug.match(/anime\/([^?\/]+)/)?.[1] ||
        urlOrSlug.match(/\/([^\/]+)\/?$/)?.[1] ||
        urlOrSlug;
      return slug.replace(/-/g, " ").trim();
    } catch {
      return "";
    }
  }

  /**
   * Extract actual HLS stream URL from a bysesayeveum.com/e/{id} URL
   * by calling their API and decrypting the encrypted playback payload.
   * Returns the HLS m3u8 URL or null on failure.
   */
  static async extractBysesayeveumHLS(byseUrl) {
    try {
      const idMatch = byseUrl.match(/bysesayeveum\.com\/e\/([a-zA-Z0-9]+)/);
      if (!idMatch) return null;
      const videoId = idMatch[1];
      console.log("🔍 Extracting HLS from bysesayeveum video:", videoId);

      // Use native https (axios times out on this host)
      const fetchByseJson = (path) =>
        new Promise((resolve, reject) => {
          const req = https.request(
            {
              hostname: "bysesayeveum.com",
              path,
              method: "GET",
              headers: {
                "User-Agent": this.USER_AGENT,
                Accept: "application/json",
                Referer: `https://bysesayeveum.com/e/${videoId}`,
                Origin: "https://bysesayeveum.com",
              },
              timeout: 20000,
            },
            (res) => {
              let body = "";
              res.on("data", (d) => (body += d));
              res.on("end", () => {
                try {
                  resolve(JSON.parse(body));
                } catch (e) {
                  reject(new Error("Invalid JSON: " + body.substring(0, 100)));
                }
              });
            }
          );
          req.on("error", reject);
          req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timed out"));
          });
          req.end();
        });

      const data = await fetchByseJson(`/api/videos/${videoId}`);
      if (!data || !data.playback) {
        console.log("⚠️ No playback data in bysesayeveum response");
        return null;
      }

      const pb = data.playback;
      if (pb.algorithm !== "AES-256-GCM") {
        console.log("⚠️ Unknown encryption algorithm:", pb.algorithm);
        return null;
      }

      // Helper to decode base64url
      const b64Decode = (str) => {
        let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4 !== 0) b64 += "=";
        return Buffer.from(b64, "base64");
      };

      // Helper to try AES-256-GCM decryption
      const tryDecrypt = (payload, iv, keyBuf) => {
        try {
          const payloadBuf = b64Decode(payload);
          const ivBuf = b64Decode(iv);
          // Last 16 bytes = GCM auth tag
          const authTag = payloadBuf.slice(-16);
          const ciphertext = payloadBuf.slice(0, -16);
          const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, ivBuf);
          decipher.setAuthTag(authTag);
          let decrypted = decipher.update(ciphertext);
          decrypted = Buffer.concat([decrypted, decipher.final()]);
          return JSON.parse(decrypted.toString("utf8"));
        } catch {
          return null;
        }
      };

      // Build possible keys
      const keyParts = pb.key_parts
        ? Buffer.concat(pb.key_parts.map(b64Decode))
        : null;
      const edgeKey =
        pb.decrypt_keys && pb.decrypt_keys.edge_1 && pb.decrypt_keys.edge_2
          ? Buffer.concat([
              b64Decode(pb.decrypt_keys.edge_1),
              b64Decode(pb.decrypt_keys.edge_2),
            ])
          : null;

      // Try payload1 with key_parts, then payload2 with edge keys
      const attempts = [];
      if (keyParts && keyParts.length === 32)
        attempts.push({ payload: pb.payload, iv: pb.iv, key: keyParts, label: "key_parts→payload1" });
      if (edgeKey && edgeKey.length === 32)
        attempts.push({ payload: pb.payload, iv: pb.iv, key: edgeKey, label: "edge→payload1" });
      if (pb.payload2 && pb.iv2) {
        if (keyParts && keyParts.length === 32)
          attempts.push({ payload: pb.payload2, iv: pb.iv2, key: keyParts, label: "key_parts→payload2" });
        if (edgeKey && edgeKey.length === 32)
          attempts.push({ payload: pb.payload2, iv: pb.iv2, key: edgeKey, label: "edge→payload2" });
      }

      for (const attempt of attempts) {
        const result = tryDecrypt(attempt.payload, attempt.iv, attempt.key);
        if (result && result.sources && result.sources.length > 0) {
          const source = result.sources[0];
          const hlsUrl = source.url
            .replace(/\\u0026/g, "&")
            .replace(/&amp;/g, "&");
          console.log(
            `✅ Decrypted bysesayeveum HLS [${attempt.label}]: ${source.label} ${source.height}p → ${hlsUrl.substring(0, 80)}...`
          );
          return hlsUrl;
        }
      }

      console.log("⚠️ Could not decrypt any bysesayeveum playback payload");
      // Fallback: try embed_frame_url from embed/details endpoint
      try {
        const embedData = await fetchByseJson(
          `/api/videos/${videoId}/embed/details`
        );
        if (embedData && embedData.embed_frame_url) {
          console.log("🔄 Fallback: using embed_frame_url:", embedData.embed_frame_url);
          return embedData.embed_frame_url;
        }
      } catch {}
      return null;
    } catch (e) {
      console.log("⚠️ bysesayeveum HLS extraction failed:", e.message);
      return null;
    }
  }

  /**
   * Extract HLS stream URL from a vidmoly embed page.
   * Vidmoly uses JWPlayer with a plain m3u8 URL in the sources array.
   */
  static async extractVidmolyHLS(vidmolyUrl) {
    try {
      const idMatch = vidmolyUrl.match(/vidmoly\.(?:biz|net)\/embed-([a-zA-Z0-9]+)/);
      if (!idMatch) return null;
      const videoId = idMatch[1];
      // Always use .biz (net redirects to biz)
      const embedUrl = `https://vidmoly.biz/embed-${videoId}.html`;
      console.log("🔍 Extracting HLS from vidmoly:", embedUrl);

      const resp = await axios.get(embedUrl, {
        headers: {
          "User-Agent": this.USER_AGENT,
          Referer: "https://9anime.org.lv/",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
        maxRedirects: 5,
      });

      const html = resp.data;
      // JWPlayer setup: sources: [{ file: 'https://...master.m3u8?...' }]
      const m3u8Match = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]/);
      if (m3u8Match && m3u8Match[1]) {
        console.log("✅ Extracted vidmoly HLS:", m3u8Match[1].substring(0, 80) + "...");
        return m3u8Match[1];
      }

      // Fallback: any m3u8 URL in the page
      const fallback = html.match(/https?:\/\/[^"'\s]*\.m3u8[^"'\s]*/);
      if (fallback) {
        console.log("✅ Extracted vidmoly HLS (fallback):", fallback[0].substring(0, 80) + "...");
        return fallback[0];
      }

      console.log("⚠️ No m3u8 URL found in vidmoly page");
      return null;
    } catch (e) {
      console.log("⚠️ vidmoly HLS extraction failed:", e.message);
      return null;
    }
  }

  /**
   * Extract actual HLS stream URL from a megaplay/megacloud embed URL.
   * Megaplay embeds use encrypted payloads similar to bysesayeveum.
   * Supports: megaplay.buzz, megacloud.blog, megacloud.tv, megastream, megabackup, megacdn
   *
   * Strategy:
   *  1. Fetch the embed page HTML
   *  2. Extract any inline m3u8 URLs or JS-packed source config
   *  3. If encrypted, try /api/source/{id} and /ajax/embed/{id}/getSources
   *  4. Decrypt AES payloads if needed
   *  5. Return the m3u8 URL
   */
  static async extractMegaHLS(megaUrl) {
    try {
      // Parse ID from the mega embed URL
      // Handles: megaplay.buzz/embed/{id}, megacloud.blog/embed/{id}, etc.
      const idMatch = megaUrl.match(
        /mega(?:play|cloud|backup|cdn|stream)[^/]*\/(?:embed|e)\/([a-zA-Z0-9]+)/i
      );
      if (!idMatch) {
        console.log("⚠️ Could not parse mega video ID from:", megaUrl);
        return null;
      }
      const videoId = idMatch[1];

      // Extract the host from the URL
      const hostMatch = megaUrl.match(/https?:\/\/([^/]+)/);
      if (!hostMatch) return null;
      const megaHost = hostMatch[1];

      console.log(`🔍 Extracting HLS from mega embed: ${megaHost}/embed/${videoId}`);

      const headers = {
        "User-Agent": this.USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `https://${megaHost}/embed/${videoId}`,
        Origin: `https://${megaHost}`,
      };

      // --- Method 1: Fetch the embed page and look for inline m3u8 ---
      try {
        const embedRes = await axios.get(
          `https://${megaHost}/embed/${videoId}`,
          { headers, timeout: 15000, maxRedirects: 5 }
        );
        const html = embedRes.data;

        // Check for direct m3u8 in the page source
        const m3u8Direct = html.match(
          /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i
        );
        if (m3u8Direct) {
          const hlsUrl = m3u8Direct[1].replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
          console.log("✅ Found direct m3u8 in mega embed page:", hlsUrl.substring(0, 80));
          return hlsUrl;
        }

        // Check for sources array in embedded JS
        const sourcesMatch = html.match(
          /sources\s*[:=]\s*\[\s*\{[^}]*["']?(?:file|src|url)["']?\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i
        );
        if (sourcesMatch) {
          const hlsUrl = sourcesMatch[1].replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
          console.log("✅ Found m3u8 in mega sources config:", hlsUrl.substring(0, 80));
          return hlsUrl;
        }
      } catch (e) {
        console.log("⚠️ Mega embed page fetch failed:", e.message);
      }

      // --- Method 2: Try the getSources AJAX endpoint ---
      const ajaxPaths = [
        `/ajax/embed/${videoId}/getSources`,
        `/api/source/${videoId}`,
        `/ajax/v2/embed/${videoId}/getSources`,
      ];

      for (const path of ajaxPaths) {
        try {
          const res = await axios.get(`https://${megaHost}${path}`, {
            headers: {
              ...headers,
              Accept: "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            timeout: 12000,
          });

          const data = res.data;
          if (!data) continue;

          // Case A: sources is a plain array (unencrypted)
          if (Array.isArray(data.sources) && data.sources.length > 0) {
            const src = data.sources[0];
            const hlsUrl = (src.file || src.url || src.src || "")
              .replace(/\\u0026/g, "&")
              .replace(/&amp;/g, "&");
            if (hlsUrl.includes(".m3u8") || hlsUrl.includes("master")) {
              console.log(`✅ Mega getSources [${path}] unencrypted:`, hlsUrl.substring(0, 80));
              return hlsUrl;
            }
          }

          // Case B: sources is an encrypted string
          if (typeof data.sources === "string" && data.sources.length > 50) {
            console.log(`🔐 Mega getSources [${path}] returned encrypted payload, attempting decrypt...`);

            const decrypted = this._tryDecryptMegaPayload(data);
            if (decrypted) {
              console.log("✅ Mega decrypted HLS:", decrypted.substring(0, 80));
              return decrypted;
            }
          }

          // Case C: data has direct URL field
          if (data.url && (data.url.includes(".m3u8") || data.url.includes("master"))) {
            console.log(`✅ Mega source URL [${path}]:`, data.url.substring(0, 80));
            return data.url;
          }
        } catch (e) {
          // 403/404 expected for some paths, continue
          if (e.response?.status !== 403 && e.response?.status !== 404) {
            console.log(`⚠️ Mega AJAX [${path}] failed:`, e.message);
          }
        }
      }

      console.log("⚠️ All mega extraction methods failed for:", megaUrl);
      return null;
    } catch (e) {
      console.log("⚠️ Mega HLS extraction failed:", e.message);
      return null;
    }
  }

  /**
   * Try to decrypt an encrypted mega sources payload.
   * Mega embeds sometimes use AES encryption on the sources JSON.
   */
  static _tryDecryptMegaPayload(data) {
    try {
      const b64Decode = (str) => {
        let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4 !== 0) b64 += "=";
        return Buffer.from(b64, "base64");
      };

      const tryDecrypt = (payload, key, iv, algo) => {
        try {
          const payloadBuf = b64Decode(payload);
          const keyBuf = typeof key === "string" ? b64Decode(key) : key;
          const ivBuf = typeof iv === "string" ? b64Decode(iv) : iv;

          if (algo === "aes-256-gcm" || algo === "AES-256-GCM") {
            const authTag = payloadBuf.slice(-16);
            const ciphertext = payloadBuf.slice(0, -16);
            const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, ivBuf);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(ciphertext);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return JSON.parse(decrypted.toString("utf8"));
          } else {
            // AES-256-CBC fallback
            const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuf, ivBuf);
            let decrypted = decipher.update(payloadBuf);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return JSON.parse(decrypted.toString("utf8"));
          }
        } catch {
          return null;
        }
      };

      const payload = data.sources;
      const algo = data.algorithm || data.enc_algorithm || "aes-256-gcm";

      // Try various key/iv source locations
      const keyLocations = [
        { key: data.key, iv: data.iv },
        { key: data.decryptKey, iv: data.decryptIv },
        { key: data.k, iv: data.iv },
      ];

      if (data.key_parts) {
        const keyBuf = Buffer.concat(data.key_parts.map(b64Decode));
        if (keyBuf.length === 32) {
          keyLocations.unshift({ key: keyBuf, iv: data.iv });
        }
      }

      if (data.decrypt_keys) {
        const dk = data.decrypt_keys;
        if (dk.edge_1 && dk.edge_2) {
          const keyBuf = Buffer.concat([b64Decode(dk.edge_1), b64Decode(dk.edge_2)]);
          if (keyBuf.length === 32) {
            keyLocations.unshift({ key: keyBuf, iv: data.iv || data.iv2 });
          }
        }
      }

      for (const { key, iv } of keyLocations) {
        if (!key || !iv) continue;
        const result = tryDecrypt(payload, key, iv, algo);
        if (result) {
          // Result might be an array of sources or an object with sources
          const sources = Array.isArray(result) ? result : result.sources || [result];
          if (sources.length > 0) {
            const src = sources[0];
            const url = (src.file || src.url || src.src || "")
              .replace(/\\u0026/g, "&")
              .replace(/&amp;/g, "&");
            if (url) return url;
          }
        }
      }

      return null;
    } catch (e) {
      console.log("⚠️ Mega payload decryption failed:", e.message);
      return null;
    }
  }

  static async extractVideoWithPuppeteer(
    animeLink,
    animeId,
    episodeNumber,
    options
  ) {
    // Cache extracted stream briefly
    try {
      const cached = await cacheGet(`stream:${animeId}:${episodeNumber}`);
      if (cached) return cached;
    } catch {}
    let browser;
    let context;

    try {
      console.log("🎥 Extracting video with Puppeteer from 9anime...");

      browser = await getBrowser();
      if (!browser) {
        throw new Error("Failed to initialize browser");
      }

      // Verify browser has newContext method
      if (typeof browser.newContext !== "function") {
        throw new Error(
          `Browser instance does not have newContext method. Browser type: ${typeof browser}, has newContext: ${
            "newContext" in browser
          }`
        );
      }

      try {
        context = await browser.newContext({
          userAgent: this.USER_AGENT,
          viewport: { width: 1280, height: 720 },
          bypassCSP: true,
          javaScriptEnabled: true,
          extraHTTPHeaders: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            DNT: "1",
            Connection: "keep-alive",
            "Upgrade-Insecure-Requests": "1",
          },
        });

        if (!context) {
          throw new Error("browser.newContext() returned null/undefined");
        }
      } catch (contextError) {
        console.error("❌ Failed to create browser context:", contextError);
        throw new Error(
          `Failed to create browser context: ${contextError.message}`
        );
      }

      const page = await context.newPage();

      // Navigate to the anime page with minimal timeout
      try {
        await page.goto(animeLink, {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
        console.log("✅ Page loaded successfully");
      } catch (gotoError) {
        console.log("⚠️ Page goto failed, trying with load event...");
        try {
          await page.goto(animeLink, { waitUntil: "load", timeout: 5000 });
          console.log("✅ Page loaded with load event");
        } catch (loadError) {
          console.log("⚠️ Page load also failed, continuing anyway...");
        }
      }

      // Wait briefly for any dynamic content
      await page.waitForTimeout(2000);

      // Try to find iframe elements (this is what we want!)
      let streamUrl = "";

      // Method 1: Look for 9anime specific video containers
      try {
        // 9anime usually has video players in specific containers
        const videoContainers = [
          ".player-embed iframe",
          ".player iframe",
          ".video-player iframe",
          "#player iframe",
          ".anime-video iframe",
          'iframe[src*="embed"]',
          'iframe[src*="player"]',
          "iframe",
        ];

        for (const selector of videoContainers) {
          try {
            const iframe = await page.$(selector);
            if (iframe) {
              const src = await iframe.getAttribute("src");
              // Normalize protocol-relative URLs (//vidmoly.net/...) to https
              const normalizedSrc = src && src.startsWith('//') ? 'https:' + src : src;
              if (normalizedSrc && (normalizedSrc.includes("https") || normalizedSrc.includes("http"))) {
                streamUrl = normalizedSrc;
                console.log("✅ Found 9anime iframe:", streamUrl);

                // If Mega or vidmoly is already on the main page, use it directly (no further navigation)
                if (streamUrl.match(/mega(play|cloud|backup|cdn|stream)/i) || streamUrl.match(/vidmoly\.(biz|net)/i)) {
                  console.log(
                    "🎯 Using video URL directly from main page:",
                    src
                  );
                  break;
                }

                // If it's a gogoanime URL, try to get the actual video source
                if (
                  src.includes("gogoanime.me.uk") ||
                  src.includes("gogoanime")
                ) {
                  console.log(
                    "🔍 Found gogoanime URL, extracting megaplay source..."
                  );

                  // Method 1: Try to fetch gogoanime page and extract megaplay URL
                  try {
                    console.log("📥 Fetching gogoanime page:", src);
                    const gogoResponse = await axios.get(src, {
                      headers: {
                        "User-Agent": this.USER_AGENT,
                        Accept:
                          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                        Referer: "https://9anime.org.lv/",
                      },
                      timeout: 15000,
                      maxRedirects: 5,
                    });

                    const gogoHtml = gogoResponse.data;
                    console.log("📄 Gogoanime HTML length:", gogoHtml.length);

                    // Multiple patterns to find megaplay or vidmoly URL
                    const patterns = [
                      // Standard iframe src (mega or vidmoly)
                      /<iframe[^>]*src=["']([^"']*(?:megaplay|vidmoly)[^"']*)["']/gi,
                      // data-src attribute
                      /<iframe[^>]*data-src=["']([^"']*(?:megaplay|vidmoly)[^"']*)["']/gi,
                      // JavaScript variable assignments
                      /src\s*[=:]\s*["']([^"']*(?:megaplay|vidmoly)[^"']*)["']/gi,
                      // URL in quotes anywhere
                      /["']([^"']*(?:megaplay\.buzz|vidmoly\.(?:biz|net))[^"']*)["']/gi,
                      // Broader pattern for any mega-related URL
                      /https?:\/\/[^"'\s]*megaplay[^"'\s]*/gi,
                      // Vidmoly embed pattern (with or without protocol)
                      /(?:https?:)?\/\/vidmoly\.(?:biz|net)\/embed-[^"'\s]*/gi,
                    ];

                    for (const pattern of patterns) {
                      const matches = [...gogoHtml.matchAll(pattern)];
                      if (matches.length > 0) {
                        console.log(
                          `🔍 Found ${matches.length} matches with pattern:`,
                          pattern.toString().substring(0, 50)
                        );
                        for (const match of matches) {
                          let url = match[1] || match[0];
                          // Normalize protocol-relative URLs
                          if (url && url.startsWith('//')) url = 'https:' + url;
                          if (
                            url &&
                            url.startsWith("http") &&
                            (url.match(/mega(play|cloud|backup|cdn|stream)/i) || url.match(/vidmoly\.(biz|net)/i))
                          ) {
                            streamUrl = url.replace(/["']/g, "").trim();
                            console.log("✅ Found video URL:", streamUrl);
                            break;
                          }
                        }
                        if (
                          streamUrl &&
                          (streamUrl.match(/mega(play|cloud|backup|cdn|stream)/i) || streamUrl.match(/vidmoly\.(biz|net)/i))
                        )
                          break;
                      }
                    }

                    // Additional fallback: Look for any video player iframe
                    if (!streamUrl || !(streamUrl.includes("megaplay") || streamUrl.includes("vidmoly."))) {
                      const anyIframeMatch = gogoHtml.match(
                        /<iframe[^>]*src=["']([^"']*(?:player|embed|stream)[^"']*)["']/i
                      );
                      if (anyIframeMatch && anyIframeMatch[1]) {
                        streamUrl = anyIframeMatch[1];
                        console.log(
                          "✅ Found alternative video player:",
                          streamUrl
                        );
                      }
                    }
                  } catch (fetchErr) {
                    console.log(
                      "⚠️ Failed to fetch gogoanime page:",
                      fetchErr.message
                    );
                  }

                  // Method 2: Try using Playwright to navigate to gogoanime page
                  if (
                    !streamUrl ||
                    !(streamUrl.match(/mega(play|cloud|backup|cdn|stream)/i) || streamUrl.match(/vidmoly\.(biz|net)/i))
                  ) {
                    try {
                      console.log(
                        "🌐 Trying Playwright navigation to gogoanime..."
                      );
                      const innerFrame = await iframe.contentFrame();
                      if (innerFrame) {
                        // Wait for nested iframes
                        await innerFrame.waitForTimeout(3000);

                        // Try to find any mega-related iframe
                        const iframeSelectors = [
                          'iframe[src*="megaplay"]',
                          'iframe[src*="megacloud"]',
                          'iframe[src*="megabackup"]',
                          'iframe[data-src*="mega"]',
                          'iframe[src*="embed"]',
                          "iframe",
                        ];

                        for (const selector of iframeSelectors) {
                          const nested = await innerFrame
                            .$(selector)
                            .catch(() => null);
                          if (nested) {
                            let nestedSrc =
                              (await nested.getAttribute("src")) ||
                              (await nested.getAttribute("data-src"));
                            if (!nestedSrc) {
                              nestedSrc = await nested
                                .evaluate(
                                  (el) => el.src || el.getAttribute("data-src")
                                )
                                .catch(() => null);
                            }
                            if (
                              nestedSrc &&
                              (nestedSrc.match(
                                /mega(play|cloud|backup|cdn|stream)/i
                              ) ||
                                nestedSrc.includes("embed"))
                            ) {
                              streamUrl = nestedSrc;
                              console.log(
                                "✅ Found video source via Playwright:",
                                streamUrl
                              );
                              break;
                            }
                          }
                        }
                      }
                    } catch (nestedErr) {
                      console.log(
                        "⚠️ Playwright navigation failed:",
                        nestedErr.message
                      );
                    }
                  }

                  // If we still don't have a mega URL, log what we found
                  if (
                    streamUrl &&
                    !streamUrl.match(/mega(play|cloud|backup|cdn|stream)/i)
                  ) {
                    console.log(
                      "⚠️ Could not find mega URL, using:",
                      streamUrl
                    );
                  }
                }

                // If it's a 2anime URL, try to get the actual video source
                if (src.includes("2anime.xyz")) {
                  console.log(
                    "🔍 Found 2anime URL, extracting actual video source..."
                  );
                  try {
                    const animeResponse = await axios.get(src, {
                      headers: { "User-Agent": this.USER_AGENT },
                      timeout: 10000,
                    });

                    const animeHtml = animeResponse.data;

                    // Look for various video sources in 2anime pages (including all mega variants)
                    const videoPatterns = [
                      /<iframe[^>]+data-src=["']([^"']+)["'][^>]*>/i,
                      /<iframe[^>]+src=["']([^"']*mega(?:play|cloud|backup|cdn|stream)[^"']*)["'][^>]*>/i,
                      /<iframe[^>]+src=["']([^"']*stream[^"']*)["'][^>]*>/i,
                      /<iframe[^>]+src=["']([^"']*2m\.2anime[^"']*)["'][^>]*>/i,
                      /<video[^>]+src=["']([^"']*)["'][^>]*>/i,
                      /"file":"([^"]+)"/i,
                      /"url":"([^"]+)"/i,
                    ];

                    for (const pattern of videoPatterns) {
                      const match = animeHtml.match(pattern);
                      if (match && match[1] && match[1].includes("http")) {
                        streamUrl = match[1];
                        console.log(
                          "✅ Found actual video source from 2anime:",
                          streamUrl
                        );
                        break;
                      }
                    }
                  } catch (e) {
                    console.log(
                      "⚠️ Could not extract video source from 2anime:",
                      e.message
                    );
                  }
                }

                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      } catch (e) {
        console.log("No 9anime iframe found, trying other methods...");
      }

      // Method 2: Look for video elements
      if (!streamUrl) {
        try {
          await page.waitForSelector("video", { timeout: 15000 });
          const videoSrc = await page.$eval("video", (el) => el.src);
          if (videoSrc) {
            streamUrl = videoSrc;
            console.log("✅ Found video source:", streamUrl);
          }
        } catch (e) {
          console.log("No video element found...");
        }
      }

      // Method 3: Extract from page content (9anime specific patterns)
      if (!streamUrl) {
        const pageContent = await page.content();
        console.log("🔍 Searching 9anime page content for video URLs...");

        // 9anime specific patterns
        const patterns = [
          /<iframe[^>]+src=["']([^"']*embed[^"']*)["'][^>]*>/gi,
          /<iframe[^>]+src=["']([^"']*player[^"']*)["'][^>]*>/gi,
          /iframe\.src\s*=\s*["']([^"']+)["']/gi,
          /data-src=["']([^"']*embed[^"']*)["']/gi,
          /src\s*:\s*["']([^"']*embed[^"']*)["']/gi,
          /"url"\s*:\s*"([^"]*embed[^"]*)"/gi,
          /"src"\s*:\s*"([^"]*embed[^"]*)"/gi,
        ];

        for (const pattern of patterns) {
          const matches = pageContent.match(pattern);
          if (matches && matches.length > 0) {
            console.log(`Found ${matches.length} matches with 9anime pattern`);
            for (const match of matches) {
              const url = match
                .replace(/<iframe[^>]+src=["']/, "")
                .replace(/["'][^>]*>/, "")
                .replace(/iframe\.src\s*=\s*["']/, "")
                .replace(/["']/, "")
                .replace(/data-src=["']/, "")
                .replace(/["']/, "")
                .replace(/src\s*:\s*["']/, "")
                .replace(/["']/, "")
                .replace(/"url"\s*:\s*"/, "")
                .replace(/"/, "")
                .replace(/"src"\s*:\s*"/, "")
                .replace(/"/, "");

              if (
                url &&
                url.includes("http") &&
                (url.includes("embed") || url.includes("player"))
              ) {
                // Decode HTML entities (e.g. &amp; → &)
                streamUrl = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
                console.log(
                  "✅ Found 9anime video URL in page content:",
                  streamUrl
                );
                break;
              }
            }
            if (streamUrl) break;
          }
        }
      }

      // Method 3b: If we found a gogoanime URL from page content, extract the megaplay/vidmoly source
      if (streamUrl && (streamUrl.includes("gogoanime.me.uk") || streamUrl.includes("gogoanime")) && !streamUrl.match(/mega(play|cloud|backup|cdn|stream)/i) && !streamUrl.match(/vidmoly\.(biz|net)/i)) {
        console.log("🔍 Page content returned gogoanime URL, extracting video source...");
        try {
          const gogoResponse = await axios.get(streamUrl, {
            headers: {
              "User-Agent": this.USER_AGENT,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              Referer: "https://9anime.org.lv/",
            },
            timeout: 15000,
            maxRedirects: 5,
          });

          const gogoHtml = gogoResponse.data;
          console.log("📄 Gogoanime HTML length:", gogoHtml.length);

          const megaPatterns = [
            /<iframe[^>]*src=["']([^"']*(?:megaplay|vidmoly)[^"']*)["']/gi,
            /<iframe[^>]*data-src=["']([^"']*(?:megaplay|vidmoly)[^"']*)["']/gi,
            /src\s*[=:]\s*["']([^"']*(?:megaplay|vidmoly)[^"']*)["']/gi,
            /["']([^"']*(?:megaplay\.buzz|vidmoly\.(?:biz|net))[^"']*)["']/gi,
            /https?:\/\/[^"'\s]*megaplay[^"'\s]*/gi,
            /(?:https?:)?\/\/vidmoly\.(?:biz|net)\/embed-[^"'\s]*/gi,
          ];

          for (const pattern of megaPatterns) {
            const matches = [...gogoHtml.matchAll(pattern)];
            if (matches.length > 0) {
              console.log(`🔍 Found ${matches.length} matches with pattern:`, pattern.toString().substring(0, 50));
              for (const match of matches) {
                let url = match[1] || match[0];
                // Normalize protocol-relative URLs
                if (url && url.startsWith('//')) url = 'https:' + url;
                if (url && url.startsWith("http") && (url.match(/mega(play|cloud|backup|cdn|stream)/i) || url.match(/vidmoly\.(biz|net)/i))) {
                  streamUrl = url.replace(/["']/g, "").trim();
                  console.log("✅ Found video URL from gogoanime fallback:", streamUrl);
                  break;
                }
              }
              if (streamUrl && (streamUrl.match(/mega(play|cloud|backup|cdn|stream)/i) || streamUrl.match(/vidmoly\.(biz|net)/i))) break;
            }
          }
        } catch (fetchErr) {
          console.log("⚠️ Failed to fetch gogoanime page for megaplay extraction:", fetchErr.message);
        }
      }

      // Method 4: If no actual stream URL was found, return an error
      // instead of saving the anime page URL as a fake video source
      if (!streamUrl) {
        console.log("❌ Could not extract any video/embed URL from:", animeLink);

        if (context) {
          await context.close().catch(err => console.warn('Failed to close context:', err));
        }
        return {
          success: false,
          error: `No video stream found for episode. The anime page loaded but no embeddable player was detected.`,
        };
      }

      console.log("🎉 Final 9anime URL:", streamUrl);

      // bysesayeveum.com/e/ URLs are used as-is in sandboxed iframe (blocks ad redirects)

      console.log(
        "🔍 DEBUG: streamUrl type:",
        typeof streamUrl,
        "value:",
        streamUrl
      );
      console.log(
        "🔍 DEBUG: Is mega URL?",
        streamUrl.match(/mega(play|cloud|backup|cdn|stream)/i) ? "YES" : "NO"
      );

      if (context) {
        await context
          .close()
          .catch((err) => console.warn("Failed to close context:", err));
      }

      const payload = {
        success: true,
        streamUrl,
        episodeData: {
          animeId,
          extractedAt: new Date(),
        },
      };
      console.log(
        "📦 DEBUG: Returning payload with streamUrl:",
        payload.streamUrl
      );
      try {
        await cacheSet(`stream:${animeId}:${episodeNumber}`, payload, 120_000);
      } catch {}
      return payload;
    } catch (error) {
      console.error("❌ Error in extractVideoWithPuppeteer:", error.message);
      if (context) {
        await context
          .close()
          .catch((err) =>
            console.warn("Failed to close context in catch:", err)
          );
      }
      return { success: false, error: error.message };
    }
  }

  static async saveEpisodeToDatabase(episodeData) {
    try {
      console.log(
        "💾 DEBUG: saveEpisodeToDatabase called with videoUrl:",
        episodeData.videoUrl
      );

      // Check if a stub already exists (from Jikan import) — if so, only update video_url
      const { data: existing } = await supabase
        .from("episodes")
        .select("id, title, description, thumbnail_url")
        .eq("anime_id", episodeData.animeId)
        .eq("episode_number", episodeData.episodeNumber)
        .maybeSingle();

      if (existing) {
        // Stub exists — only update video_url and duration, preserve title/description/thumbnail
        console.log(`💾 Updating existing episode stub (keeping title: "${existing.title}")`);
        const { error } = await supabase
          .from("episodes")
          .update({
            video_url: episodeData.videoUrl,
            duration: episodeData.duration,
          })
          .eq("id", existing.id);

        if (error) {
          console.error("❌ DB Error:", error.message);
          return { success: false, error: error.message };
        }
        console.log("🎉 Stream saved to Supabase with URL:", episodeData.videoUrl);
        return { success: true };
      }

      // No existing stub — insert full record
      const dataToSave = {
        anime_id: episodeData.animeId,
        episode_number: episodeData.episodeNumber,
        title: episodeData.title,
        video_url: episodeData.videoUrl,
        thumbnail_url: episodeData.thumbnailUrl,
        duration: episodeData.duration,
        description: episodeData.description,
        created_at: episodeData.createdAt.toISOString(),
      };

      console.log(
        "💾 DEBUG: Inserting new episode:",
        JSON.stringify(dataToSave, null, 2)
      );

      const { error } = await supabase
        .from("episodes")
        .upsert(dataToSave, { onConflict: ["anime_id", "episode_number"] });

      if (error) {
        console.error("❌ DB Error:", error.message);
        return { success: false, error: error.message };
      }
      console.log(
        "🎉 Stream saved to Supabase with URL:",
        episodeData.videoUrl
      );
      return { success: true };
    } catch (error) {
      console.error("❌ Save Error:", error.message);
      return { success: false, error: error.message };
    }
  }

  static async scrapeAndSaveEpisode(
    animeTitle,
    animeId,
    episodeNumber = 1,
    options = {}
  ) {
    try {
      const scrapeResult = await this.scrapeAnimeEpisode(
        animeTitle,
        episodeNumber,
        { ...options, dbAnimeId: animeId }
      );
      console.log("🔍 DEBUG: scrapeResult.streamUrl:", scrapeResult.streamUrl);

      if (scrapeResult.success && scrapeResult.streamUrl) {
        // Look up the anime's poster from DB to use as thumbnail instead of
        // a hardcoded AniList URL pattern that produces broken images
        let thumbnailUrl = null;
        try {
          const { data: animeRow } = await supabase
            .from('anime')
            .select('poster_url')
            .eq('id', animeId)
            .single();
          thumbnailUrl = animeRow?.poster_url || null;
        } catch {}

        const episodeData = {
          animeId: animeId,
          episodeNumber: episodeNumber,
          title: `${animeTitle} - Episode ${episodeNumber}`,
          videoUrl: scrapeResult.streamUrl,
          thumbnailUrl,
          duration: 1440, // Default to 24 mins
          description: `Episode ${episodeNumber} of ${animeTitle}`,
          createdAt: new Date(),
        };
        console.log(
          "💾 DEBUG: Saving to database with videoUrl:",
          episodeData.videoUrl
        );

        const saveResult = await this.saveEpisodeToDatabase(episodeData);

        if (saveResult.success) {
          return {
            success: true,
            streamUrl: scrapeResult.streamUrl,
            episodeData: episodeData,
          };
        } else {
          return {
            success: false,
            error: saveResult.error,
          };
        }
      } else {
        return scrapeResult;
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Health check endpoint
// Health check endpoints (use new handlers)
app.get("/health", getHealthHandler());
app.get("/api/health", getDetailedHealthHandler(supabase, redis));

// Legacy health endpoint (remove if needed)
app.get("/health-old", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "9anime Scraper API",
  });
});

// Resolve bysesayeveum embed URL → fresh HLS stream (called by player at playback time)
app.get("/api/resolve-stream", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.includes("bysesayeveum.com/e/")) {
      return res.status(400).json({ error: "Invalid bysesayeveum URL" });
    }
    console.log("🔄 Resolving stream for:", url);
    const hlsUrl = await NineAnimeScraperService.extractBysesayeveumHLS(url);
    if (hlsUrl) {
      return res.json({ success: true, hlsUrl });
    }
    return res.status(502).json({ success: false, error: "Could not extract HLS stream" });
  } catch (e) {
    console.error("❌ resolve-stream error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Resolve vidmoly embed URL → fresh HLS stream (called by vidmoly embed page at playback time)
app.get("/api/resolve-vidmoly-stream", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.match(/vidmoly\.(biz|net)/)) {
      return res.status(400).json({ error: "Invalid vidmoly URL" });
    }
    console.log("🔄 Resolving vidmoly stream for:", url);
    const hlsUrl = await NineAnimeScraperService.extractVidmolyHLS(url);
    if (hlsUrl) {
      return res.json({ success: true, hlsUrl });
    }
    return res.status(502).json({ success: false, error: "Could not extract HLS from vidmoly" });
  } catch (e) {
    console.error("❌ resolve-vidmoly-stream error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Clean ad-free vidmoly embed page — extracts HLS and plays via hls.js (no ads)
app.get("/api/vidmoly-embed/:id", async (req, res) => {
  const videoId = req.params.id;
  const startTime = parseInt(req.query.start) || 0;
  const vidmolyUrl = `https://vidmoly.biz/embed-${videoId}.html`;
  console.log("🎬 Serving clean vidmoly embed for:", videoId, "start:", startTime);

  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("Content-Security-Policy", "default-src 'self' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.vmwesa.online https://*; media-src * blob:; worker-src blob:; img-src *");
  res.removeHeader("Cross-Origin-Opener-Policy");

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Player</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  video{width:100%;height:100%;object-fit:contain;background:#000}
  #loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:10}
  .spinner{width:48px;height:48px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #error{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#000;color:#ef4444;font-family:system-ui;text-align:center;padding:20px;z-index:10}
  #error h3{font-size:16px;margin-bottom:8px}
  #error p{font-size:13px;color:#999}
  #error button{margin-top:12px;padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px}
  #error button:hover{background:#2563eb}
</style>
</head><body>
<div id="loader"><div class="spinner"></div></div>
<div id="error"><div><h3>Failed to load video</h3><p id="errMsg"></p><button onclick="loadVideo()">Retry</button></div></div>
<video id="player" controls autoplay playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
const video = document.getElementById('player');
const loader = document.getElementById('loader');
const errorEl = document.getElementById('error');
const errMsg = document.getElementById('errMsg');
const VIDMOLY_URL = ${JSON.stringify(vidmolyUrl)};

async function loadVideo() {
  loader.style.display = 'flex';
  errorEl.style.display = 'none';
  try {
    const r = await fetch('/api/resolve-vidmoly-stream?url=' + encodeURIComponent(VIDMOLY_URL));
    const data = await r.json();
    if (!data.success || !data.hlsUrl) throw new Error(data.error || 'No stream URL returned');
    const hlsUrl = data.hlsUrl;
    console.log('✅ Got HLS:', hlsUrl.substring(0, 80));
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { loader.style.display = 'none'; var st = ${startTime}; if (st > 0) video.currentTime = st; video.play().catch(()=>{}); });
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) {
          console.error('HLS fatal error:', d);
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else { showError('Playback error: ' + d.details); hls.destroy(); }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => { loader.style.display = 'none'; var st = ${startTime}; if (st > 0) video.currentTime = st; video.play().catch(()=>{}); });
    } else {
      showError('HLS not supported in this browser');
    }
  } catch (err) {
    console.error('❌', err);
    showError(err.message);
  }
}
function showError(msg) { loader.style.display = 'none'; errorEl.style.display = 'flex'; errMsg.textContent = msg; }

video.addEventListener('timeupdate', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'videojs',
      event: 'timeupdate',
      currentTime: video.currentTime,
      duration: video.duration || 0,
      paused: video.paused
    }, '*');
  }
});
video.addEventListener('ended', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'videojs',
      event: 'ended',
      currentTime: video.duration || 0,
      duration: video.duration || 0,
      paused: true
    }, '*');
  }
});

loadVideo();
</script>
</body></html>`);
});

// Clean ad-free video embed page — resolves bysesayeveum HLS and plays via hls.js
app.get("/api/video-embed/:id", async (req, res) => {
  const videoId = req.params.id;
  const startTime = parseInt(req.query.start) || 0;
  const byseUrl = `https://bysesayeveum.com/e/${videoId}`;
  console.log("🎬 Serving clean embed for:", videoId, "start:", startTime);

  // Override security headers so this page can be embedded in an iframe and load CDN scripts
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("Content-Security-Policy", "default-src 'self' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.r66nv9ed.com https://*.bysevideo.net https://*; media-src * blob:; worker-src blob:; img-src *");
  res.removeHeader("Cross-Origin-Opener-Policy");

  // Serve a self-contained HTML page that resolves + plays the stream
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Player</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  video{width:100%;height:100%;object-fit:contain;background:#000}
  #loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:10}
  .spinner{width:48px;height:48px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #error{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#000;color:#ef4444;font-family:system-ui;text-align:center;padding:20px;z-index:10}
  #error h3{font-size:16px;margin-bottom:8px}
  #error p{font-size:13px;color:#999}
  #error button{margin-top:12px;padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px}
  #error button:hover{background:#2563eb}
</style>
</head><body>
<div id="loader"><div class="spinner"></div></div>
<div id="error"><div><h3>Failed to load video</h3><p id="errMsg"></p><button onclick="loadVideo()">Retry</button></div></div>
<video id="player" controls autoplay playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
const video = document.getElementById('player');
const loader = document.getElementById('loader');
const errorEl = document.getElementById('error');
const errMsg = document.getElementById('errMsg');
const BYSE_URL = ${JSON.stringify(byseUrl)};

async function loadVideo() {
  loader.style.display = 'flex';
  errorEl.style.display = 'none';
  try {
    const r = await fetch('/api/resolve-stream?url=' + encodeURIComponent(BYSE_URL));
    const data = await r.json();
    if (!data.success || !data.hlsUrl) throw new Error(data.error || 'No stream URL returned');
    const hlsUrl = data.hlsUrl;
    console.log('✅ Got HLS:', hlsUrl.substring(0, 80));
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { loader.style.display = 'none'; var st = ${startTime}; if (st > 0) video.currentTime = st; video.play().catch(()=>{}); });
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) {
          console.error('HLS fatal error:', d);
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else { showError('Playback error: ' + d.details); hls.destroy(); }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => { loader.style.display = 'none'; var st = ${startTime}; if (st > 0) video.currentTime = st; video.play().catch(()=>{}); });
    } else {
      showError('HLS not supported in this browser');
    }
  } catch (err) {
    console.error('❌', err);
    showError(err.message);
  }
}
function showError(msg) { loader.style.display = 'none'; errorEl.style.display = 'flex'; errMsg.textContent = msg; }

// Report progress to parent frame (IframePlayer listens for these)
video.addEventListener('timeupdate', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'videojs',
      event: 'timeupdate',
      currentTime: video.currentTime,
      duration: video.duration || 0,
      paused: video.paused
    }, '*');
  }
});
video.addEventListener('ended', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'videojs',
      event: 'ended',
      currentTime: video.duration || 0,
      duration: video.duration || 0,
      paused: true
    }, '*');
  }
});

loadVideo();
</script>
</body></html>`);
});

// Resolve mega embed URL → fresh HLS stream (called by mega embed page at playback time)
app.get("/api/resolve-mega-stream", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.match(/mega(play|cloud|backup|cdn|stream)/i)) {
      return res.status(400).json({ error: "Invalid mega embed URL" });
    }
    console.log("🔄 Resolving mega stream for:", url);
    const hlsUrl = await NineAnimeScraperService.extractMegaHLS(url);
    if (hlsUrl) {
      return res.json({ success: true, hlsUrl });
    }
    return res.status(502).json({ success: false, error: "Could not extract HLS from mega embed" });
  } catch (e) {
    console.error("❌ resolve-mega-stream error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Clean ad-free mega video embed page — wraps the original mega player with progress tracking
app.get("/api/mega-embed/:host/:id", async (req, res) => {
  const { host, id: videoId } = req.params;
  const startTime = parseInt(req.query.start) || 0;
  // Support both /embed/ and /e/ paths
  const megaUrl = `https://${host}/embed/${videoId}`;
  const megaUrlAlt = `https://${host}/e/${videoId}`;
  console.log("🎬 Serving clean mega embed for:", megaUrl, "start:", startTime);

  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src *; media-src * blob:; worker-src blob:;");
  res.removeHeader("Cross-Origin-Opener-Policy");

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Player</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  iframe{width:100%;height:100%;border:none}
  #loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:10;transition:opacity .3s}
  .spinner{width:48px;height:48px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>
<div id="loader"><div class="spinner"></div></div>
<iframe id="player" src="${megaUrl}?autoplay=1" allow="autoplay; fullscreen; encrypted-media" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"></iframe>
<script>
const iframe = document.getElementById('player');
const loader = document.getElementById('loader');
let started = false;
let watchStart = Date.now();
let startOffset = ${startTime};
let estimatedDuration = 1440; // 24 min default

iframe.addEventListener('load', () => {
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 300);
  started = true;
  watchStart = Date.now();
  // Focus iframe so keyboard shortcuts (space = play/pause) work immediately
  iframe.focus();
});

// If the embed URL with /embed/ gets blocked, try /e/
iframe.addEventListener('error', () => {
  iframe.src = ${JSON.stringify(megaUrlAlt + '?autoplay=1')};
});

// Since we can't read cross-origin iframe video state,
// use time-based estimation (same approach as IframePlayer's estimated mode)
setInterval(() => {
  if (!started || document.hidden) return;
  const elapsed = (Date.now() - watchStart) / 1000 + startOffset;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'videojs',
      event: 'timeupdate',
      currentTime: elapsed,
      duration: estimatedDuration,
      paused: false
    }, '*');
  }
}, 5000);

// Report ended after estimated duration
function checkEnded() {
  if (!started) return;
  const elapsed = (Date.now() - watchStart) / 1000;
  if (elapsed >= estimatedDuration * 0.9) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'videojs',
        event: 'ended',
        currentTime: estimatedDuration,
        duration: estimatedDuration,
        paused: true
      }, '*');
    }
  }
}
setInterval(checkEnded, 10000);

// Also try to receive postMessage from the mega player itself (some do send events)
window.addEventListener('message', (e) => {
  if (e.data && typeof e.data === 'object') {
    const ct = e.data.currentTime || e.data.time;
    const dur = e.data.duration;
    if (ct !== undefined && dur) {
      estimatedDuration = dur;
      watchStart = Date.now() - (ct * 1000); // Sync our timer
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'videojs',
          event: 'timeupdate',
          currentTime: ct,
          duration: dur,
          paused: e.data.paused || false
        }, '*');
      }
    }
  }
});
</script>
</body></html>`);
});

// Single episode scraping endpoint
app.post("/api/scrape-episode", async (req, res) => {
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

// Test gogoanime URL extraction
app.post("/api/test-gogoanime-extract", async (req, res) => {
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

    // Extract all potential video URLs
    const results = {
      megaUrls: [], // All mega variants (megaplay, megacloud, etc.)
      allIframeUrls: [],
      otherVideoUrls: [],
    };

    // Pattern 1: ALL Mega URLs (megaplay, megacloud, megabackup, etc.)
    const megaPattern =
      /https?:\/\/[^"'\s]*mega(?:play|cloud|backup|cdn|stream|\.)[^"'\s]*/gi;
    const megaMatches = [...html.matchAll(megaPattern)];
    results.megaUrls = [
      ...new Set(megaMatches.map((m) => m[0].replace(/["']/g, "").trim())),
    ];

    // Pattern 2: All iframe src
    const iframePattern = /<iframe[^>]*src=["']([^"']+)["']/gi;
    const iframeMatches = [...html.matchAll(iframePattern)];
    results.allIframeUrls = [...new Set(iframeMatches.map((m) => m[1]))];

    // Pattern 3: Video/player/embed URLs
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
app.post("/api/test-scraper", async (req, res) => {
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
app.post("/api/resolve-slug", async (req, res) => {
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
app.post("/api/batch-resolve-slugs", async (req, res) => {
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
app.post("/api/scrape-all-episodes", async (req, res) => {
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
app.post("/api/batch-scrape-episodes", async (req, res) => {
  try {
    console.log("🎬 API: Batch scraping episodes...");

    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: "Anime title, ID, and episode numbers are required",
      });
    }

    // Pre-check: skip episodes that already have a video_url in the DB
    let epsToScrape = episodeNumbers;
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

    // Resolve the anime slug once before scraping episodes
    let resolvedSlug = null;
    try {
      const slugResult = await NineAnimeScraperService.searchAnimeWithCheerio(
        animeTitle, 1, animeId
      );
      if (slugResult.success) {
        resolvedSlug = slugResult.animeId; // This is the slug
        console.log(`✅ Resolved slug once: ${resolvedSlug}`);
      }
    } catch (e) {
      console.warn('⚠️ Pre-resolve slug failed, will resolve per-episode:', e.message);
    }

    // Scrape each episode (stop early on consecutive failures — episodes are sequential)
    let consecutiveFailures = 0;
    for (const episodeNumber of epsToScrape) {
      try {
        console.log(`📺 Scraping episode ${episodeNumber}...`);

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

        if (consecutiveFailures >= 2) {
          console.log(`⏹️ Stopping batch: ${consecutiveFailures} consecutive failures — remaining episodes likely not available yet`);
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
      `✅ Batch scraping completed: ${successCount}/${epsToScrape.length} newly scraped, ${episodeNumbers.length - epsToScrape.length} already had URLs`
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
app.post("/api/batch-scrape-episodes-stream", async (req, res) => {
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

    // Pre-check: skip episodes that already have a video_url
    let epsToScrape = episodeNumbers;
    let skippedCount = 0;
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

    // Resolve the anime slug once before scraping episodes
    let resolvedSlug = null;
    try {
      const slugResult = await NineAnimeScraperService.searchAnimeWithCheerio(
        animeTitle, 1, animeId
      );
      if (slugResult.success) {
        resolvedSlug = slugResult.animeId;
        console.log(`✅ Resolved slug once: ${resolvedSlug}`);
      }
    } catch (e) {
      console.warn('⚠️ Pre-resolve slug failed:', e.message);
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

        if (consecutiveFailures >= 2) {
          console.log(`⏹️ Stopping batch: ${consecutiveFailures} consecutive failures — remaining episodes likely not available yet`);
          res.write(
            `data: ${JSON.stringify({
              type: "stopped",
              reason: "Consecutive failures — remaining episodes not yet available",
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

// Optimized anime list endpoints with Redis caching
// Featured anime (highest rated)
app.get("/api/anime/featured", cacheMiddleware(300_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "5", 10);
    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .gte("rating", 8.0)
      .order("rating", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Featured anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Featured anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trending anime (recently added with good rating)
app.get("/api/anime/trending", cacheMiddleware(300_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "10", 10);
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .gte("created_at", thirtyDaysAgo)
      .gte("rating", 7.0)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Trending anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // Fallback if not enough data
    if (!data || data.length < limit) {
      const { data: fallbackData } = await supabase
        .from("anime")
        .select("*")
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(limit);

      return res.json({ success: true, data: fallbackData || [] });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Trending anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Popular anime (highest rated)
app.get("/api/anime/popular", cacheMiddleware(300_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "12", 10);
    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .not("rating", "is", null)
      .order("rating", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Popular anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Popular anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recent anime (newest first)
app.get("/api/anime/recent", cacheMiddleware(120_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "6", 10);
    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Recent anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Recent anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get episodes for an anime
app.get(
  "/api/anime/:animeId/episodes",
  cacheMiddleware(30_000),
  async (req, res) => {
    try {
      const { animeId } = req.params;
      console.log("🔍 API: Getting episodes for anime ID:", animeId);

      const { data: episodes, error } = await supabase
        .from("episodes")
        .select("episode_number, title, video_url, created_at")
        .eq("anime_id", animeId)
        .order("episode_number");

      if (error) {
        console.error("❌ Database error:", error);
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }

      console.log("✅ Found episodes:", episodes?.length || 0);
      res.json({
        success: true,
        episodes: episodes || [],
      });
    } catch (error) {
      console.error("❌ Error getting episodes:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Add scraped episode to database endpoint
app.post("/api/add-scraped-episode", async (req, res) => {
  try {
    console.log("💾 API: Adding scraped episode to database...");

    const { animeId, episodeData } = req.body;

    if (!animeId || !episodeData) {
      return res.status(400).json({
        success: false,
        error: "Anime ID and episode data are required",
      });
    }

    // Check if episode already exists
    const { data: existingEpisode, error: checkError } = await supabase
      .from("episodes")
      .select("id")
      .eq("anime_id", animeId)
      .eq("episode_number", episodeData.number)
      .maybeSingle(); // Use maybeSingle() to avoid errors when no record found

    let data, error;

    if (existingEpisode && !checkError) {
      // Episode exists, update it
      console.log(
        `📝 Updating existing episode ${episodeData.number} for anime ${animeId}`
      );
      const updateResult = await supabase
        .from("episodes")
        .update({
          title: episodeData.title,
          video_url: episodeData.streamUrl,
          duration: episodeData.duration || 1440, // Default to 24 minutes if not provided
          description: `Scraped from 9anime.org.lv - ${
            episodeData.embeddingProtected
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
      // Episode doesn't exist, insert it
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
          duration: episodeData.duration || 1440, // Default to 24 minutes (1440 seconds) if not provided
          thumbnail_url: null,
          description: `Scraped from 9anime.org.lv - ${
            episodeData.embeddingProtected
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
      `✅ Episode ${episodeData.number} ${
        existingEpisode ? "updated" : "added"
      } to database`
    );

    cacheInvalidateAnime(animeId);

    res.json({
      success: true,
      message: `Episode ${episodeData.number} ${
        existingEpisode ? "updated" : "added"
      } successfully!`,
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

// ─── Admin CRUD endpoints (bypass RLS via service_role key) ───

// Create anime
app.post("/api/admin/anime", async (req, res) => {
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
app.put("/api/admin/anime/:id", async (req, res) => {
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
app.delete("/api/admin/anime/:id", async (req, res) => {
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
app.post("/api/admin/anime/bulk-delete", async (req, res) => {
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
app.post("/api/admin/episodes", async (req, res) => {
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
app.put("/api/admin/episodes/:id", async (req, res) => {
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
app.delete("/api/admin/episodes/:id", async (req, res) => {
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

// Start large anime scraping job
app.post("/api/start-large-scrape", async (req, res) => {
  try {
    console.log("🎬 API: Starting large anime scraping job...");

    const { animeId, animeTitle, totalEpisodes, chunkSize = 50 } = req.body;

    if (!animeId || !animeTitle || !totalEpisodes) {
      return res.status(400).json({
        success: false,
        error: "Anime ID, title, and total episodes are required",
      });
    }

    // Calculate chunks
    const totalChunks = Math.ceil(totalEpisodes / chunkSize);

    // Create or update scraping progress
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

    // Create episode log entries for all episodes
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
app.get(
  "/api/scraping-progress/:animeId",
  cacheMiddleware(15_000),
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

      // Calculate progress percentage
      const progressPercentage =
        progress.total_episodes > 0
          ? Math.round(
              (progress.completed_episodes / progress.total_episodes) * 100
            )
          : 0;

      // Estimate time remaining
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
          episodesPerMs: episodesPerMs * 1000, // episodes per second
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
app.post("/api/scrape-chunk", async (req, res) => {
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

    // Get episodes to scrape from log
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

    // Scrape each episode in the chunk
    for (const episodeLog of episodesToScrape) {
      const episodeNumber = episodeLog.episode_number;

      try {
        // Update status to scraping
        await supabase
          .from("episode_scraping_log")
          .update({ status: "scraping" })
          .eq("scraping_progress_id", progressId)
          .eq("episode_number", episodeNumber);

        // Scrape the episode
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
          // Save to database
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

          // Update log to success
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

        // Update log to failed
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

      // Add delay between episodes to avoid being blocked
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Update overall progress
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
app.get("/api/image-proxy", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL parameter is required",
      });
    }

    // Validate URL
    let imageUrl;
    try {
      imageUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid URL provided",
      });
    }

    // Security: Only allow HTTPS and common image hosting domains
    if (imageUrl.protocol !== "https:") {
      return res.status(400).json({
        success: false,
        error: "Only HTTPS URLs are allowed",
      });
    }

    console.log("🖼️ Proxying image:", url);

    // Check cache first
    const cacheKey = `img:${url}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      console.log("✅ Image from cache");
      const buffer = Buffer.from(cached.data, "base64");
      res.set({
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=86400", // 24 hours
        "X-Cache": "HIT",
      });
      return res.send(buffer);
    }

    // Fetch the image
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: imageUrl.origin,
      },
      timeout: 10000,
      maxContentLength: 10 * 1024 * 1024, // 10MB max
    });

    const contentType = response.headers["content-type"] || "image/jpeg";
    const buffer = Buffer.from(response.data);

    // Cache the image (convert to base64 for storage)
    try {
      await cacheSet(
        cacheKey,
        {
          data: buffer.toString("base64"),
          contentType,
        },
        24 * 60 * 60 * 1000
      ); // Cache for 24 hours
    } catch (cacheErr) {
      console.warn("Failed to cache image:", cacheErr.message);
    }

    // Set appropriate headers
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400", // 24 hours
      "X-Cache": "MISS",
      "Access-Control-Allow-Origin": "*",
    });

    res.send(buffer);
  } catch (error) {
    console.error("❌ Image proxy error:", error.message);

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

// Helper function to format duration
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/* =========================================================================
 *  Episode Scheduler — automatically checks for new episodes of ongoing anime
 * ========================================================================= */
class EpisodeScheduler {
  constructor() {
    // Configuration from env (trim whitespace — .env has leading spaces)
    const t = (k, d) => (process.env[k] || '').trim() || d;
    this.enabled = t('SCHEDULER_ENABLED', 'true') === 'true';
    this.checkIntervalMs = parseInt(t('SCHEDULER_EPISODE_CHECK_INTERVAL_HOURS', '6')) * 60 * 60 * 1000;
    this.maxConcurrent = parseInt(t('SCHEDULER_MAX_CONCURRENT_JOBS', '2'));
    this.rateLimit = parseInt(t('SCHEDULER_RATE_LIMIT_EPISODES_PER_HOUR', '30'));
    this.minRating = parseFloat(t('SCHEDULER_MIN_ANIME_RATING', '0'));

    // State
    this.timer = null;
    this.initialTimeout = null;
    this.running = false;
    this.lastRun = null;
    this.lastResults = null;
    this.scrapedThisHour = 0;
    this.rateLimitReset = Date.now() + 60 * 60 * 1000;
  }

  start() {
    if (!this.enabled) {
      console.log('⏸️  Episode scheduler disabled (SCHEDULER_ENABLED != true)');
      return;
    }
    console.log(`⏰ Episode scheduler started — checking every ${this.checkIntervalMs / 3600000}h`);
    // First run after 30s (let the server boot fully)
    this.initialTimeout = setTimeout(() => this.run(), 30 * 1000);
    this.timer = setInterval(() => this.run(), this.checkIntervalMs);
  }

  stop() {
    if (this.initialTimeout) { clearTimeout(this.initialTimeout); this.initialTimeout = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async run() {
    if (!this.enabled) {
      console.log('⏸️ Scheduler: disabled, skipping run');
      return { skipped: true };
    }
    if (this.running) {
      console.log('⏳ Scheduler: previous run still active, skipping');
      return { skipped: true };
    }
    this.running = true;
    const started = Date.now();
    console.log('🔄 Scheduler: checking anime for new episodes…');

    const results = { checked: 0, found: 0, failed: 0, skipped: 0, details: [] };

    try {
      // 1. Get all anime that might need episodes:
      //    - ongoing (always check for new eps)
      //    - any status with total_episodes > 0 (may have missing episodes)
      const { data: allAnime, error } = await supabase
        .from('anime')
        .select('id, title, title_english, status, total_episodes, rating, nine_anime_slug')
        .order('rating', { ascending: false });

      if (error) throw error;
      if (!allAnime || allAnime.length === 0) {
        console.log('📭 Scheduler: no anime found');
        this.running = false;
        this.lastRun = new Date().toISOString();
        this.lastResults = results;
        return results;
      }

      console.log(`📋 Scheduler: ${allAnime.length} anime in database`);

      // 2. For each anime, find the highest episode number already in DB
      const animeIds = allAnime.map(a => a.id);
      const { data: maxEps } = await supabase
        .from('episodes')
        .select('anime_id, episode_number')
        .in('anime_id', animeIds)
        .order('episode_number', { ascending: false });

      // Build map: anime_id → highest episode number
      const maxEpMap = new Map();
      // Also count episodes per anime
      const epCountMap = new Map();
      for (const ep of (maxEps || [])) {
        if (!maxEpMap.has(ep.anime_id) || ep.episode_number > maxEpMap.get(ep.anime_id)) {
          maxEpMap.set(ep.anime_id, ep.episode_number);
        }
        epCountMap.set(ep.anime_id, (epCountMap.get(ep.anime_id) || 0) + 1);
      }

      // 3. Filter to anime that actually need episodes:
      //    a) ongoing — always check for next ep
      //    b) any anime with 0 episodes — needs initial scrape
      //    c) anime where episodes in DB < total_episodes — has gaps
      const needsEpisodes = allAnime.filter(a => {
        const epCount = epCountMap.get(a.id) || 0;
        if (a.status === 'ongoing') return true;
        if (epCount === 0) return true;
        if (a.total_episodes && epCount < a.total_episodes) return true;
        return false;
      });

      // Sort: ongoing first, then by how many episodes are missing (most missing first)
      needsEpisodes.sort((a, b) => {
        const aOngoing = a.status === 'ongoing' ? 0 : 1;
        const bOngoing = b.status === 'ongoing' ? 0 : 1;
        if (aOngoing !== bOngoing) return aOngoing - bOngoing;
        // Then by missing episodes (most missing first)
        const aMissing = (a.total_episodes || 0) - (epCountMap.get(a.id) || 0);
        const bMissing = (b.total_episodes || 0) - (epCountMap.get(b.id) || 0);
        return bMissing - aMissing;
      });

      console.log(`📋 Scheduler: ${needsEpisodes.length} anime need episodes (${needsEpisodes.filter(a => a.status === 'ongoing').length} ongoing, ${needsEpisodes.filter(a => (epCountMap.get(a.id) || 0) === 0).length} with 0 eps)`);

      // 4. Process anime in batches with concurrency limit
      const queue = needsEpisodes.map(anime => ({
        ...anime,
        nextEp: (maxEpMap.get(anime.id) || 0) + 1,
      }));

      // Process one anime at a time (catch-up loop handles multiple eps per anime)
      for (const anime of queue) {
        // Rate limit check
        if (Date.now() > this.rateLimitReset) {
          this.scrapedThisHour = 0;
          this.rateLimitReset = Date.now() + 60 * 60 * 1000;
        }
        if (this.scrapedThisHour >= this.rateLimit) {
          console.log(`⚠️  Scheduler: rate limit hit (${this.rateLimit}/hr), stopping batch`);
          results.skipped += queue.length - queue.indexOf(anime);
          break;
        }

        await this.checkAndScrape(anime, results);

        // Small delay between anime to be gentle on 9anime
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error('❌ Scheduler error:', err.message);
    }

    this.running = false;
    this.lastRun = new Date().toISOString();
    this.lastResults = results;
    const elapsed = formatDuration(Date.now() - started);
    console.log(`✅ Scheduler done in ${elapsed}: checked=${results.checked} found=${results.found} failed=${results.failed} skipped=${results.skipped}`);
    return results;
  }

  async checkAndScrape(anime, results) {
    const animeTitle = anime.title_english || anime.title;
    results.checked++;

    // Fetch episodes that already have a video_url (skip stubs from Jikan import)
    const { data: existingEps } = await supabase
      .from('episodes')
      .select('episode_number, video_url')
      .eq('anime_id', anime.id);
    const scrapedSet = new Set(
      (existingEps || []).filter(e => e.video_url).map(e => e.episode_number)
    );

    // Start from the lowest episode number that doesn't have a video URL yet
    let ep = 1;
    while (scrapedSet.has(ep)) ep++;

    if (scrapedSet.size > 0) {
      const totalStubs = (existingEps || []).length;
      console.log(`  📦 "${animeTitle}" has ${scrapedSet.size}/${totalStubs} episodes with video, starting from EP ${ep}`);
    }

    // Catch-up loop: keep scraping sequentially until one fails or we hit the rate limit
    while (true) {
      if (this.scrapedThisHour >= this.rateLimit) break;

      try {
        console.log(`  🔍 Checking "${animeTitle}" EP ${ep}…`);
        const result = await NineAnimeScraperService.scrapeAndSaveEpisode(
          animeTitle,
          anime.id,
          ep,
          { timeout: 45000, retries: 2 }
        );

        if (result.success) {
          this.scrapedThisHour++;
          results.found++;
          results.details.push({ anime: animeTitle, episode: ep, status: 'found' });
          console.log(`  ✅ Found EP ${ep} for "${animeTitle}"`);

          // Update total_episodes in anime table if we found a new high
          const newTotal = Math.max(anime.total_episodes || 0, ep);
          if (newTotal > (anime.total_episodes || 0)) {
            await supabase
              .from('anime')
              .update({ total_episodes: newTotal, updated_at: new Date().toISOString() })
              .eq('id', anime.id);
          }

          // Try next episode (catch-up), skip any already scraped
          ep++;
          while (scrapedSet.has(ep)) ep++;
          // Small delay between consecutive scrapes for the same anime
          await new Promise(r => setTimeout(r, 3000));
        } else {
          // No more episodes available — stop catch-up
          if (scrapedSet.size === 0 && ep === 1) {
            results.details.push({ anime: animeTitle, episode: ep, status: 'not_available' });
          }
          break;
        }
      } catch (err) {
        results.failed++;
        results.details.push({ anime: animeTitle, episode: ep, status: 'error', error: err.message });
        console.warn(`  ⚠️  Failed "${animeTitle}" EP ${ep}: ${err.message}`);
        break;
      }
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      lastRun: this.lastRun,
      nextRun: this.timer ? new Date(Date.now() + this.checkIntervalMs).toISOString() : null,
      checkIntervalHours: this.checkIntervalMs / 3600000,
      maxConcurrent: this.maxConcurrent,
      rateLimit: this.rateLimit,
      scrapedThisHour: this.scrapedThisHour,
      lastResults: this.lastResults,
    };
  }
}

const episodeScheduler = new EpisodeScheduler();

// ─── Scheduler API endpoints ───────────────────────────────────────────
app.get('/api/scheduler/status', (req, res) => {
  res.json({ success: true, ...episodeScheduler.getStatus() });
});

app.post('/api/scheduler/run', async (req, res) => {
  if (episodeScheduler.running) {
    return res.status(409).json({ success: false, error: 'Scheduler is already running' });
  }
  // Run in background, return immediately
  episodeScheduler.run().catch(err => console.error('Manual scheduler run error:', err));
  res.json({ success: true, message: 'Scheduler run started' });
});

app.post('/api/scheduler/toggle', (req, res) => {
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

// Error handling middleware (must be after all routes)
app.use(errorHandler);

// 404 handler (must be last)
app.use(notFoundHandler);

app.listen(PORT, () => {
  console.log(`🚀 9anime Scraper API running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🎬 Scraper endpoints:`);
  console.log(`   POST /api/scrape-episode`);
  console.log(`   POST /api/test-scraper`);
  console.log(`   POST /api/scrape-all-episodes`);
  console.log(`   POST /api/batch-scrape-episodes`);
  console.log(`   POST /api/start-large-scrape`);
  console.log(`   POST /api/scrape-chunk`);
  console.log(`   GET  /api/scraping-progress/:animeId`);
  console.log(`⏰ Scheduler endpoints:`);
  console.log(`   GET  /api/scheduler/status`);
  console.log(`   POST /api/scheduler/run`);
  console.log(`   POST /api/scheduler/toggle`);

  // Start the episode scheduler
  episodeScheduler.start();
});

export default app;
