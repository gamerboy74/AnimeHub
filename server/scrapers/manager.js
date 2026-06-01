import { supabase } from "../config/supabase.js";
import { enqueue } from "../services/queue.js";
import { cacheGet, cacheSet, cacheInvalidateAnime } from "../services/cache.js";
import { NineAnimeScraperService } from "./nineanime.js";
import { ReAnimeScraperService } from "./reanime.js";
import { SanjiAnimeScraperService } from "./sanjianime.js";
import { AnimeSugeScraperService } from "./animesuge.js";
import { CinevoScraperService } from "./cinevo.js";
import { getScraperConfigs } from "../utils/scraper-config.js";
import stateManager from "../services/state-manager.js";

const activeScrapes = new Set();

export function isGenericTitle(title, episodeNumber, animeTitle) {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  const lowerAnime = (animeTitle || '').trim().toLowerCase();

  if (t === `episode ${episodeNumber}`) return true;
  if (t === `episode-${episodeNumber}`) return true;
  if (t === `ep ${episodeNumber}`) return true;
  if (t === `ep-${episodeNumber}`) return true;
  if (lowerAnime && (
    t === `${lowerAnime} - episode ${episodeNumber}` ||
    t === `${lowerAnime} - ep ${episodeNumber}` ||
    t === `${lowerAnime} episode ${episodeNumber}` ||
    t === `${lowerAnime} ep ${episodeNumber}`
  )) return true;

  const genericPatterns = [
    /^\s*episode\s*\d+\s*$/i,
    /^\s*ep\s*\d+\s*$/i,
    /^\s*episode\s*-\s*\d+\s*$/i,
    /^\s*ep\s*-\s*\d+\s*$/i
  ];
  if (genericPatterns.some(p => p.test(t))) return true;

  return false;
}

export function isGenericDescription(desc, episodeNumber, animeTitle) {
  if (!desc) return true;
  const d = desc.trim().toLowerCase();
  const lowerAnime = (animeTitle || '').trim().toLowerCase();

  if (d.includes('scraped from')) return true;
  if (d === `episode ${episodeNumber} of ${lowerAnime}`) return true;
  if (d === `episode ${episodeNumber}`) return true;
  return false;
}

export function mergeVideoServers(existingServers, newServers) {
  const merged = [];
  const urlsSeen = new Set();

  const addServer = (s) => {
    if (!s || !s.url) return;
    const cleanUrl = s.url.trim();
    if (urlsSeen.has(cleanUrl)) return;
    urlsSeen.add(cleanUrl);
    merged.push({
      name: s.name || "Server",
      url: cleanUrl,
      lang: (s.lang || "sub").toLowerCase()
    });
  };

  if (Array.isArray(existingServers)) {
    existingServers.forEach(addServer);
  }

  if (Array.isArray(newServers)) {
    newServers.forEach(addServer);
  }

  const subs = merged.filter(s => s.lang === "sub");
  const dubs = merged.filter(s => s.lang === "dub");

  subs.forEach((s, index) => {
    s.name = `SUB ${index + 1}`;
  });

  dubs.forEach((s, index) => {
    s.name = `DUB ${index + 1}`;
  });

  return [...subs, ...dubs];
}

/**
 * Executes the sequential scraping pipeline across all 4 scrapers for a single episode,
 * merges/deduplicates the servers, writes the updates to Supabase, and invalidates anime caches.
 */
