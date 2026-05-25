import * as cheerio from "cheerio";
import axios from "axios";
import { getBrowser, enqueue, supabase } from "../index.js";

export function normalizeDuration(val) {
  if (!val) return 1440; // Default to 24 minutes (1440 seconds)
  if (typeof val === 'number') {
    return val <= 100 ? val * 60 : val;
  }
  if (typeof val !== 'string') return 1440;

  const clean = val.toLowerCase().trim();
  if (!clean) return 1440;

  if (clean.includes(':')) {
    const parts = clean.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else {
      seconds = parts[0] || 0;
    }
    return seconds;
  }

  let minutes = 0;
  const hrMatch = clean.match(/(\d+)\s*(?:h|hr|hour)/);
  if (hrMatch) {
    minutes += parseInt(hrMatch[1], 10) * 60;
  }
  const minMatch = clean.match(/(\d+)\s*(?:m|min|minute)/);
  if (minMatch) {
    minutes += parseInt(minMatch[1], 10);
  } else if (!hrMatch) {
    const digitsMatch = clean.match(/^(\d+)$/);
    if (digitsMatch) {
      const num = parseInt(digitsMatch[1], 10);
      return num <= 100 ? num * 60 : num;
    }
  }

  return minutes > 0 ? minutes * 60 : 1440;
}

export class NineAnimeScraperService {
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
        maxEpisodes,
        animeTitle
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
            // Check if we need to retrieve the poster URL to use as episode thumbnail
            let thumbnailUrl = null;
            if (dbAnimeId) {
              try {
                const { data: animeRow } = await supabase
                  .from('anime')
                  .select('poster_url')
                  .eq('id', dbAnimeId)
                  .single();
                thumbnailUrl = animeRow?.poster_url || null;
              } catch (e) {
                console.warn('Could not fetch poster URL for thumbnail:', e.message);
              }
            }

            scrapedEpisodes.push({
              ...episode,
              streamUrl: episodeResult.streamUrl,
              embeddingProtected: episodeResult.embeddingProtected,
              embeddingReason: episodeResult.embeddingReason,
              scrapedAt: new Date().toISOString(),
            });
            
