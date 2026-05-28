import { getBrowser, supabase } from "../index.js";
import { extractSeasonNumber } from "../utils/seasonExtractor.js";

export class AnimeSugeScraperService {
  static BASE_URL = "https://animesuge.cz";
  static USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  static normalizeUrl(inputUrl) {
    if (!inputUrl) return "";
    if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
    return `${this.BASE_URL}${inputUrl.startsWith("/") ? "" : "/"}${inputUrl}`;
  }


  /**
   * Search AnimeSuge for the given title and return the anime detail page URL.
   * AnimeSuge search results have EMPTY text on <a> poster links —
   * the title lives in the parent .item div's innerText (last non-numeric line).
   */
  static async searchAnimeUrl(page, title) {
    const searchUrl = `${this.BASE_URL}/filter?keyword=${encodeURIComponent(title)}`;
    console.log(`🔍 AnimeSuge search: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 40000 });
    await page.waitForTimeout(2000);

    // Wait for result cards to appear
    try {
      await page.waitForSelector(".item", { timeout: 6000 });
    } catch (_) {
      console.warn("⚠️ No .item cards appeared — results may be empty");
    }

    // Extract links + titles from .item containers.
    // Each .item's innerText looks like: "TV\n12\n12\n12\nAnime Title Here"
    // The title is the last non-numeric non-empty line.
    const animeLinks = await page.evaluate(() => {
      const seen = new Set();
      const results = [];

      document.querySelectorAll(".item").forEach((item) => {
        const link = item.querySelector('a[href*="/anime/"]');
        if (!link || !link.href || seen.has(link.href)) return;
        if (link.href.includes("/filter") || link.href.includes("/genre")) return;
        seen.add(link.href);

        // Extract title: split on newlines, discard empty lines, type labels, and pure numbers
        const lines = (item.innerText || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(
            (l) =>
              l.length > 0 &&
              !/^\d+$/.test(l) &&
              !["TV", "MOVIE", "ONA", "OVA", "SPECIAL", "MUSIC"].includes(l.toUpperCase())
          );

        const titleText = lines[lines.length - 1] || "";
        results.push({ href: link.href, text: titleText });
      });

      return results;
    });

    console.log(`📋 AnimeSuge found ${animeLinks.length} results`);
    animeLinks.slice(0, 5).forEach((l, i) =>
      console.log(`   [${i + 1}] "${l.text}" → ${l.href}`)
    );

    if (animeLinks.length === 0) {
      throw new Error(
        `No results found on AnimeSuge for "${title}". Try pasting a direct AnimeSuge URL instead.`
      );
    }

    const targetSeason = extractSeasonNumber(title);
    const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const targetClean = cleanStr(title);

    let exactMatch = null;
    const partialMatches = [];

    for (const link of animeLinks) {
      const resultSeason = extractSeasonNumber(link.text);
      if (targetSeason !== resultSeason) {
        console.log(`   ⏭️ Skipping result "${link.text}" (Season ${resultSeason}) - mismatch with target (Season ${targetSeason})`);
        continue;
      }

      const textClean = cleanStr(link.text);
      if (textClean === targetClean) {
        exactMatch = link.href;
        console.log(`🎯 EXACT match: "${link.text}" → ${link.href}`);
        break;
      }
      if (textClean && (textClean.includes(targetClean) || targetClean.includes(textClean))) {
        partialMatches.push({ href: link.href, text: link.text, textClean });
      }
    }

    if (exactMatch) return exactMatch;

    if (partialMatches.length > 0) {
      partialMatches.sort((a, b) => a.textClean.length - b.textClean.length);
      console.log(`🎯 Closest partial: "${partialMatches[0].text}" → ${partialMatches[0].href}`);
      return partialMatches[0].href;
    }

    // Strict reject: throw error instead of falling back to a mismatch season link
    throw new Error(
      `Could not find a secure search result matching "${title}" (Season ${targetSeason}) on AnimeSuge.`
    );
  }

  /**
   * Resolve an anime title or URL + episode number into a full watch-page URL.
   */
  static async resolveWatchUrlWithPage(page, inputUrl, episodeNumber = 1, options = {}) {
    if (!inputUrl) {
      throw new Error("An AnimeSuge URL or title is required");
    }

    const isUrl =
      /^https?:\/\//i.test(inputUrl) ||
      inputUrl.includes("animesuge.cz") ||
      inputUrl.startsWith("/");

    let animeDetailUrl = "";

    if (isUrl) {
      const normalized = this.normalizeUrl(inputUrl);

      // If already an episode URL like .../anime/SLUG/ep-N, just swap episode number
      if (/\/anime\/[^/]+(\/ep-\d+)?$/i.test(normalized)) {
        const base = normalized.replace(/\/ep-\d+$/i, "");
        return `${base}/ep-${episodeNumber}`;
      }

      animeDetailUrl = normalized;
    } else {
      // Title search
      animeDetailUrl = await this.searchAnimeUrl(page, inputUrl);
    }

    // Strip trailing slash and existing /ep-N
    const base = animeDetailUrl.replace(/\/+$/, "").replace(/\/ep-\d+$/i, "");
    return `${base}/ep-${episodeNumber}`;
  }


  /**
   * Full scrape: resolve URL, navigate to watch page, capture all server iframes.
   */
  static async scrapeAnimeEpisode(inputUrl, episodeNumber = 1, options = {}) {
    const { timeout = 40000, retries = 2 } = options;
    const requestedLang = options.lang === "dub" ? "dub" : "sub";

    console.log(
      `🎬 AnimeSuge scrape: "${inputUrl}" ep ${episodeNumber} [${requestedLang}]`
    );

    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      let context = null;

      try {
        const browser = await getBrowser();
        if (!browser) {
          throw new Error("Failed to initialize browser");
        }

        context = await browser.newContext({
          userAgent: this.USER_AGENT,
          viewport: { width: 1280, height: 720 },
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

        // Capture all AJAX /ajax/server?get= responses
        const capturedUrlsQueue = [];
        page.on("response", async (response) => {
          const url = response.url();
          if (url.includes("/ajax/server?get=")) {
            try {
              if (response.status() === 200) {
                const json = await response.json();
                if (json.status === 200 && json.result?.url) {
                  capturedUrlsQueue.push(json.result.url);
                }
              }
            } catch (_) {}
          }
        });

        // Resolve the watch page URL
        const watchUrl = await this.resolveWatchUrlWithPage(page, inputUrl, episodeNumber, options);
        console.log(`🔗 Watch URL: ${watchUrl}`);

        // Navigate
        await page.goto(watchUrl, { waitUntil: "domcontentloaded", timeout });

        // Wait for the player area to render
        await page.waitForTimeout(5000);

        // ── Try to detect a "not found" / 404 page ──────────────────────────
        const pageTitle = await page.title().catch(() => "");
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300)).catch(() => "");
        if (
          pageTitle.toLowerCase().includes("not found") ||
          pageTitle.toLowerCase().includes("404") ||
          bodyText.toLowerCase().includes("page not found")
        ) {
          throw new Error(`Episode page not found on AnimeSuge (${watchUrl}). The episode may not be available yet.`);
        }

        const sources = [];
        const seenUrls = new Set();

        // ── Collect all server buttons ────────────────────────────────────
        // AnimeSuge groups servers by .server-type[data-type="..."]
        // Each group contains .server buttons
        const categories = await page.locator(".server-type").all();
        console.log(`📂 Found ${categories.length} server-type containers`);

        // If no .server-type found, try alternative selectors
        if (categories.length === 0) {
          console.warn("⚠️ No .server-type containers — trying .servers, .episodes-server...");
          // Dump the relevant HTML for debugging
          const html = await page.evaluate(() => {
            const el = document.querySelector(".watch-extra, .servers, .server-list, .watch-server, #servers");
            return el ? el.outerHTML.slice(0, 500) : "No server container found";
          }).catch(() => "");
          console.log("Server area HTML:", html);
        }

        for (const category of categories) {
          const typeAttr = (await category.getAttribute("data-type").catch(() => "")) || "";
          const cleanType = typeAttr.trim().toLowerCase();
          const rowLang = cleanType.includes("dub") ? "dub" : "sub";

          const isTargetLang =
            (requestedLang === "dub" && rowLang === "dub") ||
            (requestedLang === "sub" && rowLang === "sub");

          if (!isTargetLang) continue;

          console.log(`🏷️ Processing server row: "${cleanType.toUpperCase()}"`);
          const buttons = await category.locator(".server").all();

          for (const button of buttons) {
            const labelText = await button.innerText().catch(() => "");
            const cleanLabel = `${cleanType.toUpperCase()} - ${labelText.trim()}`;

            const isActive = await button
              .getAttribute("class")
              .then((c) => c?.includes("active"))
              .catch(() => false);

            if (isActive) {
              // Active server URL was already fetched on page load
              const loadedUrl = capturedUrlsQueue.shift();
              if (loadedUrl && !seenUrls.has(loadedUrl)) {
                seenUrls.add(loadedUrl);
                sources.push({ label: cleanLabel, iframeUrl: loadedUrl, lang: rowLang });
                console.log(`  ✨ Active server [${cleanLabel}]: ${loadedUrl}`);
                continue;
              }
            }

            // Click non-active buttons
            console.log(`  👉 Clicking: "${cleanLabel}"`);
            try {
              const [res] = await Promise.all([
                page.waitForResponse(
                  (r) => r.url().includes("/ajax/server?get="),
                  { timeout: 7000 }
                ),
                button.click(),
              ]);
              const json = await res.json();
              if (json.status === 200 && json.result?.url) {
                const embedUrl = json.result.url;
                if (!seenUrls.has(embedUrl)) {
                  seenUrls.add(embedUrl);
                  sources.push({ label: cleanLabel, iframeUrl: embedUrl, lang: rowLang });
                  console.log(`  ✨ Click server [${cleanLabel}]: ${embedUrl}`);
                }
              }
            } catch (clickErr) {
              console.warn(`  ⚠️ Click failed [${cleanLabel}]: ${clickErr.message}`);
            }
          }
        }

        // ── Fallback: grab any visible iframe ────────────────────────────
        if (sources.length === 0) {
          console.warn("⚠️ No server buttons resolved — trying iframe fallback");
          const iframes = await page.$$eval("iframe", (els) => els.map((el) => el.src));
          const valid = iframes.filter(
            (s) =>
              s &&
              !s.includes("sharethis") &&
              !s.includes("plausible") &&
              !s.includes("recaptcha") &&
              s.startsWith("http")
          );
          if (valid.length > 0) {
            sources.push({ label: "iframe-fallback", iframeUrl: valid[0], lang: requestedLang });
            console.log(`⚠️ Using iframe fallback: ${valid[0]}`);
          }
        }

        // ── Also grab any remaining captured AJAX URLs ────────────────────
        for (const url of capturedUrlsQueue) {
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            sources.push({ label: "auto-captured", iframeUrl: url, lang: requestedLang });
            console.log(`  🎣 Auto-captured AJAX server URL: ${url}`);
          }
        }

        await context.close();

        if (sources.length === 0) {
          throw new Error(
            "No video player sources could be resolved. The episode may use a different player structure."
          );
        }

        console.log(`✅ AnimeSuge scraped ${sources.length} source(s) for ep ${episodeNumber}`);
        return {
          success: true,
          watchUrl,
          streamUrl: sources[0].iframeUrl,
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
        console.error(`❌ AnimeSuge attempt ${attempt}/${retries} failed: ${error.message}`);
        if (context) await context.close().catch(() => {});
        if (attempt < retries) {
          console.log(`⏳ Retrying in 3s...`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || "Unknown error",
    };
  }
}

export default AnimeSugeScraperService;