export async function scrapeAndSaveEpisode(anime, ep) {
  const activeKey = `${anime.id}:${ep}`;
  if (activeScrapes.has(activeKey)) {
    console.log(`⚠️ Scrape already active for "${anime.title}" EP ${ep}. Skipping duplicate call.`);
    return { success: true, skipped: true, reason: "Scrape in progress" };
  }

  try {
    activeScrapes.add(activeKey);
    const animeTitle = anime.title;
    console.log(`  🔍 Checking "${animeTitle}" EP ${ep}…`);
    const newServers = [];

    // Load dynamic configurations for the scraper pipeline
    const configs = await getScraperConfigs();
    const activeConfigs = configs.filter(c => c.enabled);
    console.log(`🤖 Scraping pipeline: active scrapers in order are: ${activeConfigs.map(c => c.name).join(" -> ")}`);

    let nineAnimeRes = null;
    let animeSugeRes = null;
    let reAnimeRes = null;
    let sanjiAnimeRes = null;
    let cinevoRes = null;

    for (let i = 0; i < activeConfigs.length; i++) {
      const config = activeConfigs[i];
      const { id, timeout, delay } = config;
      const startTime = Date.now();
      const serversBefore = newServers.length;

      if (i > 0 && delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }

      if (id === "nineanime") {
        // 1. Try NineAnimeScraperService
        try {
          const isNotFoundCached = await cacheGet(`notfound:nineanime:${anime.id}`);
          if (isNotFoundCached) {
            console.log(`    ⏭️ NineAnime skipped (cached as not_found in-memory)`);
          } else {
            console.log(`    [Pipeline] NineAnime checking EP ${ep}...`);
            nineAnimeRes = await enqueue(() =>
              NineAnimeScraperService.scrapeAnimeEpisode(
                animeTitle,
                ep,
                { timeout: timeout || 45000, retries: 2, dbAnimeId: anime.id }
              ),
              "high"
            );
            if (nineAnimeRes?.success && nineAnimeRes.streamUrl) {
              newServers.push({
                name: "NineAnime",
                url: nineAnimeRes.streamUrl,
                lang: "sub"
              });
              console.log(`    ✅ NineAnime found a stream URL`);
            } else {
              console.log(`    ❌ NineAnime did not find a stream URL`);
              if (ep === 1) {
                try {
                  await cacheSet(`notfound:nineanime:${anime.id}`, true, 3600000); // 1 hour TTL
                  console.log(`    💾 NineAnime marked as not_found in-memory cache`);
                } catch (e) {
                  console.warn("    ⚠️ NineAnime not_found cache save failed:", e.message);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`    ⚠️ NineAnime failed for EP ${ep}:`, err.message);
        }
      } else if (id === "animesuge") {
        // 2. Try AnimeSugeScraperService
        try {
          console.log(`    [Pipeline] AnimeSuge checking EP ${ep}...`);
          const cacheKey = "animesuge_watch";
          const cachedWatchUrl = anime.scraper_urls?.[cacheKey];

          const isNotFoundCached = await cacheGet(`notfound:animesuge:${anime.id}`);

          if (isNotFoundCached) {
            console.log(`    ⏭️ AnimeSuge skipped (cached as not_found in-memory)`);
          } else if (cachedWatchUrl === "not_found") {
            // Self-clean database of legacy permanent not_found values
            try {
              const merged = { ...(anime.scraper_urls || {}) };
              delete merged[cacheKey];
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
              anime.scraper_urls = merged;
              console.log(`    🧹 Cleaned legacy "not_found" AnimeSuge watch URL from database for anime ${anime.id}`);
            } catch (e) { }
          } else {
            const resolvedUrl = cachedWatchUrl || animeTitle;
            const isFromCache = !!cachedWatchUrl;

            animeSugeRes = await enqueue(() =>
              AnimeSugeScraperService.scrapeAnimeEpisode(resolvedUrl, ep, {
                timeout: timeout || 45000,
                retries: 2,
                dbAnimeId: anime.id
              }),
              "high"
            );

            // If cache failure retry
            if ((!animeSugeRes || !animeSugeRes.success) && isFromCache) {
              console.warn(`    ⚠️ Cached AnimeSuge URL failed. Clearing cache and retrying search...`);
              try {
                const { data: existing } = await supabase
                  .from("anime")
                  .select("scraper_urls")
                  .eq("id", anime.id)
                  .single();
                const currentCache = existing?.scraper_urls || {};
                delete currentCache[cacheKey];
                await supabase.from("anime").update({ scraper_urls: currentCache }).eq("id", anime.id);
                anime.scraper_urls = currentCache;
              } catch (err) {
                console.warn("    ⚠️ Failed to clear AnimeSuge cache on error:", err.message);
              }

              animeSugeRes = await enqueue(() =>
                AnimeSugeScraperService.scrapeAnimeEpisode(animeTitle, ep, {
                  timeout: timeout || 45000,
                  retries: 2,
                  dbAnimeId: anime.id
                }),
                "high"
              );
            }

            if (animeSugeRes?.success) {
              const scrapeLang = animeSugeRes.episodeData?.lang || "sub";
              const list = (animeSugeRes.episodeData?.sources || []).map((source) => ({
                name: source.label || "AnimeSuge Server",
                url: source.iframeUrl || animeSugeRes.streamUrl,
                lang: (source.lang || scrapeLang).toLowerCase(),
              }));
              if (list.length === 0 && animeSugeRes.streamUrl) {
                list.push({
                  name: "AnimeSuge active",
                  url: animeSugeRes.streamUrl,
                  lang: scrapeLang.toLowerCase(),
                });
              }
              if (list.length > 0) {
                newServers.push(...list);
                console.log(`    ✅ AnimeSuge found ${list.length} stream URL(s)`);
              } else {
                console.log(`    ❌ AnimeSuge did not find a stream URL`);
              }

              // Cache watch URL if found and successful
              if (animeSugeRes.watchUrl) {
                try {
                  const urlObj = new URL(animeSugeRes.watchUrl);
                  urlObj.pathname = urlObj.pathname.replace(/\/ep-\d+$/i, "");
                  const baseWatchUrl = urlObj.toString();
                  if (anime.scraper_urls?.[cacheKey] !== baseWatchUrl) {
                    const merged = { ...(anime.scraper_urls || {}), [cacheKey]: baseWatchUrl };
                    await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
                    anime.scraper_urls = merged;
                    console.log(`    💾 AnimeSuge watch URL cached: ${baseWatchUrl}`);
                  }
                } catch (e) {
                  console.warn("    ⚠️ AnimeSuge cache save failed:", e.message);
                }
              }
            } else {
              console.log(`    ❌ AnimeSuge did not succeed`);
              const errorMsg = animeSugeRes?.error || "";
              if (
                ep === 1 ||
                errorMsg.includes("Could not find a secure search result") ||
                errorMsg.includes("No results found")
              ) {
                try {
                  await cacheSet(`notfound:animesuge:${anime.id}`, true, 3600000); // 1 hour TTL
                  console.log(`    💾 AnimeSuge marked as not_found in-memory cache`);
                } catch (e) {
                  console.warn("    ⚠️ AnimeSuge not_found cache save failed:", e.message);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`    ⚠️ AnimeSuge failed for EP ${ep}:`, err.message);
        }
      } else if (id === "reanime") {
        // 3. Try ReAnimeScraperService
        try {
          console.log(`    [Pipeline] Re:ANIME checking EP ${ep}...`);
          const cacheKey = "reanime_watch";
          const cachedWatchUrl = anime.scraper_urls?.[cacheKey];

          const isNotFoundCached = await cacheGet(`notfound:reanime:${anime.id}`);

          if (isNotFoundCached) {
            console.log(`    ⏭️ Re:ANIME skipped (cached as not_found in-memory)`);
          } else if (cachedWatchUrl === "not_found") {
            // Self-clean database of legacy permanent not_found values
            try {
              const merged = { ...(anime.scraper_urls || {}) };
              delete merged[cacheKey];
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
              anime.scraper_urls = merged;
              console.log(`    🧹 Cleaned legacy "not_found" Re:ANIME watch URL from database for anime ${anime.id}`);
            } catch (e) { }
          } else {
            const resolvedUrl = cachedWatchUrl || animeTitle;
            const isFromCache = !!cachedWatchUrl;

            reAnimeRes = await enqueue(() =>
              ReAnimeScraperService.scrapeAnimeEpisode(resolvedUrl, ep, {
                timeout: timeout || 40000,
                retries: 2,
                dbAnimeId: anime.id
              }),
              "high"
            );

            // If cache failure retry
            if ((!reAnimeRes || !reAnimeRes.success) && isFromCache) {
              console.warn(`    ⚠️ Cached Re:ANIME URL failed. Clearing cache and retrying search...`);
              try {
                const { data: existing } = await supabase
                  .from("anime")
                  .select("scraper_urls")
                  .eq("id", anime.id)
                  .single();
                const currentCache = existing?.scraper_urls || {};
                delete currentCache[cacheKey];
                await supabase.from("anime").update({ scraper_urls: currentCache }).eq("id", anime.id);
                anime.scraper_urls = currentCache;
              } catch (err) {
                console.warn("    ⚠️ Failed to clear Re:ANIME cache on error:", err.message);
              }

              reAnimeRes = await enqueue(() =>
                ReAnimeScraperService.scrapeAnimeEpisode(animeTitle, ep, {
                  timeout: timeout || 40000,
                  retries: 2,
                  dbAnimeId: anime.id
                }),
                "high"
              );
            }

            if (reAnimeRes?.success) {
              const scrapeLang = reAnimeRes.episodeData?.lang || "sub";
              const list = (reAnimeRes.episodeData?.sources || []).map(s => ({
                name: s.label || "Re:ANIME Server",
                url: s.iframeUrl || reAnimeRes.streamUrl,
                lang: s.lang || scrapeLang
              }));
              if (list.length === 0 && reAnimeRes.streamUrl) {
                list.push({
                  name: "Re:ANIME active",
                  url: reAnimeRes.streamUrl,
                  lang: scrapeLang
                });
              }
              if (list.length > 0) {
                newServers.push(...list);
                console.log(`    ✅ Re:ANIME found ${list.length} stream URL(s)`);
              } else {
                console.log(`    ❌ Re:ANIME did not find a stream URL`);
              }

              // Cache watch URL if found and successful
              if (reAnimeRes.watchUrl) {
                try {
                  const watchBase = new URL(reAnimeRes.watchUrl);
                  watchBase.searchParams.delete("ep");
                  watchBase.searchParams.delete("lang");
                  const baseWatchUrl = watchBase.toString();
                  if (anime.scraper_urls?.[cacheKey] !== baseWatchUrl) {
                    const merged = { ...(anime.scraper_urls || {}), [cacheKey]: baseWatchUrl };
                    await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
                    anime.scraper_urls = merged;
                    console.log(`    💾 Re:ANIME watch URL cached: ${baseWatchUrl}`);
                  }
                } catch (e) {
                  console.warn("    ⚠️ Re:ANIME cache save failed:", e.message);
                }
              }
            } else {
              console.log(`    ❌ Re:ANIME did not succeed`);
              const errorMsg = reAnimeRes?.error || "";
              if (
                ep === 1 ||
                errorMsg.includes("Could not find a secure search result") ||
                errorMsg.includes("No results found") ||
                errorMsg.toLowerCase().includes("cloudflare turnstile")
              ) {
                try {
                  await cacheSet(`notfound:reanime:${anime.id}`, true, 3600000); // 1 hour TTL
                  console.log(`    💾 Re:ANIME marked as not_found in-memory cache`);
                } catch (e) {
                  console.warn("    ⚠️ Re:ANIME not_found cache save failed:", e.message);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`    ⚠️ Re:ANIME failed for EP ${ep}:`, err.message);
        }
      } else if (id === "sanjianime") {
        // 4. Try SanjiAnimeScraperService
        try {
          console.log(`    [Pipeline] SanjiAnime checking EP ${ep}...`);
          const cacheKey = "sanjianime_watch";
          const cachedWatchUrl = anime.scraper_urls?.[cacheKey];

          const isNotFoundCached = await cacheGet(`notfound:sanjianime:${anime.id}`);

          if (isNotFoundCached) {
            console.log(`    ⏭️ SanjiAnime skipped (cached as not_found in-memory)`);
          } else if (cachedWatchUrl === "not_found") {
            // Self-clean database of legacy permanent not_found values
            try {
              const merged = { ...(anime.scraper_urls || {}) };
              delete merged[cacheKey];
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
              anime.scraper_urls = merged;
              console.log(`    🧹 Cleaned legacy "not_found" SanjiAnime watch URL from database for anime ${anime.id}`);
            } catch (e) { }
          } else {
            const resolvedUrl = cachedWatchUrl || animeTitle;
            const isFromCache = !!cachedWatchUrl;

            sanjiAnimeRes = await enqueue(() =>
              SanjiAnimeScraperService.scrapeAnimeEpisode(resolvedUrl, ep, {
                timeout: timeout || 40000,
                retries: 2,
                dbAnimeId: anime.id
              }),
              "high"
            );

            // If cache failure retry
            if ((!sanjiAnimeRes || !sanjiAnimeRes.success) && isFromCache) {
              console.warn(`    ⚠️ Cached SanjiAnime URL failed. Clearing cache and retrying search...`);
              try {
                const { data: existing } = await supabase
                  .from("anime")
                  .select("scraper_urls")
                  .eq("id", anime.id)
                  .single();
                const currentCache = existing?.scraper_urls || {};
                delete currentCache[cacheKey];
                await supabase.from("anime").update({ scraper_urls: currentCache }).eq("id", anime.id);
                anime.scraper_urls = currentCache;
              } catch (err) {
                console.warn("    ⚠️ Failed to clear SanjiAnime cache on error:", err.message);
              }

              sanjiAnimeRes = await enqueue(() =>
                SanjiAnimeScraperService.scrapeAnimeEpisode(animeTitle, ep, {
                  timeout: timeout || 40000,
                  retries: 2,
                  dbAnimeId: anime.id
                }),
                "high"
              );
            }

            if (sanjiAnimeRes?.success) {
              const scrapeLang = sanjiAnimeRes.episodeData?.lang || "unknown";
              const list = (sanjiAnimeRes.episodeData?.sources || []).map((source) => ({
                name: source.label || "Sanji Anime Server",
                url: source.playableUrl || source.iframeUrl || source.url || sanjiAnimeRes.streamUrl,
                lang: (source.lang || scrapeLang).toLowerCase(),
              }));
              if (list.length === 0 && sanjiAnimeRes.streamUrl) {
                list.push({
                  name: "Sanji Anime active",
                  url: sanjiAnimeRes.streamUrl,
                  lang: scrapeLang.toLowerCase(),
                });
              }
              if (list.length > 0) {
                newServers.push(...list);
                console.log(`    ⚠️ SanjiAnime found ${list.length} stream URL(s)`);
              } else {
                console.log(`    ❌ SanjiAnime did not find a stream URL`);
              }

              // Cache watch URL if found and successful
              if (sanjiAnimeRes.watchUrl) {
                try {
                  if (anime.scraper_urls?.[cacheKey] !== sanjiAnimeRes.watchUrl) {
                    const merged = { ...(anime.scraper_urls || {}), [cacheKey]: sanjiAnimeRes.watchUrl };
                    await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
                    anime.scraper_urls = merged;
                    console.log(`    💾 Sanji Anime watch URL cached: ${sanjiAnimeRes.watchUrl}`);
                  }
                } catch (e) {
                  console.warn("    ⚠️ Sanji Anime cache save failed:", e.message);
                }
              }
            } else {
              console.log(`    ❌ SanjiAnime did not succeed`);
              const errorMsg = sanjiAnimeRes?.error || "";
              if (
                ep === 1 ||
                errorMsg.includes("Could not find a secure search result") ||
                errorMsg.includes("No results found")
              ) {
                try {
                  await cacheSet(`notfound:sanjianime:${anime.id}`, true, 3600000); // 1 hour TTL
                  console.log(`    💾 SanjiAnime marked as not_found in-memory cache`);
                } catch (e) {
                  console.warn("    ⚠️ SanjiAnime not_found cache save failed:", e.message);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`    ⚠️ SanjiAnime failed for EP ${ep}:`, err.message);
        }
      } else if (id === "cinevo") {
        // 5. Try CinevoScraperService
        try {
          console.log(`    [Pipeline] Cinevo checking EP ${ep}...`);
          const cacheKey = "cinevo_watch";
          const cachedWatchUrl = anime.scraper_urls?.[cacheKey];

          const isNotFoundCached = await cacheGet(`notfound:cinevo:${anime.id}`);

          if (isNotFoundCached) {
            console.log(`    ⏭️ Cinevo skipped (cached as not_found in-memory)`);
          } else if (cachedWatchUrl === "not_found") {
            // Self-clean database of legacy permanent not_found values
            try {
              const merged = { ...(anime.scraper_urls || {}) };
              delete merged[cacheKey];
              await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
              anime.scraper_urls = merged;
              console.log(`    🧹 Cleaned legacy "not_found" Cinevo watch URL from database for anime ${anime.id}`);
            } catch (e) { }
          } else {
            const resolvedUrl = cachedWatchUrl || animeTitle;
            const isFromCache = !!cachedWatchUrl;

            cinevoRes = await enqueue(() =>
              CinevoScraperService.scrapeAnimeEpisode(resolvedUrl, ep, {
                timeout: timeout || 45000,
                retries: 2,
                dbAnimeId: anime.id
              }),
              "high"
            );

            // If cache failure retry
            if ((!cinevoRes || !cinevoRes.success) && isFromCache) {
              console.warn(`    ⚠️ Cached Cinevo URL failed. Clearing cache and retrying search...`);
              try {
                const { data: existing } = await supabase
                  .from("anime")
                  .select("scraper_urls")
                  .eq("id", anime.id)
                  .single();
                const currentCache = existing?.scraper_urls || {};
                delete currentCache[cacheKey];
                await supabase.from("anime").update({ scraper_urls: currentCache }).eq("id", anime.id);
                anime.scraper_urls = currentCache;
              } catch (err) {
                console.warn("    ⚠️ Failed to clear Cinevo cache on error:", err.message);
              }

              cinevoRes = await enqueue(() =>
                CinevoScraperService.scrapeAnimeEpisode(animeTitle, ep, {
                  timeout: timeout || 45000,
                  retries: 2,
                  dbAnimeId: anime.id
                }),
                "high"
              );
            }

            if (cinevoRes?.success) {
              const scrapeLang = cinevoRes.episodeData?.lang || "sub";
              const list = (cinevoRes.episodeData?.sources || []).map((source) => ({
                name: source.label ? `Cinevo - ${source.label}` : "Cinevo Server",
                url: source.playableUrl || source.iframeUrl || source.url || cinevoRes.streamUrl,
                lang: (source.lang || scrapeLang).toLowerCase(),
              }));
              if (list.length === 0 && cinevoRes.streamUrl) {
                list.push({
                  name: "Cinevo active",
                  url: cinevoRes.streamUrl,
                  lang: scrapeLang.toLowerCase(),
                });
              }
              if (list.length > 0) {
                newServers.push(...list);
                console.log(`    ✅ Cinevo found ${list.length} stream URL(s)`);
              } else {
                console.log(`    ❌ Cinevo did not find a stream URL`);
              }

              // Cache watch URL if found and successful
              if (cinevoRes.watchUrl) {
                try {
                  const watchBase = new URL(cinevoRes.watchUrl);
                  watchBase.searchParams.delete("ep");
                  watchBase.searchParams.delete("season");
                  const baseWatchUrl = watchBase.toString();
                  if (anime.scraper_urls?.[cacheKey] !== baseWatchUrl) {
                    const merged = { ...(anime.scraper_urls || {}), [cacheKey]: baseWatchUrl };
                    await supabase.from("anime").update({ scraper_urls: merged }).eq("id", anime.id);
                    anime.scraper_urls = merged;
                    console.log(`    💾 Cinevo watch URL cached: ${baseWatchUrl}`);
                  }
                } catch (e) {
                  console.warn("    ⚠️ Cinevo cache save failed:", e.message);
                }
              }
            } else {
              console.log(`    ❌ Cinevo did not succeed`);
              const errorMsg = cinevoRes?.error || "";
              if (
                ep === 1 ||
                errorMsg.includes("Could not find a secure search result") ||
                errorMsg.includes("No results found")
              ) {
                try {
                  await cacheSet(`notfound:cinevo:${anime.id}`, true, 3600000); // 1 hour TTL
                  console.log(`    💾 Cinevo marked as not_found in-memory cache`);
                } catch (e) {
                  console.warn("    ⚠️ Cinevo not_found cache save failed:", e.message);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`    ⚠️ Cinevo failed for EP ${ep}:`, err.message);
        }
      }

      // Record telemetry metrics and logs
      const elapsed = Date.now() - startTime;
      let scraperRes = null;
      if (id === "nineanime") scraperRes = nineAnimeRes;
      else if (id === "animesuge") scraperRes = animeSugeRes;
      else if (id === "reanime") scraperRes = reAnimeRes;
      else if (id === "sanjianime") scraperRes = sanjiAnimeRes;
      else if (id === "cinevo") scraperRes = cinevoRes;

      if (scraperRes) {
        let success = false;
        let error = null;
        if (scraperRes.success && (scraperRes.streamUrl || newServers.length > serversBefore)) {
          success = true;
        } else {
          error = scraperRes.error || "No stream found";
        }

        if (success) {
          await stateManager.recordScraperSuccess(id, elapsed);
          const addedServers = newServers.slice(serversBefore);
          const hasSub = addedServers.some(s => s.lang === 'sub');
          const hasDub = addedServers.some(s => s.lang === 'dub');
          let langStr = '';
          if (hasSub && hasDub) langStr = ' (Sub/Dub)';
          else if (hasSub) langStr = ' (Sub)';
          else if (hasDub) langStr = ' (Dub)';

          await stateManager.addLog(
            'success',
            `${config.name} successfully resolved ${animeTitle} EP ${ep}${langStr}.`
          );
        } else {
          await stateManager.recordScraperFailure(id, error || 'failed');
          if (error && (error.toLowerCase().includes('cloudflare') || error.toLowerCase().includes('turnstile'))) {
            await stateManager.addLog(
              'warn',
              `${config.name} failed: Cloudflare challenge detected.`
            );
          } else {
            await stateManager.addLog(
              'info',
              `${config.name} failed: ${error || 'no stream found'}.`
            );
          }
        }
      }
    }

  // Fetch the existing episode stub/record if it exists to merge/preserve data
  const { data: existingEpisode } = await supabase
    .from("episodes")
    .select("id, title, description, video_servers, thumbnail_url, duration, video_url, created_at")
    .eq("anime_id", anime.id)
    .eq("episode_number", ep)
    .maybeSingle();

  // Deduplicate the gathered servers by URL
  const uniqueNewServers = [];
  for (const s of newServers) {
    if (!s || !s.url) continue;
    if (!uniqueNewServers.some(exist => exist.url === s.url)) {
      uniqueNewServers.push(s);
    }
  }

  if (uniqueNewServers.length > 0) {
    const primaryVideoUrl = existingEpisode?.video_url || uniqueNewServers[0].url;
    const mergedServers = mergeVideoServers(existingEpisode?.video_servers, uniqueNewServers);

    // Handle title preservation
    let finalTitle = `${animeTitle} - Episode ${ep}`;
    if (existingEpisode?.title && !isGenericTitle(existingEpisode.title, ep, animeTitle)) {
      finalTitle = existingEpisode.title;
    }

    // Handle description preservation
    let finalDesc = `Episode ${ep} of ${animeTitle}`;
    if (existingEpisode?.description && !isGenericDescription(existingEpisode.description, ep, animeTitle)) {
      finalDesc = existingEpisode.description;
    }

    let finalThumbnail = existingEpisode?.thumbnail_url || anime.poster_url || null;

    let savedEpisode = null;
    if (existingEpisode) {
      const updatePayload = {
        video_url: primaryVideoUrl,
        video_servers: mergedServers,
        title: finalTitle,
        description: finalDesc,
        duration: existingEpisode.duration || 1440,
        created_at: new Date().toISOString(), // Touch the created_at timestamp to mark a recent successful scrape attempt
      };
      if (finalThumbnail) {
        updatePayload.thumbnail_url = finalThumbnail;
      }
      const { data, error: updateErr } = await supabase
        .from("episodes")
        .update(updatePayload)
        .eq("id", existingEpisode.id)
        .select()
        .single();
      if (updateErr) throw updateErr;
      savedEpisode = data;
      console.log(`  💾 Updated existing EP ${ep} in database and touched created_at`);
    } else {
      const insertPayload = {
        anime_id: anime.id,
        episode_number: ep,
        title: finalTitle,
        video_url: primaryVideoUrl,
        video_servers: mergedServers,
        duration: 1440,
        description: finalDesc,
        created_at: new Date().toISOString(),
      };
      if (finalThumbnail) {
        insertPayload.thumbnail_url = finalThumbnail;
      }
      const { data, error: insertErr } = await supabase
        .from("episodes")
        .insert(insertPayload)
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === "23505") {
          console.warn(`  ⚠️ Race condition detected: EP ${ep} already exists in database. Falling back to update...`);
          // Re-fetch existing episode to get correct ID and servers to merge
          const { data: refetched } = await supabase
            .from("episodes")
            .select("id, title, description, video_servers, thumbnail_url, duration, video_url")
            .eq("anime_id", anime.id)
            .eq("episode_number", ep)
            .maybeSingle();

          if (refetched) {
            const fallbackServers = mergeVideoServers(refetched.video_servers, uniqueNewServers);
            const fallbackVideoUrl = refetched.video_url || primaryVideoUrl;
            const { data: updatedData, error: updateErr } = await supabase
              .from("episodes")
              .update({
                video_url: fallbackVideoUrl,
                video_servers: fallbackServers,
                title: refetched.title && !isGenericTitle(refetched.title, ep, animeTitle) ? refetched.title : finalTitle,
                description: refetched.description && !isGenericDescription(refetched.description, ep, animeTitle) ? refetched.description : finalDesc,
                duration: refetched.duration || 1440,
                thumbnail_url: refetched.thumbnail_url || finalThumbnail || null,
                created_at: new Date().toISOString(), // Touch the created_at timestamp on race condition update
              })
              .eq("id", refetched.id)
              .select()
              .single();
            if (updateErr) throw updateErr;
            savedEpisode = updatedData;
            console.log(`  💾 Updated existing EP ${ep} in database after resolving insert race condition`);
          } else {
            throw insertErr;
          }
        } else {
          throw insertErr;
        }
      } else {
        savedEpisode = data;
        console.log(`  💾 Inserted new EP ${ep} in database`);
      }
    }

    cacheInvalidateAnime(anime.id);

    // Update total_episodes in anime table if we found a new high
    const newTotal = Math.max(anime.total_episodes || 0, ep);
    if (newTotal > (anime.total_episodes || 0)) {
      await supabase
        .from('anime')
        .update({ total_episodes: newTotal, updated_at: new Date().toISOString() })
        .eq('id', anime.id);
      anime.total_episodes = newTotal; // Update local ref
    }

    return { success: true, episode: savedEpisode, serversCount: uniqueNewServers.length };
  } else {
    console.log(`  ℹ️ No stream URLs found for EP ${ep} across all 4 scrapers.`);
    // If the episode record already exists, touch its created_at timestamp to cool down re-scraping
    if (existingEpisode) {
      try {
        await supabase
          .from("episodes")
          .update({ created_at: new Date().toISOString() })
          .eq("id", existingEpisode.id);
        console.log(`  💾 Touched EP ${ep} created_at in database to cool down re-scraping`);
      } catch (err) {
        console.warn("  ⚠️ Failed to touch EP created_at:", err.message);
      }
    }
    return { success: false, reason: "No streams found" };
  }
  } finally {
    activeScrapes.delete(activeKey);
  }
}
