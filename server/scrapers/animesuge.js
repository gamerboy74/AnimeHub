import { getBrowser, supabase } from "../index.js";
import { extractSeasonNumber } from "../utils/seasonExtractor.js";

export function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

export function getCoreTitle(title) {
  if (!title) return "";
  const decoded = decodeHtmlEntities(title);
  return decoded
    .toLowerCase()
    .replace(/(?:season\s*\d+|s\d+|\d+(?:nd|rd|th|st)?\s*season|\d+(?:nd|rd|th|st)?\s*sseason)/gi, "")
    .replace(/\b(?:movie|film|ova|ona|special|part)\b\s*\d*/gi, "")
    .replace(/\b(?:i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*$/i, "")
    .replace(/\b\d+\b\s*$/gi, "")
    .replace(/\b(?:dub|sub|uncensored|uncut|tv|dual[- ]audio|uncut)\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function verifyEpisodeNumberInUrl(loadedUrl, requestedEpisode) {
  try {
    const url = new URL(loadedUrl);
    
    // Check if redirected to home page or completely different section
    if (url.pathname === "/" || url.pathname === "") {
      return false; // Mismatch!
    }

    // Check query params
    const epParam = url.searchParams.get("ep");
    if (epParam) {
      const parsedEp = parseInt(epParam);
      if (!isNaN(parsedEp) && parsedEp !== requestedEpisode) {
        return false; // Mismatch!
      }
    }
    
    // Check path suffix (e.g. /ep-10 or -episode-10 or /episode/10)
    const pathname = url.pathname.toLowerCase();
    const pathPatterns = [
      /\/ep-(\d+)(?:\/|$)/i,
      /\/-episode-(\d+)(?:\/|$)/i,
      /\/episode\/(\d+)(?:\/|$)/i,
      /\/episode-(\d+)(?:\/|$)/i
    ];
    let foundEpisodeInPath = false;
    for (const pattern of pathPatterns) {
      const match = pathname.match(pattern);
      if (match) {
        foundEpisodeInPath = true;
        const parsedEp = parseInt(match[1]);
        if (!isNaN(parsedEp) && parsedEp !== requestedEpisode) {
          return false; // Mismatch!
        }
      }
    }

    if (!epParam && !foundEpisodeInPath && (pathname.includes("/watch") || pathname.includes("/anime"))) {
      if (requestedEpisode > 1) {
        return false;
      }
    }
  } catch (e) {}
  return true;
}

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
  static async searchAnimeUrl(page, title, options = {}) {
    const dbAnimeId = options.dbAnimeId;

    // Get all title variants from DB if possible to improve matching (e.g. English vs. Romaji)
    const titleVariants = new Set();
    titleVariants.add(title);

    if (dbAnimeId) {
      try {
        const { data: animeRecord } = await supabase
          .from("anime")
          .select("title, title_romaji, title_japanese, title_synonyms")
          .eq("id", dbAnimeId)
          .maybeSingle();

        if (animeRecord) {
          if (animeRecord.title) titleVariants.add(animeRecord.title);
          if (animeRecord.title_romaji) titleVariants.add(animeRecord.title_romaji);
          if (animeRecord.title_synonyms && Array.isArray(animeRecord.title_synonyms)) {
            for (const syn of animeRecord.title_synonyms) {
              if (syn && /^[a-zA-Z0-9\s\-':!,.&]+$/.test(syn)) {
                titleVariants.add(syn);
              }
            }
          }
        }
      } catch (e) {
        console.log("⚠️ Failed to fetch title variants from DB in AnimeSuge:", e.message);
      }
    }

    const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const sortWords = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");

    // Build unique search keywords to try, starting with the original title
    const searchKeywords = [...titleVariants];
    
    let lastError = null;
    let finalMatch = null;

    for (const keyword of searchKeywords) {
      try {
        const searchUrl = `${this.BASE_URL}/filter?keyword=${encodeURIComponent(keyword)}`;
        console.log(`🔍 AnimeSuge search: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 40000 });
        await page.waitForTimeout(2000);

        // Wait for result cards to appear
        try {
          await page.waitForSelector(".item", { timeout: 6000 });
        } catch (_) {
          console.warn("⚠️ No .item cards appeared — results may be empty");
        }

        // Extract links + titles from .item containers
        const animeLinks = await page.evaluate(() => {
          const seen = new Set();
          const results = [];

          document.querySelectorAll(".item").forEach((item) => {
            const link = item.querySelector('a[href*="/anime/"]');
            if (!link || !link.href || seen.has(link.href)) return;
            if (link.href.includes("/filter") || link.href.includes("/genre")) return;
            seen.add(link.href);

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

        console.log(`📋 AnimeSuge found ${animeLinks.length} results for keyword "${keyword}"`);
        if (animeLinks.length > 0) {
          animeLinks.slice(0, 5).forEach((l, i) =>
            console.log(`   [${i + 1}] "${l.text}" → ${l.href}`)
          );
        }

        if (animeLinks.length === 0) {
          continue; // Try next keyword if no results found
        }

        let exactMatch = null;
        let reorderMatch = null;
        let coreMatch = null;
        let coreMatchScore = -1;

        for (const link of animeLinks) {
          const decodedText = decodeHtmlEntities(link.text);
          const resultSeason = extractSeasonNumber(decodedText);
          const textClean = cleanStr(decodedText);
          const textSorted = sortWords(decodedText);
          const textCore = getCoreTitle(decodedText);

          // Check if link matches ANY of our known title variants
          for (const variant of titleVariants) {
            const decodedVariant = decodeHtmlEntities(variant);
            const targetSeason = extractSeasonNumber(decodedVariant);
            if (targetSeason !== resultSeason) {
              continue;
            }

            const targetClean = cleanStr(decodedVariant);
            const targetSorted = sortWords(decodedVariant);
            const targetCore = getCoreTitle(decodedVariant);

            // 1. Direct exact clean match
            if (textClean === targetClean) {
              exactMatch = link.href;
              console.log(`🎯 EXACT match with variant "${variant}": "${link.text}" -> ${link.href}`);
              break;
            }

            // 2. Token-sorted word match (e.g. "Baki Hanma" vs "Hanma Baki")
            if (textSorted === targetSorted && targetSorted !== "") {
              reorderMatch = link.href;
              console.log(`🎯 REORDER match with variant "${variant}": "${link.text}" -> ${link.href}`);
            }

            // 3. Core match
            const isCoreMatch = textCore && targetCore && (textCore === targetCore || textCore.includes(targetCore) || (targetCore.includes(textCore) && textCore.length / targetCore.length >= 0.8));
            if (isCoreMatch) {
              const lenRatio = Math.min(textClean.length, targetClean.length) / Math.max(textClean.length, targetClean.length || 1);
              const containsBonus = (textClean.includes(targetClean) || targetClean.includes(textClean)) ? 0.05 : 0;
              const score = lenRatio + containsBonus;
              console.log(`🎯 CORE match with variant "${variant}": "${link.text}" -> ${link.href} (score: ${score.toFixed(2)})`);
              if (score > coreMatchScore) {
                coreMatch = link.href;
                coreMatchScore = score;
              }
            }

            // 4. Token overlap match (e.g. "Koutetsujou no Kabaneri Soushuuhen Zenpen" vs "Koutetsujou no Kabaneri Movie 1")
            if (!exactMatch && !reorderMatch && !coreMatch) {
              const getTokens = (s) =>
                s.toLowerCase()
                 .replace(/[^a-z0-9\s]/g, "")
                 .split(/\s+/)
                 .filter(Boolean);
              
              const tokens1 = getTokens(decodedVariant);
              const tokens2 = getTokens(decodedText);
              
              if (tokens1.length > 0 && tokens2.length > 0) {
                const set2 = new Set(tokens2);
                const intersection = tokens1.filter(t => set2.has(t));
                const maxLen = Math.max(tokens1.length, tokens2.length);
                const overlapScore = intersection.length / maxLen;
                
                // If overlap score is high (>= 0.65), count as a match!
                if (overlapScore >= 0.65) {
                  console.log(`🎯 TOKEN OVERLAP match with variant "${variant}": "${link.text}" -> ${link.href} (score: ${overlapScore.toFixed(2)})`);
                  if (overlapScore > coreMatchScore) {
                    coreMatch = link.href;
                    coreMatchScore = overlapScore;
                  }
                }
              }
            }
          }

          if (exactMatch) break;
        }

        finalMatch = exactMatch || reorderMatch || (coreMatchScore >= 0.65 ? coreMatch : null);
        if (finalMatch) {
          return finalMatch;
        }
      } catch (err) {
        console.warn(`⚠️ AnimeSuge search query "${keyword}" failed:`, err.message);
        lastError = err;
      }
    }

    // Strict reject: throw error instead of falling back to a mismatch season link
    throw new Error(
      `Could not find a secure search result matching "${title}" on AnimeSuge.`
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
      animeDetailUrl = await this.searchAnimeUrl(page, inputUrl, options);
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
    const requestedLang = options.lang ? (options.lang === "dub" ? "dub" : "sub") : "all";

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

        // Proactively block popups/ads by overriding window.open
        await page.addInitScript(() => {
          try {
            window.open = () => null;
          } catch (e) {}
        });

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

        // Verify that the page URL actually matches the requested episode!
        const finalUrl = page.url();
        if (!verifyEpisodeNumberInUrl(finalUrl, episodeNumber)) {
          throw new Error(`AnimeSuge redirected from ${watchUrl} to ${finalUrl}. Episode ${episodeNumber} is likely not available yet.`);
        }

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
            requestedLang === "all" ||
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
                  { timeout: 3500 }
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
            sources.push({ label: "iframe-fallback", iframeUrl: valid[0], lang: requestedLang === "all" ? "sub" : requestedLang });
            console.log(`⚠️ Using iframe fallback: ${valid[0]}`);
          }
        }

        // ── Also grab any remaining captured AJAX URLs ────────────────────
        for (const url of capturedUrlsQueue) {
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            sources.push({ label: "auto-captured", iframeUrl: url, lang: requestedLang === "all" ? "sub" : requestedLang });
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
            lang: requestedLang === "all" ? "sub" : requestedLang,
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
