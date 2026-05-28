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
import imageProxyRouter from "./routes/imageProxy.js";
import { extractHlsFromEmbed } from "./utils/universalHlsExtractor.js";

// Get the directory name of the current module (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (one level up from server/)
dotenv.config({ path: join(__dirname, "..", ".env") });

// Apply stealth plugin to avoid detection
chromium.use(StealthPlugin());

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in production to bypass RLS.');
  } else {
    console.warn('⚠️ WARNING: SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to VITE_SUPABASE_ANON_KEY. Row Level Security will apply and may cause database failures.');
  }
}

export const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  serviceKey || process.env.VITE_SUPABASE_ANON_KEY
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

// Image Proxy route - higher rate limit since pages load many images
app.use("/api/image-proxy", rateLimiter.middleware(60_000, 200));
app.use("/api/image-proxy", imageProxyRouter);

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
const maxConcurrency = parseInt(process.env.SCRAPER_MAX_CONCURRENCY || "5", 10);
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

export async function getBrowser() {
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

export function enqueue(task, priority = "low") {
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
      if (priority === "high") {
        console.log(`⚡ Scraper Queue: Preempting queue with HIGH priority task. Queue length: ${queue.length}`);
        queue.unshift(run);
      } else {
        queue.push(run);
      }
    }
  });
}

// Scraper service
// Scraper service
import { NineAnimeScraperService } from "./scrapers/nineanime.js";
import { ReAnimeScraperService } from "./scrapers/reanime.js";
import { SanjiAnimeScraperService } from "./scrapers/sanjianime.js";
import { AnimeSugeScraperService } from "./scrapers/animesuge.js";

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
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
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

