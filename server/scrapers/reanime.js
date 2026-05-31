import { getBrowser } from "../index.js";
import { extractSeasonNumber } from "../utils/seasonExtractor.js";
import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-extra";

export function getCoreTitle(title) {
  if (!title) return "";
  return title
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

export class ReAnimeScraperService {
  static BASE_URL = "https://reanime.to";
  static USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  static normalizeUrl(inputUrl) {
    if (!inputUrl) return "";
    if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
    return `${this.BASE_URL}${inputUrl.startsWith("/") ? "" : "/"}${inputUrl}`;
  }

  static async resolveWatchUrlWithPage(page, inputUrl, episodeNumber = 1, options = {}) {
    if (!inputUrl) {
      throw new Error("A Re:ANIME URL or title is required");
    }

    const isUrl = /^https?:\/\//i.test(inputUrl) || inputUrl.includes("reanime.to") || inputUrl.includes("/");

    let animeUrl = "";

    if (isUrl) {
      const normalizedUrl = this.normalizeUrl(inputUrl);

      // If it's already a watch URL, just parse, set params, and return
      if (/\/watch\//i.test(normalizedUrl)) {
        const watchUrlObj = new URL(normalizedUrl);
        if (episodeNumber) {
          watchUrlObj.searchParams.set("ep", String(episodeNumber));
        }
        if (options.lang) {
          watchUrlObj.searchParams.set("lang", options.lang);
        } else if (!watchUrlObj.searchParams.has("lang")) {
          watchUrlObj.searchParams.set("lang", "sub");
        }
        return watchUrlObj.toString();
      }

      animeUrl = normalizedUrl;
    } else {
      // It's a title! Search for it on Re:ANIME
      console.log(`🔍 Searching Re:ANIME for title: "${inputUrl}"`);
      await page.goto(this.BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000); // Wait for Cloudflare/Turnstile

      // Check for Cloudflare Turnstile block
      let pageTitle = await page.title().catch(() => "");
      let hasTurnstile = (await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null)) || 
                            (await page.$('[name="cf-turnstile-response"]').catch(() => null)) ||
                            pageTitle.includes("Just a moment...");
      if (hasTurnstile) {
        console.log("⚠️ Cloudflare challenge detected on search/home page — waiting 12s for auto-resolve...");
        await page.waitForTimeout(12000);
        
        // Re-check
        pageTitle = await page.title().catch(() => "");
        const stillBlocked = (await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null)) || 
                             (await page.$('[name="cf-turnstile-response"]').catch(() => null)) ||
                             pageTitle.includes("Just a moment...");
        if (stillBlocked) {
          throw new Error("Cloudflare Turnstile challenge active on search/home page — manual solve required");
        } else {
          console.log("🎉 Cloudflare challenge auto-resolved on search/home page!");
        }
      }

      // Find search input using robust waiting and multiple selector fallbacks
      let searchInput = null;
      try {
        searchInput = await page.waitForSelector('input[placeholder*="Search" i], input[type="search"], input[name="search"]', { timeout: 8000 });
      } catch (e) {
        try {
          searchInput = await page.waitForSelector('input[type="text"]', { timeout: 4000 });
        } catch (e2) {
          // If direct input not found, try finding the search icon/button to toggle the input visibility
          console.log("🔍 Search input not immediately visible, looking for toggle button...");
          const searchIcon = await page.$('.search-btn, .search-icon, button:has-text("Search"), [class*="search"]');
          if (searchIcon) {
            await searchIcon.click();
            await page.waitForTimeout(1500);
            try {
              searchInput = await page.waitForSelector('input[placeholder*="Search" i], input[type="search"], input[type="text"]', { timeout: 5000 });
            } catch (e3) {}
          }
        }
      }

      // Ultimate Fallback: Iterate all <input> elements on the page and match keyword attributes
      if (!searchInput) {
        console.log("🔍 Running ultimate search input scanner fallback...");
        const inputs = await page.$$('input');
        for (const input of inputs) {
          const placeholder = await input.getAttribute('placeholder').catch(() => '') || '';
          const type = await input.getAttribute('type').catch(() => '') || '';
          const id = await input.getAttribute('id').catch(() => '') || '';
          const name = await input.getAttribute('name').catch(() => '') || '';
          const className = await input.getAttribute('class').catch(() => '') || '';
          
          if (
            placeholder.toLowerCase().includes('search') ||
            id.toLowerCase().includes('search') ||
            name.toLowerCase().includes('search') ||
            className.toLowerCase().includes('search') ||
            type === 'search' ||
            type === 'text'
          ) {
            searchInput = input;
            console.log(`🎯 Ultimate Fallback matched input: name="${name}" placeholder="${placeholder}" type="${type}"`);
            break;
          }
        }
      }

      if (!searchInput) {
        throw new Error("Could not find search input on Re:ANIME");
      }

      await searchInput.click();
      await searchInput.fill("");
      await searchInput.type(inputUrl, { delay: 100 });
      await page.waitForTimeout(500);
      await searchInput.press("Enter");

      console.log("⏳ Waiting for search results...");
      await page.waitForTimeout(5000);

      // Extract all links
      const links = await page.$$eval('a', el => el.map(a => ({
        href: a.href,
        text: a.innerText
      })));

      const animeLinks = links.filter(l => l.href && (l.href.includes('/anime/') || l.href.includes('/watch/')));

      const targetSeason = extractSeasonNumber(inputUrl);
      const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const targetClean = cleanStr(inputUrl);
      const targetCore = getCoreTitle(inputUrl);

      let matchedLink = null;
      let bestScore = -1;
      for (const link of animeLinks) {
        const resultSeason = extractSeasonNumber(inputUrl);
        const resultSeasonNum = extractSeasonNumber(link.text);
        if (targetSeason !== resultSeasonNum) {
          console.log(`   ⏭️ Skipping result "${link.text}" (Season ${resultSeasonNum}) - mismatch with target (Season ${targetSeason})`);
          continue;
        }

        const textClean = cleanStr(link.text);
        const textCore = getCoreTitle(link.text);

        // Guard: only allow "target contains result" if result is ≥80% as long (prevents "Link Click" matching "Link Click: Bridon Arc")
        const isCleanMatch = textClean && (textClean.includes(targetClean) || (targetClean.includes(textClean) && textClean.length / targetClean.length >= 0.8));
        const isCoreMatch = textCore && (textCore.includes(targetCore) || (targetCore.includes(textCore) && textCore.length / targetCore.length >= 0.8));

        if (isCleanMatch || isCoreMatch) {
          const lenRatio = Math.min(textClean.length, targetClean.length) / Math.max(textClean.length, targetClean.length || 1);
          const containsBonus = (textClean.includes(targetClean) || targetClean.includes(textClean)) ? 0.05 : 0;
          const cleanBonus = isCleanMatch ? 0.1 : 0;
          const score = lenRatio + containsBonus + cleanBonus;
          const displayLogText = (link.text || '').replace(/\s+/g, ' ').trim();
          const truncatedText = displayLogText.length > 80 ? displayLogText.slice(0, 77) + "..." : displayLogText;
          console.log(`🎯 Candidate match: "${truncatedText}" -> ${link.href} (score: ${score.toFixed(2)})`);
          if (score > bestScore) {
            matchedLink = link.href;
            bestScore = score;
          }
        }
      }

      if (!matchedLink) {
        throw new Error(`Could not find a secure search result matching "${inputUrl}" (Season ${targetSeason}) on Re:ANIME.`);
      }

      // If the match is already a watch URL, parse, set params, and return
      if (/\/watch\//i.test(matchedLink)) {
        const watchUrlObj = new URL(matchedLink);
        if (episodeNumber) {
          watchUrlObj.searchParams.set("ep", String(episodeNumber));
        }
        if (options.lang) {
          watchUrlObj.searchParams.set("lang", options.lang);
        } else if (!watchUrlObj.searchParams.has("lang")) {
          watchUrlObj.searchParams.set("lang", "sub");
        }
        return watchUrlObj.toString();
      }

      animeUrl = matchedLink;
    }

    // If we got here, we have an animeUrl (like /anime/...)
    // Navigate to the anime detail page to get the watch URL
    console.log(`🌐 Navigating to anime detail page to resolve watch URL: ${animeUrl}`);
    await page.goto(animeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Look for a link containing /watch/
    const watchLink = await page.locator('a[href*="/watch/"]').first().getAttribute('href').catch(() => null);
    if (!watchLink) {
      // Fallback: Construct it from slug if we can't find one
      const match = animeUrl.match(/\/anime\/([a-z0-9-]+)-([a-z0-9]+)$/i);
      if (match) {
        const fullSlug = match[1];
        const id = match[2];
        const lang = options.lang || "sub";
        const constructedWatchUrl = `${this.BASE_URL}/watch/${fullSlug}-${id}?ep=${episodeNumber}&lang=${lang}`;
        console.log(`⚠️ No watch link found. Fallback constructed watch URL: ${constructedWatchUrl}`);
        return constructedWatchUrl;
      }
      throw new Error("Could not find a watch link on the Re:ANIME detail page");
    }

    const watchUrlObj = new URL(this.normalizeUrl(watchLink));
    if (episodeNumber) {
      watchUrlObj.searchParams.set("ep", String(episodeNumber));
    }
    if (options.lang) {
      watchUrlObj.searchParams.set("lang", options.lang);
    } else if (!watchUrlObj.searchParams.has("lang")) {
      watchUrlObj.searchParams.set("lang", "sub");
    }

    return watchUrlObj.toString();
  }

  static async launchManualBypass() {
    console.log("\n⚠️ Headless Cloudflare bypass failed. Launching headful verification browser...");
    console.log("🚨 A Chrome window will open on your desktop. Please solve the CAPTCHA there!");
    
    let browser;
    try {
      browser = await chromium.launch({
        headless: false,
        channel: "chrome",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: this.USER_AGENT
      });
      
      const page = await context.newPage();
      await page.goto(this.BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      
      // Poll and check if Turnstile is solved
      let solved = false;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);
        const title = await page.title().catch(() => "");
        const hasTurnstile = (await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null)) || 
                             (await page.$('[name="cf-turnstile-response"]').catch(() => null)) ||
                             title.includes("Just a moment...");
        
        if (!hasTurnstile && title && !title.includes("Just a moment...")) {
          console.log(`\n🎉 Turnstile solved! Current Title: "${title}"`);
          solved = true;
          break;
        }
        process.stdout.write(".");
      }
      
      if (solved) {
        const userAgent = await page.evaluate(() => navigator.userAgent);
        const storageState = await context.storageState();
        const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "cf-state.json");
        
        fs.writeFileSync(statePath, JSON.stringify({ userAgent, storageState }, null, 2));
        console.log(`💾 Successfully saved cookies and User-Agent to cf-state.json`);
        return true;
      } else {
        console.log("\n❌ Timeout waiting for manual verification solve.");
        return false;
      }
      
    } catch (e) {
      console.error("❌ Failed to run manual bypass browser:", e.message);
      return false;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  static async scrapeAnimeEpisode(inputUrl, episodeNumber = 1, options = {}) {
    const { timeout = 30000, retries = 2 } = options;
    const requestedLang = options.lang ? (options.lang === "dub" ? "dub" : "sub") : "all";

    console.log(
      `🎬 Scraping Re:ANIME for "${inputUrl}" (episode ${episodeNumber}) [${requestedLang}]...`
    );

    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      let browser;
      let context;

      try {
        browser = await getBrowser();
        if (!browser) {
          throw new Error("Failed to initialize browser");
        }

        const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "cf-state.json");
        const hasState = fs.existsSync(statePath);
        let loadedState = undefined;
        let activeUserAgent = this.USER_AGENT;

        if (hasState) {
          try {
            const raw = fs.readFileSync(statePath, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed.storageState && parsed.userAgent) {
              console.log("💾 Loading combined Cloudflare clearance session and matching User-Agent...");
              loadedState = parsed.storageState;
              activeUserAgent = parsed.userAgent;
            } else if (parsed.cookies || parsed.origins) {
              console.log("💾 Loading standard Playwright storageState from cf-state.json");
              loadedState = parsed;
            }
          } catch (e) {
            console.error("⚠️ Failed to parse cf-state.json:", e.message);
          }
        }

        context = await browser.newContext({
          storageState: loadedState,
          userAgent: activeUserAgent,
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

        const page = await context.newPage();
        
        // Proactively block popups/ads by overriding window.open
        await page.addInitScript(() => {
          try {
            window.open = () => null;
          } catch (e) {}
        });

        // Resolve watchUrl using the page (so we bypass Cloudflare via Playwright)
        const watchUrl = await this.resolveWatchUrlWithPage(page, inputUrl, episodeNumber, options);
        console.log(`🔗 Resolved Re:ANIME watch URL: ${watchUrl}`);

        // Navigate to the watch page
        await page.goto(watchUrl, {
          waitUntil: "domcontentloaded",
          timeout,
        });

        await page.waitForTimeout(4000);

        // Check for Cloudflare Turnstile block on watch page
        let watchPageTitle = await page.title().catch(() => "");
        let watchHasTurnstile = (await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null)) || 
                                  (await page.$('[name="cf-turnstile-response"]').catch(() => null)) ||
                                  watchPageTitle.includes("Just a moment...");
        if (watchHasTurnstile) {
          console.log("⚠️ Cloudflare challenge detected on watch page — waiting 12s for auto-resolve...");
          await page.waitForTimeout(12000);
          
          // Re-check
          watchPageTitle = await page.title().catch(() => "");
          const stillBlocked = (await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null)) || 
                               (await page.$('[name="cf-turnstile-response"]').catch(() => null)) ||
                               watchPageTitle.includes("Just a moment...");
          if (stillBlocked) {
            throw new Error("Cloudflare Turnstile challenge active on watch page — manual solve required");
          } else {
            console.log("🎉 Cloudflare challenge auto-resolved on watch page!");
          }
        }

        // Verify that the page URL actually matches the requested episode!
        const finalUrl = page.url();
        if (!verifyEpisodeNumberInUrl(finalUrl, episodeNumber)) {
          throw new Error(`Re:ANIME redirected from ${watchUrl} to ${finalUrl}. Episode ${episodeNumber} is likely not available yet.`);
        }

        // Check if the page displays a "No streaming servers available" notification
        const noServersAvailable = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          return bodyText.includes("No streaming servers available") || 
                 bodyText.includes("doesn't have any server yet") ||
                 bodyText.includes("This episode doesn't have any server yet");
        });

        if (noServersAvailable) {
          throw new Error("No streaming servers are available for this episode on Re:ANIME.");
        }

        try {
          await page.waitForFunction(
            () => {
              const iframe = document.querySelector("iframe");
              return !!(iframe && iframe.getAttribute("src"));
            },
            { timeout: Math.min(timeout, 15000) }
          );
        } catch {}

        const currentIframeUrl = await page
          .locator("iframe")
          .first()
          .getAttribute("src")
          .catch(() => null);

        const sources = [];
        const seen = new Set();
        const fallbackUrl = currentIframeUrl;

        // Normalize a URL for dedup — strip volatile params (timestamps, autoPlay flags)
        // so the same embed isn't saved twice just because kuudere_ts changed
        const normUrl = (u) => {
          try {
            const obj = new URL(u);
            for (const p of ['kuudere_ts', 'autoPlay', 'autostart']) obj.searchParams.delete(p);
            return obj.toString();
          } catch { return u; }
        };

        // Isolate scope to the requested language container (SUB or DUB)
        const languagesToScrape = requestedLang === "all" ? ["sub", "dub"] : [requestedLang];

        for (const lang of languagesToScrape) {
          const langLabel = lang === "dub" ? "DUB" : "SUB";
          let targetScope = page;
          let scopeIsolated = false;
          
          try {
            const span = page.locator('span').filter({ hasText: new RegExp(`^\\s*${langLabel}\\s*:?\\s*$`, 'i') }).filter({ visible: true }).first();
            const hasSpan = await span.count() > 0;
            if (hasSpan) {
              targetScope = span.locator('..');
              scopeIsolated = true;
              console.log(`🎯 Isolated Re:ANIME scraper scope to visible ${langLabel} container`);
            } else {
              console.warn(`⚠️ Could not find visible ${langLabel} span — falling back to full page. Lang may be inaccurate.`);
            }
          } catch (e) {
            console.warn("⚠️ Failed to isolate Re:ANIME container scope, falling back to full page search:", e.message);
          }

          for (const label of ["HD-2", "HD-1"]) {
            const buttonCount = await targetScope.getByRole("button", { name: label }).count().catch(() => 0);

            for (let index = 0; index < buttonCount; index++) {
              try {
                await targetScope.getByRole("button", { name: label }).nth(index).click({
                  timeout: 5000,
                });
                await page.waitForTimeout(2500);

                const iframeUrl = await page
                  .locator("iframe")
                  .first()
                  .getAttribute("src")
                  .catch(() => null);

                if (iframeUrl && !seen.has(normUrl(iframeUrl))) {
                  seen.add(normUrl(iframeUrl));
                  sources.push({
                    label,
                    occurrence: index,
                    iframeUrl,
                    lang,
                    scopeIsolated,
                  });
                  console.log(`  ✨ Re:ANIME found server [${langLabel} - ${label}]: ${iframeUrl}`);
                }
              } catch (clickError) {
                console.warn(
                  `⚠️ Failed to click Re:ANIME button ${label} #${index}`,
                  clickError.message
                );
              }
            }
          }
        }

        // Fallback: If no sources were extracted via clicking, use the initial active iframe URL
        const isValidPlayerUrl = (url) => {
          if (!url) return false;
          const u = url.toLowerCase();
          if (u.includes("about:blank") || u.includes("disqus") || u.includes("discord") || u.includes("google") || u.includes("ads") || u.includes("doubleclick")) {
            return false;
          }
          return u.includes("embed") || u.includes("player") || u.includes("flix") || u.includes("reanime.to") || u.includes("vidsrc") || u.includes("vidplay") || u.includes("megaembed") || u.includes("filemoon");
        };

        if (sources.length === 0 && fallbackUrl && isValidPlayerUrl(fallbackUrl)) {
          sources.push({
            label: "active",
            occurrence: 0,
            iframeUrl: fallbackUrl,
            lang: requestedLang === "all" ? "sub" : requestedLang,
            scopeIsolated: false,
          });
        }

        if (sources.length === 0) {
          throw new Error("No video player sources could be resolved for this episode on Re:ANIME.");
        }

        // Save storage state on successful extraction
        if (sources.length > 0) {
          try {
            const storageState = await context.storageState();
            const combined = {
              userAgent: activeUserAgent,
              storageState
            };
            fs.writeFileSync(statePath, JSON.stringify(combined, null, 2));
            console.log("💾 Successfully saved persistent Cloudflare clearance session and User-Agent to cf-state.json");
          } catch (e) {
            console.warn("⚠️ Failed to save Cloudflare clearance state:", e.message);
          }
        }

        await context.close();

        return {
          success: true,
          watchUrl,
          streamUrl: sources[0]?.iframeUrl || currentIframeUrl || watchUrl,
          episodeData: {
            inputUrl,
            watchUrl,
            currentIframeUrl,
            sources,
            sourceCount: sources.length,
            episodeNumber,
            lang: requestedLang === "all" ? "sub" : requestedLang,
          },
        };
      } catch (error) {
        lastError = error;
        console.error(`❌ Re:ANIME scrape attempt ${attempt} failed:`, error.message);

        if (context) {
          await context.close().catch(() => {});
        }

        if (error.message.toLowerCase().includes("manual solve required")) {
          console.log("🛑 Headless Turnstile challenge block — triggering automatic headful bypass...");
          const success = await ReAnimeScraperService.launchManualBypass();
          if (success) {
            console.log("🚀 Manual bypass successful! Retrying scrape with active clearance cookies...");
            continue; // Continue to the next attempt in the loop!
          } else {
            break; // Manual bypass failed or timed out, exit the loop
          }
        }

        if (error.message.toLowerCase().includes("cloudflare turnstile")) {
          console.log("🛑 Re:ANIME Turnstile block detected — skipping retries to save CPU.");
          break; // Exit the attempt loop immediately!
        }

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
}
