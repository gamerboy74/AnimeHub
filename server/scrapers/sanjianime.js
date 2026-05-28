import { getBrowser, supabase } from "../index.js";
import { extractSeasonNumber } from "../utils/seasonExtractor.js";

export class SanjiAnimeScraperService {
  static BASE_URL = "https://sanjianime.com";
  static USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  static normalizeUrl(inputUrl) {
    if (!inputUrl) return "";
    if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
    return `${this.BASE_URL}${inputUrl.startsWith("/") ? "" : "/"}${inputUrl}`;
  }

  static isDirectPlayableUrl(url) {
    if (!url) return false;
    return /\.(mp4|webm|m3u8)(\?|#|$)/i.test(url) || /archive\.org\/.*\.mp4/i.test(url);
  }

  static inferLangFromLabel(label, fallback = "unknown") {
    const normalized = (label || "").toLowerCase();
    if (normalized.includes("dub")) return "dub";
    if (normalized.includes("sub")) return "sub";
    return fallback;
  }

  static async resolveWatchUrlWithPage(page, inputUrl, episodeNumber = 1) {
    if (!inputUrl) {
      throw new Error("A Sanji Anime URL or title is required");
    }

    const isUrl = /^https?:\/\//i.test(inputUrl) || inputUrl.includes("sanjianime.com") || inputUrl.includes("/");
    let animeUrl = "";

    if (isUrl) {
      const normalizedUrl = this.normalizeUrl(inputUrl);
      if (/\/watch\//i.test(normalizedUrl)) {
        return normalizedUrl;
      }
      animeUrl = normalizedUrl;
    } else {
      console.log(`🔍 Searching Sanji Anime for title: "${inputUrl}"`);
      const searchUrls = [
        `${this.BASE_URL}/?s=${encodeURIComponent(inputUrl)}`,
        `${this.BASE_URL}/search/?s=${encodeURIComponent(inputUrl)}`,
        `${this.BASE_URL}/search?q=${encodeURIComponent(inputUrl)}`,
      ];

      const targetSeason = extractSeasonNumber(inputUrl);
      let matchedAnimeUrl = "";
      for (const searchUrl of searchUrls) {
        try {
          await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(2500);

          const links = await page.$$eval("a", (nodes) =>
            nodes
              .map((node) => ({ href: node.href || "", text: (node.textContent || "").trim() }))
              .filter((link) => link.href && (link.href.includes("/anime/") || link.href.includes("/watch/")))
          );

          // Filter out any links that do not match our target season
          const filteredLinks = links.filter((link) => {
            const resultSeason = extractSeasonNumber(link.text);
            const isMatch = targetSeason === resultSeason;
            if (!isMatch) {
              console.log(`   ⏭️ Skipping result "${link.text}" (Season ${resultSeason}) - mismatch with target (Season ${targetSeason})`);
            }
            return isMatch;
          });

          const normalizedTitle = inputUrl.toLowerCase().replace(/[^a-z0-9]/g, "");
          const directMatch = filteredLinks.find((link) => {
            const normalizedText = link.text.toLowerCase().replace(/[^a-z0-9]/g, "");
            return normalizedText && (normalizedText.includes(normalizedTitle) || normalizedTitle.includes(normalizedText));
          });

          matchedAnimeUrl = directMatch?.href || filteredLinks[0]?.href || "";
          if (matchedAnimeUrl) break;
        } catch (error) {
          console.log(`⚠️ Search URL failed: ${searchUrl} — ${error.message}`);
        }
      }

      if (!matchedAnimeUrl) {
        throw new Error(`Could not find a secure search result matching "${inputUrl}" (Season ${targetSeason}) on Sanji Anime.`);
      }

      animeUrl = matchedAnimeUrl;
    }

    if (/\/watch\//i.test(animeUrl)) {
      return animeUrl;
    }

    console.log(`🌐 Navigating to Sanji Anime anime page: ${animeUrl}`);
    await page.goto(animeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const episodeLinks = await page.$$eval('a[href*="/watch/"]', (nodes) =>
      nodes
        .map((node) => ({
          href: node.href || "",
          text: (node.textContent || "").trim().replace(/\s+/g, " "),
          episode: node.getAttribute("data-episode-search-query") || "",
        }))
        .filter((link) => link.href)
    );

    const exactEpisodeLink = episodeLinks.find((link) => {
      const hrefMatch = link.href.match(/episode-(\d+)/i);
      return hrefMatch && parseInt(hrefMatch[1], 10) === episodeNumber;
    });

    const selectedLink = exactEpisodeLink || episodeLinks[0];
    if (!selectedLink?.href) {
      throw new Error("Could not find an episode link on the Sanji Anime page");
    }

    return selectedLink.href;
  }

  static async collectServerSources(page, fallbackLang = "unknown") {
    const serverOptions = await page.evaluate(() => {
      return [...document.querySelectorAll("[data-embed-id]")].map((element) => ({
        label: (element.textContent || "").trim().replace(/\s+/g, " "),
        embedId: element.getAttribute("data-embed-id") || "",
      }));
    });

    const sources = [];

    const captureCurrentPlayer = async () => {
      const iframeUrl = await page.locator("iframe").first().getAttribute("src").catch(() => null);

      if (iframeUrl && this.isDirectPlayableUrl(iframeUrl)) {
        return { iframeUrl, playableUrl: iframeUrl, frameTitle: "", sourceUrls: [iframeUrl], directM3u8: [] };
      }

      // Look for the correct player frame using a comprehensive list of domains and standard matching
      const matchingFrame = page.frames().find(
        (f) =>
          (iframeUrl && (f.url() === iframeUrl || f.url().includes(iframeUrl.replace(/^https?:\/\//i, "")))) ||
          /xplayer\.apnshare\.org\/e\//.test(f.url()) ||
          /player\./.test(f.url()) ||
          /videas\.fr\/embed\//.test(f.url()) ||
          /fairuseonly\.xyz\/embed\//.test(f.url()) ||
          /animexyz\./.test(f.url())
      );

      if (!matchingFrame) {
        return { iframeUrl: iframeUrl || null, playableUrl: iframeUrl || null, frameTitle: "", sourceUrls: [], directM3u8: [] };
      }

      const activeUrl = matchingFrame.url();

      try {
        // Evaluate a frame for direct streams or sources
        const evaluateFrame = async (f) => {
          try {
            return await f.evaluate(() => {
              const html = document.documentElement.outerHTML;
              const directM3u8 = [...html.matchAll(/https?:\/\/[^"'\s>]+\.m3u8[^"'\s>]*/g)]
                .map((match) => match[0].replace(/["'`;]$/g, ""));
              const sourceUrls = [...document.querySelectorAll("source")]
                .map((element) => element.getAttribute("src"))
                .filter(Boolean);
              const video = document.querySelector("video");

              return {
                title: document.title || "",
                sourceUrls,
                directM3u8,
                videoSrc: video?.getAttribute("src") || null,
              };
            });
          } catch (e) {
            return null;
          }
        };

        const frameDataList = [];

        // 1. Evaluate matchingFrame
        const mainData = await evaluateFrame(matchingFrame);
        if (mainData) frameDataList.push(mainData);

        // 2. Evaluate all child frames (nested frames)
        for (const child of matchingFrame.childFrames()) {
          const childData = await evaluateFrame(child);
          if (childData) frameDataList.push(childData);
          
          // 3. Evaluate grandchild frames
          for (const grandchild of child.childFrames()) {
            const grandchildData = await evaluateFrame(grandchild);
            if (grandchildData) frameDataList.push(grandchildData);
          }
        }

        // Aggregate all discovered sources
        const sourceUrls = [];
        const directM3u8 = [];
        const videoSrcs = [];
        let title = "";

        for (const fd of frameDataList) {
          if (fd.title && !title) title = fd.title;
          if (fd.sourceUrls) sourceUrls.push(...fd.sourceUrls);
          if (fd.directM3u8) directM3u8.push(...fd.directM3u8);
          if (fd.videoSrc) videoSrcs.push(fd.videoSrc);
        }

        const playableUrl = firstValue([
          ...sourceUrls,
          ...directM3u8,
          ...videoSrcs,
          activeUrl,
          iframeUrl
        ]);

        return {
          iframeUrl: activeUrl || iframeUrl,
          playableUrl,
          frameTitle: title || (await page.title().catch(() => "")),
          sourceUrls,
          directM3u8,
        };
      } catch (error) {
        return { iframeUrl: activeUrl || iframeUrl, playableUrl: activeUrl || iframeUrl, frameTitle: "", sourceUrls: [], directM3u8: [], error: error.message };
      }
    };

    function firstValue(values) {
      return values.find(Boolean) || null;
    }

    const initialCapture = await captureCurrentPlayer();
    sources.push({
      label: "current",
      lang: fallbackLang,
      kind: "current",
      active: true,
      ...initialCapture,
    });

    for (const option of serverOptions) {
      const serverButton = page.locator("[data-embed-id]").filter({ hasText: option.label }).first();
      try {
        await serverButton.click();
        await page.waitForTimeout(1500);
        const capture = await captureCurrentPlayer();
        sources.push({
          label: option.label,
          lang: this.inferLangFromLabel(option.label, fallbackLang),
          kind: this.inferLangFromLabel(option.label, fallbackLang),
          active: false,
          embedId: option.embedId,
          ...capture,
        });
      } catch (error) {
        sources.push({
          label: option.label,
          lang: this.inferLangFromLabel(option.label, fallbackLang),
          kind: this.inferLangFromLabel(option.label, fallbackLang),
          active: false,
          embedId: option.embedId,
          iframeUrl: await page.locator("iframe").first().getAttribute("src").catch(() => null),
          playableUrl: null,
          error: error.message,
        });
      }
    }

    const deduped = [];
    const seen = new Set();
    for (const source of sources) {
      const key = `${source.label}|${source.iframeUrl || ""}|${source.playableUrl || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(source);
    }

    const primarySource = deduped.find((source) => source.active && source.playableUrl) || deduped.find((source) => source.playableUrl) || deduped[0] || null;

    return {
      sources: deduped,
      streamUrl: primarySource?.playableUrl || primarySource?.iframeUrl || null,
    };
  }

  static async scrapeAnimeEpisode(inputUrl, episodeNumber = 1, options = {}) {
    const { timeout = 30000, retries = 2 } = options;
    const fallbackLang = options.lang || (/\b-d\/?$/i.test(inputUrl || "") || /dub/i.test(inputUrl || "") ? "dub" : "sub");

    console.log(`🎬 Scraping Sanji Anime for "${inputUrl}" (episode ${episodeNumber})...`);

    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      let browser = null;
      let context = null;

      try {
        browser = await getBrowser();
        if (!browser) {
          throw new Error("Failed to initialize browser");
        }

        context = await browser.newContext({
          userAgent: this.USER_AGENT,
          viewport: { width: 1280, height: 720 },
          bypassCSP: true,
          javaScriptEnabled: true,
        });

        const page = await context.newPage();
        const watchUrl = await this.resolveWatchUrlWithPage(page, inputUrl, episodeNumber, options);
        console.log(`🔗 Resolved Sanji Anime watch URL: ${watchUrl}`);

        await page.goto(watchUrl, { waitUntil: "domcontentloaded", timeout });
        await page.waitForTimeout(2500);

        const { sources, streamUrl } = await this.collectServerSources(page, fallbackLang);
        if (!streamUrl) {
          throw new Error("No playable URL found for the Sanji Anime page");
        }

        const pageTitle = await page.title().catch(() => "");

        await context.close();

        return {
          success: true,
          streamUrl,
          watchUrl,
          episodeData: {
            title: pageTitle || `Episode ${episodeNumber}`,
            animeTitle: typeof inputUrl === "string" ? inputUrl : "",
            episodeNumber,
            sources,
            lang: fallbackLang,
          },
        };
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);

        if (context) {
          await context.close().catch(() => {});
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

  static async saveEpisodeToDatabase(episodeData) {
    try {
      const { data: existingEpisode } = await supabase
        .from("episodes")
        .select("id, title, description, thumbnail_url")
        .eq("anime_id", episodeData.animeId)
        .eq("episode_number", episodeData.episodeNumber)
        .maybeSingle();

      const scrapeLang = episodeData.lang || "unknown";
      let mergedServers = [];
      if (Array.isArray(episodeData.sources) && episodeData.sources.length > 0) {
        mergedServers = episodeData.sources.map((source) => ({
          name: source.label || "Server",
          url: source.playableUrl || source.iframeUrl || source.url || episodeData.videoUrl,
          lang: (source.lang || scrapeLang).toLowerCase(),
        }));
      } else {
        mergedServers = [{ name: "Sanji Anime", url: episodeData.videoUrl, lang: scrapeLang.toLowerCase() }];
      }

      if (existingEpisode) {
        const { data: currentEp } = await supabase
          .from("episodes")
          .select("video_servers")
          .eq("id", existingEpisode.id)
          .single();

        const otherServers = Array.isArray(currentEp?.video_servers)
          ? currentEp.video_servers.filter(
              (server) =>
                !mergedServers.some(
                  (newServer) =>
                    newServer.url === server.url &&
                    (newServer.name || "").toLowerCase() === (server.name || "").toLowerCase() &&
                    (newServer.lang || "").toLowerCase() === (server.lang || "").toLowerCase()
                )
            )
          : [];

        await supabase
          .from("episodes")
          .update({
            video_url: episodeData.videoUrl,
            video_servers: [...otherServers, ...mergedServers],
            duration: episodeData.duration || 1440,
            title: episodeData.title,
            description: episodeData.description,
            thumbnail_url: episodeData.thumbnailUrl || existingEpisode.thumbnail_url || null,
          })
          .eq("id", existingEpisode.id);

        return { success: true };
      }

      await supabase.from("episodes").insert({
        anime_id: episodeData.animeId,
        episode_number: episodeData.episodeNumber,
        title: episodeData.title,
        video_url: episodeData.videoUrl,
        video_servers: mergedServers,
        thumbnail_url: episodeData.thumbnailUrl || null,
        duration: episodeData.duration || 1440,
        description: episodeData.description,
        created_at: episodeData.createdAt?.toISOString?.() || new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || "Unknown database error" };
    }
  }

  static async scrapeAndSaveEpisode(animeTitle, animeId, episodeNumber = 1, options = {}) {
    const scrapeResult = await this.scrapeAnimeEpisode(animeTitle, episodeNumber, { ...options, animeId });

    if (!scrapeResult.success || !scrapeResult.streamUrl) {
      return scrapeResult;
    }

    const episodeData = {
      animeId,
      episodeNumber,
      title: `${animeTitle} - Episode ${episodeNumber}`,
      videoUrl: scrapeResult.streamUrl,
      thumbnailUrl: scrapeResult.episodeData?.thumbnailUrl || null,
      duration: scrapeResult.episodeData?.duration || 1440,
      description: `Scraped from Sanji Anime`,
      createdAt: new Date(),
      lang: scrapeResult.episodeData?.lang || "unknown",
      sources: scrapeResult.episodeData?.sources || [],
    };

    const saveResult = await this.saveEpisodeToDatabase(episodeData);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Scraping succeeded but database save failed: ${saveResult.error}`,
      };
    }

    return {
      success: true,
      streamUrl: scrapeResult.streamUrl,
      watchUrl: scrapeResult.watchUrl,
      episodeData: {
        ...episodeData,
        databaseSaveSuccess: true,
        sources: scrapeResult.episodeData?.sources || [],
      },
    };
  }
}

export default SanjiAnimeScraperService;