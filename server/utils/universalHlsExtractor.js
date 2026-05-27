/**
 * Universal HLS Extractor
 *
 * Extracts an HLS (.m3u8) stream URL from ANY embed page without needing
 * per-host configuration. Works in 3 cascading strategies:
 *
 * 1. HTML scrape (fast, no browser) — regex for .m3u8 in page source
 * 2. AJAX probe   (no browser)      — common /getSources, /source, /api endpoints
 * 3. Playwright network intercept   (browser, slower) — catches XHR/fetch requests
 *
 * If none return a result the caller should fall back to the iframe embed.
 */

import axios from 'axios';
import { getBrowser } from '../index.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Clean common HTML escaping on a URL */
function cleanUrl(url) {
  return url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').trim();
}

/** Return true if a URL looks like a valid HLS manifest */
function isHls(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('.m3u8') || (u.includes('master') && u.includes('http'));
}

/**
 * Scan a block of text for m3u8 URLs — used across all strategies.
 * Returns the first one found, or null.
 */
function findM3u8InText(text) {
  if (!text) return null;

  const patterns = [
    // JWPlayer / VideoJS / Plyr: sources: [{ file: '...' }] or src: '...'
    /sources\s*[=:]\s*\[\s*\{[^}]*?(?:file|src|url)\s*[=:]\s*["']([^"']*\.m3u8[^"']*)/i,
    // jwplayer().setup({ sources: [{ file: '...' }] })
    /file\s*:\s*["']([^"']*\.m3u8[^"']*)/i,
    // Generic JSON string with m3u8
    /"(?:file|src|url|hls|stream)"\s*:\s*"([^"]*\.m3u8[^"]*)"/i,
    // Single-quoted
    /'(?:file|src|url|hls|stream)'\s*:\s*'([^']*\.m3u8[^']*)'/i,
    // Bare URL in quotes
    /["'](https?:\/\/[^"'\s]*\.m3u8[^"'\s]*?)["']/i,
    // Unquoted URL (last resort)
    /(https?:\/\/[^\s"'<>]*\.m3u8[^\s"'<>]*)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const url = cleanUrl(match[1]);
      if (isHls(url)) return url;
    }
  }
  return null;
}

// ─── Strategy 1: plain HTTP fetch + HTML regex ────────────────────────────────

async function strategyHtmlScrape(embedUrl) {
  try {
    const resp = await axios.get(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: embedUrl,
      },
      timeout: 12000,
      maxRedirects: 5,
    });
    const html = resp.data;
    if (typeof html !== 'string') return null;

    const found = findM3u8InText(html);
    if (found) {
      console.log('[universal] ✅ HTML scrape found HLS:', found.substring(0, 80));
      return found;
    }

    // Also try: data embedded as JSON (e.g. window.__INITIAL_STATE__)
    const jsonBlocks = html.match(/\{[^<]{50,}\}/g) || [];
    for (const block of jsonBlocks) {
      const found2 = findM3u8InText(block);
      if (found2) {
        console.log('[universal] ✅ JSON block HLS:', found2.substring(0, 80));
        return found2;
      }
    }

    return null;
  } catch (e) {
    console.log('[universal] HTML scrape failed:', e.message);
    return null;
  }
}

// ─── Strategy 2: probe common AJAX source endpoints ──────────────────────────

async function strategyAjaxProbe(embedUrl) {
  let origin, host, videoId;
  try {
    const parsed = new URL(embedUrl);
    origin = parsed.origin;
    host = parsed.hostname;

    // Extract video ID from common embed path patterns:
    // /embed-{id}.html  /embed/{id}  /e/{id}  /v/{id}  /player/{id}
    const idMatch =
      embedUrl.match(/\/embed-([a-zA-Z0-9]+)\.html/) ||
      embedUrl.match(/\/(?:embed|e|v|player)\/([a-zA-Z0-9]+)/);
    videoId = idMatch?.[1];
  } catch {
    return null;
  }

  if (!videoId) return null;

  const ajaxPaths = [
    `/ajax/embed/${videoId}/getSources`,
    `/ajax/v2/embed/${videoId}/getSources`,
    `/api/source/${videoId}`,
    `/api/v1/video/${videoId}`,
    `/api/videos/${videoId}`,
    `/player/api/${videoId}`,
  ];

  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: embedUrl,
    Origin: origin,
  };

  for (const path of ajaxPaths) {
    try {
      const resp = await axios.get(`${origin}${path}`, {
        headers,
        timeout: 8000,
      });
      const data = resp.data;
      if (!data) continue;

      // Plain sources array
      if (Array.isArray(data.sources)) {
        for (const src of data.sources) {
          const url = cleanUrl(src.file || src.url || src.src || '');
          if (isHls(url)) {
            console.log('[universal] ✅ AJAX getSources HLS:', url.substring(0, 80));
            return url;
          }
        }
      }

      // Flat URL field
      const directUrl = cleanUrl(data.url || data.src || data.file || data.hls || '');
      if (isHls(directUrl)) {
        console.log('[universal] ✅ AJAX direct URL HLS:', directUrl.substring(0, 80));
        return directUrl;
      }

      // Try scanning the whole JSON response as text
      const text = JSON.stringify(data);
      const found = findM3u8InText(text);
      if (found) {
        console.log('[universal] ✅ AJAX JSON scan HLS:', found.substring(0, 80));
        return found;
      }
    } catch (e) {
      // 403/404 are expected for wrong paths — skip silently
      if (!e.response || (e.response.status !== 403 && e.response.status !== 404)) {
        console.log(`[universal] AJAX probe ${path} error:`, e.message);
      }
    }
  }

  return null;
}

