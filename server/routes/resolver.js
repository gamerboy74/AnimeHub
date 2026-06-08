import express from "express";
import { NineAnimeScraperService } from "../scrapers/nineanime.js";
import { extractHlsFromEmbed } from "../utils/universalHlsExtractor.js";
import { buildVidmolyEmbedHtml } from "../templates/vidmoly-embed.js";
import { buildByseEmbedHtml } from "../templates/byse-embed.js";
import { buildMegaEmbedHtml } from "../templates/mega-embed.js";

const router = express.Router();

// Resolve bysesayeveum embed URL → fresh HLS stream
router.get("/resolve-stream", async (req, res) => {
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

// Resolve vidmoly video ID → HLS URL for direct frontend player
router.get("/resolve-vidmoly-hls/:id", async (req, res) => {
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
// Capped in-memory LRU Cache to avoid memory leaks. Max capacity is 500 entries.
class SimpleLRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (item) {
      // Refresh key position to mark as recently used
      this.cache.delete(key);
      this.cache.set(key, item);
      return item;
    }
    return null;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first key in insertion order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }
}

const hlsResolutionCache = new SimpleLRUCache(500); // Capped at 500 entries
const CACHE_TTL_SUCCESS = 12 * 60 * 60 * 1000; // 12 hours
const CACHE_TTL_FAILURE = 10 * 60 * 1000;      // 10 minutes

router.get("/resolve-hls", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "Missing ?url= parameter" });

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ success: false, error: "URL must start with http(s)://" });
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

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
      hlsResolutionCache.set(url, { hlsUrl, expiresAt: Date.now() + CACHE_TTL_SUCCESS });
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

router.get("/resolve-vidmoly-stream", async (req, res) => {
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

// Clean ad-free vidmoly embed page — resolves HLS and plays via hls.js (no ads)
router.get("/vidmoly-embed/:id", async (req, res) => {
  const videoId = req.params.id;
  const startTime = parseInt(req.query.start) || 0;
  const vidmolyUrl = `https://vidmoly.biz/embed-${videoId}.html`;
  console.log("🎬 Serving clean vidmoly embed for:", videoId, "start:", startTime);

  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("Content-Security-Policy", "default-src 'self' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.vmwesa.online https://*; media-src * blob:; worker-src blob:; img-src *");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.setHeader("Content-Type", "text/html");
  res.send(buildVidmolyEmbedHtml(videoId, startTime, vidmolyUrl));
});

// Clean ad-free bysesayeveum embed page — resolves HLS and plays via hls.js
router.get("/video-embed/:id", async (req, res) => {
  const videoId = req.params.id;
  const startTime = parseInt(req.query.start) || 0;
  const byseUrl = `https://bysesayeveum.com/e/${videoId}`;
  console.log("🎬 Serving clean embed for:", videoId, "start:", startTime);

  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("Content-Security-Policy", "default-src 'self' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.r66nv9ed.com https://*.bysevideo.net https://*; media-src * blob:; worker-src blob:; img-src *");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.setHeader("Content-Type", "text/html");
  res.send(buildByseEmbedHtml(videoId, startTime, byseUrl));
});

// Resolve mega embed URL → fresh HLS stream
router.get("/resolve-mega-stream", async (req, res) => {
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

// Clean ad-free mega video embed page — wraps original mega player with progress tracking
router.get("/mega-embed/:host/:id", async (req, res) => {
  const { host, id: videoId } = req.params;
  const startTime = parseInt(req.query.start) || 0;
  console.log("🎬 Serving clean mega embed for host:", host, "id:", videoId, "start:", startTime);

  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src *;");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.setHeader("Content-Type", "text/html");
  res.send(buildMegaEmbedHtml(host, videoId, startTime));
});

export default router;
