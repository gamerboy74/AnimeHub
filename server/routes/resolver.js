import express from "express";
import { NineAnimeScraperService } from "../scrapers/nineanime.js";
import { extractHlsFromEmbed } from "../utils/universalHlsExtractor.js";

const router = express.Router();

// Resolve bysesayeveum embed URL → fresh HLS stream (called by player at playback time)
router.get("/api/resolve-stream", async (req, res) => {
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
router.get("/api/resolve-vidmoly-hls/:id", async (req, res) => {
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
// Cache for resolve-hls requests to avoid launching browser for duplicate/failed URLs
const hlsResolutionCache = new Map(); // key: url, value: { hlsUrl, error, expiresAt }
const CACHE_TTL_SUCCESS = 12 * 60 * 60 * 1000; // 12 hours
const CACHE_TTL_FAILURE = 10 * 60 * 1000;      // 10 minutes

router.get("/api/resolve-hls", async (req, res) => {
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

router.get("/api/resolve-vidmoly-stream", async (req, res) => {
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
router.get("/api/vidmoly-embed/:id", async (req, res) => {
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
router.get("/api/video-embed/:id", async (req, res) => {
  const videoId = req.params.id;
  const startTime = parseInt(req.query.start) || 0;
  const byseUrl = `https://bysesayeveum.com/e/${videoId}`;
  console.log("🎬 Serving clean embed for:", videoId, "start:", startTime);

  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("Content-Security-Policy", "default-src 'self' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.r66nv9ed.com https://*.bysevideo.net https://*; media-src * blob:; worker-src blob:; img-src *");
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
router.get("/api/resolve-mega-stream", async (req, res) => {
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
router.get("/api/mega-embed/:host/:id", async (req, res) => {
  const { host, id: videoId } = req.params;
  const startTime = parseInt(req.query.start) || 0;
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

export default router;
