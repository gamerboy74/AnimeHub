import { getBrowser } from "../services/queue.js";
import { supabase } from "../config/supabase.js";
import { extractSeasonNumber } from "../utils/seasonExtractor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'");
}

export function getCoreTitle(title) {
  if (!title) return "";
  return decodeHtmlEntities(title)
    .toLowerCase()
    .replace(/(?:season\s*\d+|s\d+|\d+(?:nd|rd|th|st)?\s*season)/gi, "")
    .replace(/\b(?:movie|film|ova|ona|special|part)\b\s*\d*/gi, "")
    .replace(/\b(?:i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*$/i, "")
    .replace(/\b\d+\b\s*$/gi, "")
    .replace(/\b(?:dub|sub|uncensored|uncut|tv|dual[- ]audio)\b/g, " ")
    .replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]/g, "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// CinevoScraperService
//
// Cinevo (https://cinevo.site) URL structure (confirmed via live testing):
//   Search   : /search?q=TITLE
//   TV show  : /tv/SLUG-TMDB_ID
//   Movie    : /movie/SLUG-TMDB_ID
//   Watch TV : /watch/tv/SLUG-TMDB_ID?ep=N[&season=S]
//   Watch MV : /watch/movie/SLUG-TMDB_ID
//
// Player structure (confirmed):
//   • 2 top-level Radix tabs: "⚡ Cinevo Flash" | "Standard Servers"
//   • Standard Servers tab contains ONE iframe (vidcore.net) and a
//     Radix <Select> combobox with 12 servers:
//       VidCore, Scapa (Hindi), Videasy, 4K, VidNest, VidStorm,
//       Scapa (Multi), French, Italian, VidFast Pro, AutoEmbed Pro, 2Embed CC
//   • Selecting each [role="option"] inside the open combobox swaps the iframe.
//   • Cinevo Flash tab renders a separate embedded player (empty in headless).
//
// Server scraping strategy:
//   1. Capture initial active iframe (VidCore).
//   2. Open combobox via JS dispatchEvent click.
//   3. Enumerate all [role="option"] items.
//   4. Click each unchecked option — capture the new iframe src.
//   5. Also attempt the Cinevo Flash tab.
// ─────────────────────────────────────────────────────────────────────────────

export class CinevoScraperService {
  static BASE_URL = "https://cinevo.site";
  static USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // ── URL helpers ─────────────────────────────────────────────────────────

  static normalizeUrl(u) {
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    return `${this.BASE_URL}${u.startsWith("/") ? "" : "/"}${u}`;
  }

  /**
   * Infer sub/dub/language from a server label.
   * "Hindi", "French", "Italian" → labelled as dub-language variant.
   * "Multi" → "sub" (multilingual subtitles).
   * Default → "sub".
   */
  static inferLangFromLabel(label, fallback = "sub") {
    const n = (label || "").toLowerCase();
    if (n.includes("dub")) return "dub";
    // Language-named servers are dubbed variants
    if (n.includes("hindi") || n.includes("french") || n.includes("italian") ||
        n.includes("spanish") || n.includes("german") || n.includes("portuguese")) return "dub";
    if (n.includes("sub") || n.includes("multi")) return "sub";
    return fallback;
  }

  static shouldKeepServer(label) {
    const n = (label || "").toLowerCase();
    // Keep Hindi
    if (n.includes("hindi")) return true;
    // Skip other non-English languages (Italian, French, Spanish, German, Portuguese)
    const ignored = ["french", "italian", "spanish", "german", "portuguese"];
    if (ignored.some((lang) => n.includes(lang))) return false;
    return true;
  }

  // ── Slug-based search matching ─────────────────────────────────────────

  static slugScore(slug, variant) {
    // e.g. "attack-on-titan-1429" → strip trailing ID → "attack-on-titan" → "attackontitan"
    const slugCore = slug.replace(/-\d+\/?$/, "").replace(/-/g, "").toLowerCase();
    const varCore = getCoreTitle(variant);
    if (!slugCore || !varCore) return 0;
    if (slugCore === varCore) return 1.0;
    if (slugCore.includes(varCore) || varCore.includes(slugCore)) {
      return Math.min(slugCore.length, varCore.length) / Math.max(slugCore.length, varCore.length);
    }
    return 0;
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * Search Cinevo for a title.
   * Returns the best /watch/tv/... or /watch/movie/... URL directly —
   * which saves a detail-page navigation step.
   *
   * Matching uses slug-text (URL slug words) rather than card text nodes
   * because Cinevo renders release year ("2002") as the visible card label,
   * NOT the anime title.
   */
  static async searchAnimeUrl(page, title, options = {}) {
    const dbAnimeId = options.dbAnimeId;

    // Build title variants for multi-keyword matching
    const titleVariants = new Set([title]);
    if (dbAnimeId) {
      try {
        const { data } = await supabase
          .from("anime")
          .select("title, title_romaji, title_english, title_synonyms")
          .eq("id", dbAnimeId)
          .maybeSingle();
        if (data) {
          [data.title, data.title_romaji, data.title_english].forEach((t) => {
            if (t) titleVariants.add(t);
          });
          if (Array.isArray(data.title_synonyms)) {
            data.title_synonyms.forEach((s) => {
              if (s && /^[a-zA-Z0-9\s\-':!,.&]+$/.test(s)) titleVariants.add(s);
            });
          }
        }
      } catch (e) {
        console.warn("⚠️ [Cinevo] DB variant fetch failed:", e.message);
      }
    }

    for (const keyword of titleVariants) {
      try {
        const searchUrl = `${this.BASE_URL}/search?q=${encodeURIComponent(keyword)}`;
        console.log(`🔍 [Cinevo] Searching: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 40000 });
        await page.waitForTimeout(3500);

        try {
          await page.waitForSelector('a[href*="/tv/"], a[href*="/movie/"], a[href*="/watch/"]', {
            timeout: 8000,
          });
        } catch (_) {}

        const links = await page.evaluate(() => {
          const seen = new Set();
          const results = [];
          document.querySelectorAll("a[href]").forEach((a) => {
            const href = a.getAttribute("href") || "";
            if (seen.has(href)) return;
            if (!href.includes("/tv/") && !href.includes("/movie/") && !href.includes("/watch/")) return;
            if (href.includes("/discover") || href.includes("/search") || href === "/" || href === "#") return;
            seen.add(href);
            results.push(href);
          });
          return results;
        });

        console.log(`📋 [Cinevo] ${links.length} content links for "${keyword}"`);
        if (links.length === 0) continue;

        let bestHref = null;
        let bestScore = 0;

        for (const href of links) {
          const slugMatch = href.match(/\/(?:watch\/)?(?:tv|movie)\/([^/?#]+)/i);
          if (!slugMatch) continue;
          const score = this.slugScore(slugMatch[1], keyword);
          if (score > bestScore) { bestScore = score; bestHref = href; }
        }

        if (bestScore >= 0.4 && bestHref) {
          // Prefer the /watch/... variant if also available
          const slugPart = bestHref.match(/\/(?:tv|movie)\/([^/?#]+)/i)?.[1];
          const watchVariant = slugPart
            ? links.find((h) => h.includes("/watch/") && h.includes(slugPart))
            : null;

          const chosen = watchVariant || bestHref;
          const resolved = chosen.startsWith("http") ? chosen : `${this.BASE_URL}${chosen}`;
          console.log(`✅ [Cinevo] Match (score ${bestScore.toFixed(2)}): ${resolved}`);
          return resolved;
        }

        console.warn(`⚠️ [Cinevo] Low confidence for "${keyword}" (best: ${bestScore.toFixed(2)})`);
      } catch (err) {
        console.warn(`⚠️ [Cinevo] Search "${keyword}" failed:`, err.message);
      }
    }

    throw new Error(`[Cinevo] Could not find "${title}" in Cinevo's library.`);
  }

  // ── Resolve watch URL ────────────────────────────────────────────────────

  /**
   * Convert a title string or detail URL into the final /watch/... URL.
   */
  static async resolveWatchUrlWithPage(page, inputUrl, episodeNumber = 1, options = {}) {
    if (!inputUrl) throw new Error("[Cinevo] inputUrl required");

    const isUrl = /^https?:\/\//i.test(inputUrl) || inputUrl.includes("cinevo.site");
    let candidateUrl = isUrl
      ? this.normalizeUrl(inputUrl)
      : await this.searchAnimeUrl(page, inputUrl, options);

    // Already a /watch/ URL → add ep param and return
    if (candidateUrl.includes("/watch/")) {
      const u = new URL(candidateUrl);
      u.searchParams.set("ep", String(episodeNumber));
      if (options.season) u.searchParams.set("season", String(options.season));
      return u.toString();
    }

    // Detail URL → convert to watch URL
    const m = candidateUrl.match(/\/(tv|movie)\/([^/?#]+)/i);
    if (m) {
      const watchUrl = new URL(`${this.BASE_URL}/watch/${m[1]}/${m[2]}`);
      if (m[1] === "tv") {
        watchUrl.searchParams.set("ep", String(episodeNumber));
        if (options.season) watchUrl.searchParams.set("season", String(options.season));
      }
      return watchUrl.toString();
    }

    throw new Error(`[Cinevo] Cannot resolve watch URL from: ${candidateUrl}`);
  }

  // ── Collect ALL server sources from the watch page ───────────────────────

  /**
   * Exhaustively scrapes every server Cinevo exposes:
   *
   * Standard Servers tab (12 servers in combobox dropdown):
   *   VidCore, Scapa (Hindi), Videasy, 4K, VidNest, VidStorm,
   *   Scapa (Multi), French, Italian, VidFast Pro, AutoEmbed Pro, 2Embed CC
   *
   * ⚡ Cinevo Flash tab:
   *   Their own CDN embed — captured if it loads a different iframe.
   *
   * Strategy:
   *   1. Grab the initial active iframe (VidCore).
   *   2. Open the Radix Select combobox via JS dispatchEvent.
   *   3. Enumerate all [role="option"] items in the open dropdown.
   *   4. Click each unchecked option → wait → capture new iframe.
   *   5. Switch to Cinevo Flash tab → capture if different.
   */
  static async collectServerSources(page, requestedLang = "sub") {
    const sources = [];
    const seenUrls = new Set();

    const isValidEmbed = (url) => {
      if (!url || url.trim() === "") return false;
      const u = url.toLowerCase();
      return !u.includes("about:blank") && !u.includes("disqus") &&
             !u.includes("google.com") && !u.includes("doubleclick") && u.startsWith("http");
    };

    // Helper: get the currently active player iframe src
    const getIframeSrc = async () => {
      // Look for the titled player iframe specifically
      const titled = await page.evaluate(() => {
        const iframes = [...document.querySelectorAll("iframe")];
        // Prefer iframes with a title (the player) over blank ones (ads)
        const titled = iframes.find((f) => f.title && f.src && f.src.startsWith("http"));
        const anySrc = iframes.find((f) => f.src && f.src.startsWith("http"));
        return (titled || anySrc)?.src || null;
      });
      return titled;
    };

    // Helper: add a source if not already seen
    const addSource = (label, iframeUrl, lang) => {
      if (!iframeUrl || !isValidEmbed(iframeUrl) || seenUrls.has(iframeUrl)) return false;
      seenUrls.add(iframeUrl);
      sources.push({ label, iframeUrl, lang, playableUrl: iframeUrl });
      console.log(`  ✨ [Cinevo] "${label}" [${lang}]: ${iframeUrl}`);
      return true;
    };

    // ── Wait for page to hydrate ────────────────────────────────────────
    try {
      await page.waitForSelector('button[role="combobox"]', { timeout: 15000 });
      await page.waitForTimeout(2000);
    } catch (e) {
      console.warn("  ⚠️ [Cinevo] Timeout waiting for combobox button:", e.message);
    }

    // ── Step 1: Capture the initial active server (VidCore by default) ──
    const initial = await getIframeSrc();
    addSource("VidCore (active)", initial, requestedLang);

    // ── Step 2: Open the server combobox via JS dispatchEvent ───────────
    console.log("  🎛️  [Cinevo] Opening server combobox...");
    const comboboxOpened = await page.evaluate(() => {
      const btn = document.querySelector('button[role="combobox"]');
      if (!btn) return false;
      btn.focus();
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
      btn.dispatchEvent(new MouseEvent("mousedown",     { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent("click",         { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, pointerId: 1 }));
      btn.dispatchEvent(new MouseEvent("mouseup",       { bubbles: true, cancelable: true }));
      return true;
    });

    if (!comboboxOpened) {
      console.warn("  ⚠️ [Cinevo] Combobox button not found — skipping server enumeration");
    } else {
      await page.waitForTimeout(1000);

      // ── Step 3: Read all dropdown options with a retry ──────────────────
      let options = await page.evaluate(() => {
        return [...document.querySelectorAll('[role="option"]')]
          .map((el, idx) => ({
            idx,
            label: el.textContent?.trim().replace(/\s+/g, " ") || `Server ${idx}`,
            checked: el.getAttribute("data-state") === "checked",
          }));
      });

      if (options.length === 0) {
        console.log("  ⚠️ [Cinevo] 0 options found synchronously — waiting 2s and retrying...");
        await page.waitForTimeout(2000);
        options = await page.evaluate(() => {
          return [...document.querySelectorAll('[role="option"]')].map((el, idx) => ({
            idx,
            label: el.textContent?.trim().replace(/\s+/g, " ") || `Server ${idx}`,
            checked: el.getAttribute("data-state") === "checked",
          }));
        });
      }

      console.log(`  🎛️  [Cinevo] ${options.length} server options found: ${options.map((o) => `"${o.label}"`).join(", ")}`);

      // ── Step 4: Click each unchecked option and capture iframe ────────
      for (const opt of options) {
        if (opt.checked) {
          console.log(`  ⏭️  [Cinevo] Skipping already-selected: "${opt.label}"`);
          continue;
        }

        if (!this.shouldKeepServer(opt.label)) {
          console.log(`  ⏭️  [Cinevo] Skipping ignored language server: "${opt.label}"`);
          continue;
        }

        const lang = this.inferLangFromLabel(opt.label, requestedLang);
        console.log(`  👉 [Cinevo] Selecting server: "${opt.label}" [${lang}]`);

        // Re-open the combobox before each click (it closes after selection)
        const reopened = await page.evaluate(() => {
          const btn = document.querySelector('button[role="combobox"]');
          if (!btn) return false;
          if (btn.getAttribute("aria-expanded") === "true") return true;
          btn.focus();
          btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
          btn.dispatchEvent(new MouseEvent("mousedown",     { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent("click",         { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, pointerId: 1 }));
          return true;
        });

        if (!reopened) {
          console.warn(`  ⚠️ [Cinevo] Could not reopen combobox`);
          continue;
        }
        await page.waitForTimeout(1000);

        // Click the specific option by its index
        const clicked = await page.evaluate((optIdx) => {
          const opts = [...document.querySelectorAll('[role="option"]')];
          const target = opts[optIdx];
          if (!target) return false;
          target.focus();
          target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
          target.dispatchEvent(new MouseEvent("mousedown",     { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent("click",         { bubbles: true, cancelable: true }));
          target.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, pointerId: 1 }));
          target.dispatchEvent(new MouseEvent("mouseup",       { bubbles: true, cancelable: true }));
          return true;
        }, opt.idx);

        if (!clicked) {
          console.warn(`  ⚠️ [Cinevo] Option "${opt.label}" not clickable`);
          continue;
        }

        // Wait for the iframe to swap
        await page.waitForTimeout(3000);

        const iframeSrc = await getIframeSrc();
        addSource(opt.label, iframeSrc, lang);
      }
    }

    // ── Step 5: Try ⚡ Cinevo Flash tab ──────────────────────────────────
    console.log("  ⚡ [Cinevo] Trying Cinevo Flash tab...");
    await page.evaluate(() => {
      const flashBtn = document.querySelector(
        '[id*="trigger-cinevo"], button[aria-controls*="content-cinevo"]'
      );
      if (flashBtn) {
        flashBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        flashBtn.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
      }
    });
    await page.waitForTimeout(3000);

    const flashIframe = await getIframeSrc();
    if (flashIframe && flashIframe !== initial) {
      addSource("Cinevo Flash", flashIframe, requestedLang);
    } else {
      console.log("  ⏭️  [Cinevo] Flash tab returned same/no iframe");
    }

    // ── Return ──────────────────────────────────────────────────────────
    const primary = sources[0] || null;
    return {
      sources,
      streamUrl: primary?.iframeUrl || null,
    };
  }

  // ── Main entry point ─────────────────────────────────────────────────────

  /**
   * Scrape a TV episode (or movie) from Cinevo — returns all available servers.
   *
   * @param {string} inputUrl      Cinevo URL or raw title string
   * @param {number} episodeNumber 1-based episode number (TV only)
   * @param {object} options       { timeout, retries, lang, season, dbAnimeId }
   */
  static async scrapeAnimeEpisode(inputUrl, episodeNumber = 1, options = {}) {
    const { timeout = 40000, retries = 2 } = options;
    const requestedLang = options.lang === "dub" ? "dub" : "sub";

    console.log(`🎬 [Cinevo] scrape: "${inputUrl}" ep ${episodeNumber} [${requestedLang}]`);

    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      let context = null;
      try {
        const browser = await getBrowser();
        if (!browser) throw new Error("[Cinevo] Failed to get browser");

        context = await browser.newContext({
          userAgent: this.USER_AGENT,
          viewport: { width: 1280, height: 900 },
          bypassCSP: true,
          javaScriptEnabled: true,
          extraHTTPHeaders: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            DNT: "1",
            Connection: "keep-alive",
            "Upgrade-Insecure-Requests": "1",
          },
        });

        const page = await context.newPage();
        await page.addInitScript(() => { try { window.open = () => null; } catch (_) {} });

        // Prevent frame-busting top-level redirects from external video embeds/ads
        await page.route("**/*", (route) => {
          const req = route.request();
          if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
            const url = req.url();
            if (url.includes("cinevo.site") || url.startsWith("about:") || url.startsWith("data:")) {
              route.continue();
            } else {
              console.log(`  🚫 [Cinevo] Aborted top-level frame-busting redirect to: ${url}`);
              route.abort();
            }
          } else {
            route.continue();
          }
        });

        // Resolve the watch URL
        const watchUrl = await this.resolveWatchUrlWithPage(
          page, inputUrl, episodeNumber, options
        );
        console.log(`🔗 [Cinevo] Watch URL: ${watchUrl}`);

        // Navigate
        await page.goto(watchUrl, { waitUntil: "domcontentloaded", timeout });
        await page.waitForTimeout(4000);

        // Basic sanity checks
        const finalUrl = page.url();
        if (finalUrl === `${this.BASE_URL}/` || finalUrl === this.BASE_URL) {
          throw new Error(`[Cinevo] Redirected to homepage — ep ${episodeNumber} unavailable`);
        }

        const pageTitle  = await page.title().catch(() => "");
        const bodyText   = await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "");
        if (pageTitle.toLowerCase().includes("not found") || bodyText.toLowerCase().includes("page not found")) {
          throw new Error(`[Cinevo] 404 on watch page: ${watchUrl}`);
        }

        // Collect all servers
        const { sources, streamUrl } = await this.collectServerSources(page, requestedLang);

        await context.close();

        if (!streamUrl || sources.length === 0) {
          throw new Error("[Cinevo] No video sources found for this episode");
        }

        console.log(`✅ [Cinevo] ${sources.length} server(s) scraped for ep ${episodeNumber}`);
        return {
          success: true,
          watchUrl,
          streamUrl,
          episodeData: {
            inputUrl,
            watchUrl,
            sources,
            sourceCount: sources.length,
            episodeNumber,
            lang: requestedLang,
          },
        };
      } catch (error) {
        lastError = error;
        console.error(`❌ [Cinevo] Attempt ${attempt}/${retries}: ${error.message}`);
        if (context) await context.close().catch(() => {});
        if (attempt < retries) {
          console.log(`⏳ [Cinevo] Retrying in 3s...`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    return { success: false, error: lastError?.message || "Unknown error" };
  }
}

export default CinevoScraperService;