// Resolve vidmoly video ID → HLS URL for direct frontend player (bypasses iframe, enables custom controls)
app.get("/api/resolve-vidmoly-hls/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9]+$/.test(id)) {
      return res.status(400).json({ success: false, error: "Invalid vidmoly video ID" });
    }
    const vidmolyUrl = `https://vidmoly.biz/embed-${id}.html`;
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    console.log("🔄 [resolve-vidmoly-hls] Resolving HLS for vidmoly ID:", id);
    const hlsUrl = await NineAnimeScraperService.extractVidmolyHLS(vidmolyUrl);
    if (hlsUrl) {
      console.log("✅ [resolve-vidmoly-hls] Resolved:", hlsUrl.substring(0, 80));
      return res.json({ success: true, hlsUrl });
    }
    return res.status(502).json({ success: false, error: "Could not extract HLS from vidmoly" });
  } catch (e) {
    console.error("❌ resolve-vidmoly-hls error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Universal dynamic HLS resolver ─────────────────────────────────────────
// Accepts any embed URL and returns an HLS .m3u8 stream URL.
// No per-host configuration needed — just POST/GET the embed URL.
// Strategies: HTML scrape → AJAX probe → Playwright network intercept.
//
// Cache for resolve-hls requests to avoid launching browser for duplicate/failed URLs
const hlsResolutionCache = new Map(); // key: url, value: { hlsUrl, error, expiresAt }
const CACHE_TTL_SUCCESS = 12 * 60 * 60 * 1000; // 12 hours
const CACHE_TTL_FAILURE = 10 * 60 * 1000;      // 10 minutes

app.get("/api/resolve-hls", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "Missing ?url= parameter" });

    // Basic sanity check — must be http(s)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ success: false, error: "URL must start with http(s)://" });
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

    // Check memory cache
    const cached = hlsResolutionCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.error) {
        console.log("⚡ [resolve-hls] [Cache Hit (Failure)] for:", url);
        return res.status(502).json({ success: false, error: cached.error, cached: true });
      }
      console.log("⚡ [resolve-hls] [Cache Hit (Success)] for:", url);
      return res.json({ success: true, hlsUrl: cached.hlsUrl, cached: true });
    }

    console.log("🔄 [resolve-hls] Universal resolve request for:", url);

    const hlsUrl = await extractHlsFromEmbed(url);
    if (hlsUrl) {
      hlsResolutionCache.set(url, {
        hlsUrl,
        expiresAt: Date.now() + CACHE_TTL_SUCCESS
      });
      return res.json({ success: true, hlsUrl });
    }

    hlsResolutionCache.set(url, {
      error: "Could not extract HLS from embed",
      expiresAt: Date.now() + CACHE_TTL_FAILURE
    });
    return res.status(502).json({ success: false, error: "Could not extract HLS from embed" });
  } catch (e) {
    console.error("❌ [resolve-hls] error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/api/resolve-vidmoly-stream", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.match(/vidmoly\.(biz|net)/)) {
      return res.status(400).json({ error: "Invalid vidmoly URL" });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
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
  video{position:absolute;inset:0;width:100vw;height:100vh;object-fit:cover;object-position:center;background:#000}
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
    
    let seeked = false;
    const seekToStart = () => {
      if (seeked) return;
      var st = ${startTime};
      if (st > 0 && video.readyState >= 2) {
        const duration = video.duration;
        if (duration && !isNaN(duration) && duration > 0) {
          video.currentTime = Math.min(st, duration - 1);
          seeked = true;
          console.log('✅ Bulletproof seeked to:', st, 'duration:', duration);
        } else {
          console.log('⏳ player ready but duration is not resolved yet:', duration);
        }
      }
    };
    video.addEventListener('play', seekToStart);
    video.addEventListener('playing', seekToStart);
    video.addEventListener('loadedmetadata', seekToStart);
    video.addEventListener('loadeddata', seekToStart);
    video.addEventListener('canplay', seekToStart);
    video.addEventListener('durationchange', seekToStart);
    video.addEventListener('timeupdate', seekToStart);

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { 
        loader.style.display = 'none'; 
        video.play().catch(()=>{}); 
      });
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) {
          console.error('HLS fatal error:', d);
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else { showError('Playback error: ' + d.details); hls.destroy(); }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => { 
        loader.style.display = 'none'; 
        seekToStart();
        video.play().catch(()=>{}); 
      });
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
    }, window.location.origin);
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
    }, window.location.origin);
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
  video{position:absolute;inset:0;width:100vw;height:100vh;object-fit:cover;object-position:center;background:#000}
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
    
    let seeked = false;
    const seekToStart = () => {
      if (seeked) return;
      var st = ${startTime};
      if (st > 0 && video.readyState >= 2) {
        const duration = video.duration;
        if (duration && !isNaN(duration) && duration > 0) {
          video.currentTime = Math.min(st, duration - 1);
          seeked = true;
          console.log('✅ Bulletproof seeked to:', st, 'duration:', duration);
        } else {
          console.log('⏳ player ready but duration is not resolved yet:', duration);
        }
      }
    };
    video.addEventListener('play', seekToStart);
    video.addEventListener('playing', seekToStart);
    video.addEventListener('loadedmetadata', seekToStart);
    video.addEventListener('loadeddata', seekToStart);
    video.addEventListener('canplay', seekToStart);
    video.addEventListener('durationchange', seekToStart);
    video.addEventListener('timeupdate', seekToStart);

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { 
        loader.style.display = 'none'; 
        video.play().catch(()=>{}); 
      });
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) {
          console.error('HLS fatal error:', d);
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else { showError('Playback error: ' + d.details); hls.destroy(); }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => { 
        loader.style.display = 'none'; 
        seekToStart();
        video.play().catch(()=>{}); 
      });
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
    }, window.location.origin);
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
    }, window.location.origin);
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
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src *;");
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
<iframe id="player" src="${megaUrl}?autoplay=1${startTime > 0 ? `&start=${startTime}&t=${startTime}` : ''}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"></iframe>
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
  iframe.focus();
});

iframe.addEventListener('error', () => {
  iframe.src = ${JSON.stringify(megaUrlAlt + '?autoplay=1')} + (${startTime} > 0 ? '&start=' + ${startTime} + '&t=' + ${startTime} : '');
});

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
    }, window.location.origin);
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
      }, window.location.origin);
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
        }, window.location.origin);
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