// ─── Strategy 3: Playwright network intercept ─────────────────────────────────

async function strategyPlaywright(embedUrl) {
  let context;
  try {
    console.log('[universal] 🎭 Launching Playwright for:', embedUrl);
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      bypassCSP: true,
    });

    const page = await context.newPage();

    let foundHls = null;

    // Intercept all network requests — block heavy assets, ads, trackers, and catch .m3u8 requests
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const resourceType = route.request().resourceType();
      
      // If HLS has been found, abort subsequent requests immediately
      if (foundHls) {
        return route.abort();
      }

      // Check if it is an HLS stream request
      if (isHls(url)) {
        foundHls = cleanUrl(url);
        console.log('[universal] ✅ Playwright intercepted HLS request:', foundHls.substring(0, 80));
        route.continue();
        return;
      }

      // Block images, stylesheets, fonts, and other non-HLS media files (visuals not needed for scraping)
      if (
        resourceType === 'image' || 
        resourceType === 'stylesheet' || 
        resourceType === 'font' || 
        resourceType === 'media'
      ) {
        return route.abort();
      }

      // Block known ad, tracker, and social domains/scripts to boost page speed
      const urlLower = url.toLowerCase();
      if (
        urlLower.includes('google-analytics') ||
        urlLower.includes('doubleclick') ||
        urlLower.includes('adsystem') ||
        urlLower.includes('adservice') ||
        urlLower.includes('popunder') ||
        urlLower.includes('onclickads') ||
        urlLower.includes('exoclick') ||
        urlLower.includes('juicyads') ||
        urlLower.includes('facebook') ||
        urlLower.includes('twitter')
      ) {
        return route.abort();
      }

      route.continue();
    });

    try {
      // Reduce navigation timeout from 20s to 8s
      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
    } catch (e) { 
      /* timeout is ok — we still wait below */ 
      console.log('[universal] Playwright navigation timeout/error:', e.message);
    }

    // Wait up to 5s (instead of 10s) for an HLS request to appear
    const deadline = Date.now() + 5000;
    while (!foundHls && Date.now() < deadline) {
      await page.waitForTimeout(400);

      // Check page source on each tick (some players inject URLs via JS)
      if (!foundHls) {
        try {
          const content = await page.content();
          foundHls = findM3u8InText(content) || null;
          if (foundHls) {
            console.log('[universal] ✅ Playwright page content HLS:', foundHls.substring(0, 80));
          }
        } catch { /* ignore */ }
      }
    }

    await context.close();
    return foundHls;
  } catch (e) {
    console.log('[universal] Playwright strategy failed:', e.message);
    try { await context?.close(); } catch { /* ignore */ }
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Try to extract an HLS .m3u8 URL from any embed page.
 *
 * @param {string} embedUrl  - Full URL of the embed page
 * @param {object} [opts]
 * @param {boolean} [opts.skipPlaywright=false] - Skip Playwright (faster, for cached hosts)
 * @returns {Promise<string|null>} HLS URL or null if not found
 */
export async function extractHlsFromEmbed(embedUrl, { skipPlaywright = false } = {}) {
  console.log('[universal] 🔍 Extracting HLS from:', embedUrl);

  // Strategy 1: fast HTML scrape (no browser needed)
  const htmlResult = await strategyHtmlScrape(embedUrl);
  if (htmlResult) return htmlResult;

  // Strategy 2: AJAX source endpoint probe (no browser needed)
  const ajaxResult = await strategyAjaxProbe(embedUrl);
  if (ajaxResult) return ajaxResult;

  // Strategy 3: Full Playwright with network interception (slower)
  if (!skipPlaywright) {
    const pwResult = await strategyPlaywright(embedUrl);
    if (pwResult) return pwResult;
  }

  console.log('[universal] ❌ All strategies failed for:', embedUrl);
  return null;
}