            // Save to DB so that anime without initial episode stubs actually get stored.
            if (dbAnimeId && episodeResult.streamUrl) {
              await this.saveEpisodeToDatabase({
                animeId: dbAnimeId,
                episodeNumber: episode.number,
                title: episode.title || `${animeTitle} - Episode ${episode.number}`,
                videoUrl: episodeResult.streamUrl,
                thumbnailUrl: thumbnailUrl,
                duration: 1440,
                description: `Episode ${episode.number} of ${animeTitle}`,
                createdAt: new Date(),
              });
            }
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
  static async getAvailableEpisodes(animeLink, animeId, maxEpisodes = 50, animeTitle = '') {
    try {
      console.log("📺 Getting available episodes...");

      const response = await axios.get(animeLink, {
        headers: { "User-Agent": this.USER_AGENT },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);

      // Build a normalized title slug from the provided animeTitle (if any)
      const titleSlug = animeTitle
        ? animeTitle.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .trim()
        : '';

      // Extract anime slug from the URL for filtering; prefer explicit titleSlug if available
      const animeSlugFromUrl =
        animeLink.match(/\/([^\/]+)-episode-\d+/)?.[1] ||
        animeLink.match(/anime\/([^\/]+)/)?.[1] ||
        animeId;

      const animeSlug = titleSlug || animeSlugFromUrl || animeId;
      console.log(`🔍 Looking for episodes with anime slug: ${animeSlug} (titleSlug: ${titleSlug || 'N/A'})`);

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

      // Helper: prefer links that include season markers when title contains season info
      const seasonHints = [];
      if (titleSlug && /season[-_\s]?\d+/i.test(animeTitle)) {
        // e.g. "wistoria-wand-and-sword-season-2" -> prefer '-season-2' matches
        const seasonMatch = animeTitle.match(/season\s*(\d+)/i);
        if (seasonMatch) seasonHints.push(`${titleSlug}-season-${seasonMatch[1]}`);
      }

      // If we found episode links, optionally filter to prefer season-specific ones
      if (episodes.length > 0 && seasonHints.length > 0) {
        const filteredBySeason = episodes.filter(ep =>
          seasonHints.some(h => ep.url.includes(h) || (ep.url.startsWith('/') && ep.url.includes(h)))
        );
        if (filteredBySeason.length > 0) {
          console.log('ℹ️ Preferencing season-specific episode links');
          episodes.length = 0;
          episodes.push(...filteredBySeason);
        }
      }

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
            // If the DB has a slug, prefer a season-specific slug when the requested title includes a season
            const baseSlug = animeRecord.nine_anime_slug;
            // Determine season from provided title, if any
            const seasonMatch = animeTitle ? animeTitle.match(/season\s*(\d+)/i) : null;
            if (seasonMatch) {
              const seasonNum = seasonMatch[1];
              const seasonSlug = `${baseSlug}-season-${seasonNum}`;
              const seasonUrl = `${this.BASE_URL}/${seasonSlug}-episode-${episodeNumber}/`;
              console.log(`🔗 Testing cached season-specific slug: ${seasonUrl}`);
              try {
                const seasonResp = await axios.get(seasonUrl, {
                  headers: { "User-Agent": this.USER_AGENT },
                  timeout: 5000,
                  validateStatus: (s) => s < 500,
                });
                if (seasonResp.status === 200) {
                  // Verify page title similarity before accepting
                  const pageTitle = this.extractPageTitle(seasonResp.data);
                  const similarity = this.titleSimilarity(animeTitle, pageTitle);
                  if (similarity >= 0.6) {
                    console.log(`✅ Using season-specific cached slug (similarity: ${similarity.toFixed(2)}): ${seasonUrl}`);
                    // Save the verified season slug back to DB
                    await this.saveVerifiedSlug(dbAnimeId, seasonSlug);
                    const result = { success: true, animeLink: seasonUrl, animeId: seasonSlug };
                    try { await cacheSet(`search:${animeTitle}:${episodeNumber}`, result, 300_000); } catch {}
                    return result;
                  } else {
                    console.log(`⚠️ Season-specific slug page exists but title mismatch (similarity: ${similarity.toFixed(2)})`);
                  }
                }
              } catch (e) {
                // ignore and fall back to base slug
              }
            }

            const slugUrl = `${this.BASE_URL}/${baseSlug}-episode-${episodeNumber}/`;
            console.log(`🔗 Using cached 9anime slug: ${slugUrl}`);
            try {
              const testResp = await axios.get(slugUrl, {
                headers: { "User-Agent": this.USER_AGENT },
                timeout: 5000,
                validateStatus: (s) => s < 500,
              });
              if (testResp.status === 200) {
                const result = { success: true, animeLink: slugUrl, animeId: baseSlug };
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

        let mergedServers = [{ name: "Server 1", url: episodeData.videoUrl, lang: "sub" }];
        try {
          const { data: currentEp } = await supabase
            .from("episodes")
            .select("video_servers")
            .eq("id", existing.id)
            .single();

          if (currentEp && Array.isArray(currentEp.video_servers)) {
            // Filter out any existing server with the same URL to prevent duplicates
            const otherServers = currentEp.video_servers.filter(
              s => s.url !== episodeData.videoUrl
            );
            mergedServers = [...otherServers, ...mergedServers];
          }
        } catch (dbErr) {
          console.warn("⚠️ Failed to merge existing video servers:", dbErr.message);
        }

        const { error } = await supabase
          .from("episodes")
          .update({
            video_url: episodeData.videoUrl,
            video_servers: mergedServers,
            duration: normalizeDuration(episodeData.duration),
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
        video_servers: [{ name: "Server 1", url: episodeData.videoUrl }],
        thumbnail_url: episodeData.thumbnailUrl,
        duration: normalizeDuration(episodeData.duration),
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