// ============================================================
// SCRAPER URL CACHE — persists resolved watch URLs per anime
// ============================================================

// GET: Read cached scraper URLs for an anime
app.get("/api/scraper-cache/:animeId", async (req, res) => {
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
app.post("/api/scraper-cache", async (req, res) => {
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
app.delete("/api/scraper-cache/:animeId", async (req, res) => {
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

// ============================================================
// Re:ANIME SCRAPER ENDPOINTS
// ============================================================

// Single episode Re:ANIME scraping endpoint
app.post("/api/scrape-reanime-episode", async (req, res) => {
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
        name: s.label || "Server",
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

        let mergedServers = [...videoServers];
        if (currentEp && Array.isArray(currentEp.video_servers)) {
          // Filter out existing servers that have the exact same URL as any of the new servers to avoid duplicates
          const otherServers = currentEp.video_servers.filter(
            existS => !videoServers.some(newS => newS.url === existS.url)
          );
          mergedServers = [...otherServers, ...videoServers];
        }

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
            video_servers: videoServers,
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
app.post("/api/scrape-sanjianime-episode", async (req, res) => {
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
        name: source.label || "Server",
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

        let mergedServers = [...videoServers];
        if (currentEp && Array.isArray(currentEp.video_servers)) {
          const otherServers = currentEp.video_servers.filter(
            (existingServer) =>
              !videoServers.some(
                (newServer) =>
                  newServer.url === existingServer.url &&
                  (newServer.name || "").toLowerCase() === (existingServer.name || "").toLowerCase() &&
                  (newServer.lang || "").toLowerCase() === (existingServer.lang || "").toLowerCase()
              )
          );
          mergedServers = [...otherServers, ...videoServers];
        }

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
            video_servers: videoServers,
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
app.post("/api/scrape-animesuge-episode", async (req, res) => {
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
        name: source.label || "Server",
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

        let mergedServers = [...videoServers];
        if (currentEp && Array.isArray(currentEp.video_servers)) {
          const otherServers = currentEp.video_servers.filter(
            (existingServer) =>
              !videoServers.some(
                (newServer) =>
                  newServer.url === existingServer.url &&
                  (newServer.name || "").toLowerCase() === (existingServer.name || "").toLowerCase() &&
                  (newServer.lang || "").toLowerCase() === (existingServer.lang || "").toLowerCase()
              )
          );
          mergedServers = [...otherServers, ...videoServers];
        }

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
            video_servers: videoServers,
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
app.post("/api/batch-scrape-animesuge-episodes-stream", async (req, res) => {
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
          s.url
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
          // Save to database
          const { data: existingEpisode } = await supabase
            .from("episodes")
            .select("id, title")
            .eq("anime_id", animeId)
            .eq("episode_number", episodeNumber)
            .maybeSingle();

          const videoServers = (scrapeResult.episodeData?.sources || []).map(s => ({
            name: s.label || "Server",
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

            let mergedServers = [...videoServers];
            if (currentEp && Array.isArray(currentEp.video_servers)) {
              const otherServers = currentEp.video_servers.filter(
                existS => !videoServers.some(
                  newS =>
                    newS.url === existS.url &&
                    (newS.name || "").toLowerCase() === (existS.name || "").toLowerCase() &&
                    (newS.lang || "").toLowerCase() === (existS.lang || "").toLowerCase()
                )
              );
              mergedServers = [...otherServers, ...videoServers];
            }

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
                video_servers: videoServers,
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

        if (consecutiveFailures >= 3) {
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              status: "Consecutive failures threshold met. Aborting.",
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
app.post("/api/batch-scrape-reanime-episodes-stream", async (req, res) => {
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

    // Pre-check: skip episodes that already have ALL 4 Re:ANIME server slots present
    // Required: sub HD-1, sub HD-2, dub HD-1, dub HD-2
    // If any of those 4 are missing the episode will be re-scraped (even if it has a NineAnime URL).
    const REQUIRED_REANIME_SERVERS = [
      { lang: "sub", name: "HD-1" },
      { lang: "sub", name: "HD-2" },
      { lang: "dub", name: "HD-1" },
      { lang: "dub", name: "HD-2" },
    ];

    /**
     * Returns true only when video_servers contains every required Re:ANIME slot.
     * Name matching is case-insensitive.
     */
    function hasAllReAnimeServers(videoServers) {
      if (!Array.isArray(videoServers) || videoServers.length === 0) return false;
      return REQUIRED_REANIME_SERVERS.every(({ lang, name }) =>
        videoServers.some(
          (s) =>
            (s.lang || "").toLowerCase() === lang &&
            (s.name || "").toLowerCase() === name.toLowerCase() &&
            s.url
        )
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
              .filter((e) => hasAllReAnimeServers(e.video_servers))
              .map((e) => e.episode_number)
          );
          epsToScrape = episodeNumbers.filter((n) => !fullyScraped.has(n));
          skippedCount = fullyScraped.size;
          if (skippedCount > 0) {
            console.log(
              `⏭️ Skipping ${skippedCount} episodes that already have all 4 Re:ANIME servers (sub HD-1/HD-2 + dub HD-1/HD-2)`
            );
          }
          const partial = existing.length - skippedCount;
          if (partial > 0) {
            console.log(
              `🔁 ${partial} episodes have partial servers — will re-scrape to fill missing slots`
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
    // We use the same cache key as the single-scrape endpoint ("reanime_watch") so both
    // endpoints share the same cached base URL and never duplicate Playwright searches.
    const cacheKey = "reanime_watch";
    let baseWatchUrl = null;
    let browser = null;

    // 1. Try reading from DB cache
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
            // Strip only the episode param — keep everything else (e.g. lang) intact
            const urlObj = new URL(resolved);
            urlObj.searchParams.delete("ep");
            urlObj.searchParams.delete("lang");
            baseWatchUrl = urlObj.toString();
            console.log(`✅ Re:ANIME resolved (fresh): ${baseWatchUrl}`);

            // Save to DB cache for next time (shared with single-scrape endpoint)
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

        // If we resolved the base URL, use it, otherwise pass the animeTitle (which triggers search fallback)
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
          // Save to database
          const { data: existingEpisode } = await supabase
            .from("episodes")
            .select("id, title")
            .eq("anime_id", animeId)
            .eq("episode_number", episodeNumber)
            .maybeSingle();

          // Standardize alternative video servers for DB storage
          const scrapeLang = options.lang || "sub";
          const videoServers = (scrapeResult.episodeData?.sources || []).map(s => ({
            name: s.label || "Server",
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

            let mergedServers = [...videoServers];
            if (currentEp && Array.isArray(currentEp.video_servers)) {
              // Filter out existing servers that have the exact same URL as any of the new servers to avoid duplicates
              const otherServers = currentEp.video_servers.filter(
                existS => !videoServers.some(newS => newS.url === existS.url)
              );
              mergedServers = [...otherServers, ...videoServers];
            }

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
                video_servers: videoServers,
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

        if (consecutiveFailures >= 3) {
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              status: "Consecutive failures threshold met. Aborting.",
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
app.post("/api/batch-scrape-sanjianime-episodes-stream", async (req, res) => {
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
    const reqLang = options.lang || "dub"; // Default to dub for Sanji Anime, or match requested

    // Helper: Returns true if video_servers contains a server from Sanji Anime for the selected lang
    function hasSanjiServers(videoServers, lang) {
      if (!Array.isArray(videoServers) || videoServers.length === 0) return false;
      return videoServers.some(
        (s) =>
          (s.lang || "").toLowerCase() === lang.toLowerCase() &&
          ((s.name || "").toLowerCase().includes("sanji") ||
           (s.name || "").toLowerCase().includes("server") ||
           (s.url || "").includes("sanjianime.com"))
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

    // 1. Try reading from DB cache
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
            // Strip episode part if it has "episode-"
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
          // Save to database
          const { data: existingEpisode } = await supabase
            .from("episodes")
            .select("id, title")
            .eq("anime_id", animeId)
            .eq("episode_number", episodeNumber)
            .maybeSingle();

          const scrapeLang = reqLang;
          const videoServers = (scrapeResult.episodeData?.sources || []).map((source) => ({
            name: source.label || "Server",
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

            let mergedServers = [...videoServers];
            if (currentEp && Array.isArray(currentEp.video_servers)) {
              const otherServers = currentEp.video_servers.filter(
                (existingServer) =>
                  !videoServers.some(
                    (newServer) =>
                      newServer.url === existingServer.url &&
                      (newServer.name || "").toLowerCase() === (existingServer.name || "").toLowerCase() &&
                      (newServer.lang || "").toLowerCase() === (existingServer.lang || "").toLowerCase()
                  )
              );
              mergedServers = [...otherServers, ...videoServers];
            }

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
                video_servers: videoServers,
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

        if (consecutiveFailures >= 3) {
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              status: "Consecutive failures threshold met. Aborting.",
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
        } else if (scrapeResult.success && scrapeResult.skipped) {
          // Gracefully skip - do not increment consecutive failures or abort
          results.push({
            episode: episodeNumber,
            status: "skipped",
            error: scrapeResult.error || "Anime/Season not found",
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
          // Gracefully skip - send error details but do NOT increment consecutiveFailures or errorCount
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              episode: episodeNumber,
              current: skippedCount + i + 1,
              total: episodeNumbers.length,
              error: `Skipped: ${scrapeResult.error || "Anime/Season not found"}`,
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
app.get("/api/anime/featured", cacheMiddleware(120_000), async (req, res) => {
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
app.get("/api/anime/trending", cacheMiddleware(120_000), async (req, res) => {
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
app.get("/api/anime/popular", cacheMiddleware(120_000), async (req, res) => {
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
app.get("/api/anime/recent", cacheMiddleware(60_000), async (req, res) => {
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
  cacheMiddleware(5_000),
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

    const { data: existingEpisode, error: checkError } = await supabase
      .from("episodes")
      .select("id, title")
      .eq("anime_id", animeId)
      .eq("episode_number", episodeData.number)
      .maybeSingle();

    let data, error;

    // Standardize video servers and map languages properly
    const scrapeLang = episodeData.lang || (episodeData.streamUrl && episodeData.streamUrl.toLowerCase().includes('dub') ? 'dub' : 'sub');
    const newServers = (episodeData.servers || (episodeData.streamUrl ? [{ name: "Server 1", url: episodeData.streamUrl }] : [])).map(s => ({
      name: s.name || s.label || "Server",
      url: s.url || s.iframeUrl,
      lang: s.lang || scrapeLang
    }));

    if (existingEpisode && !checkError) {
      // Episode exists, update it
      console.log(
        `📝 Updating existing episode ${episodeData.number} for anime ${animeId}`
      );

      // Preserve existing beautiful title if it exists and is not generic "Episode X"
      const hasBeautifulTitle = existingEpisode.title && 
                                !existingEpisode.title.toLowerCase().startsWith("episode") &&
                                existingEpisode.title.trim() !== String(episodeData.number);

      const titleToUpdate = hasBeautifulTitle ? existingEpisode.title : episodeData.title;

      // Merge with existing servers of other languages to prevent overwriting them
      const { data: currentEp } = await supabase
        .from("episodes")
        .select("video_servers")
        .eq("id", existingEpisode.id)
        .single();

      let mergedServers = [...newServers];
      if (currentEp && Array.isArray(currentEp.video_servers)) {
        // Filter out existing servers that have the exact same URL as any of the new servers to avoid duplicates
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
          video_servers: newServers,
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

// Update anime request status
app.put("/api/admin/anime-requests/:id", async (req, res) => {
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

    // Fallback: let the browser load the original image directly if proxying fails.
    // This avoids broken posters/avatars when the proxy or upstream host is slow/down.
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

// Stream proxy endpoint for HLS manifests and segments.
// Mirrors the Vercel edge function so local dev can load proxied m3u8 URLs.
app.get("/api/stream-proxy", async (req, res) => {
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
