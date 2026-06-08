import axios from "axios";
import { redisClient } from "../services/bull-queue.js";

// In-memory cache fallback for AniList schedules
const localScheduleCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // Cache AniList schedules for 2 hours

/**
 * Fetch schedule from AniList with robust title/MAL fallback query
 */
async function fetchScheduleFromAniList(anime) {
  const cacheKey = `anilist:schedule:${anime.id}`;

  // 1. Try Redis cache first
  if (redisClient.isOpen) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn("⚠️ Redis get failed for AniList cache:", err.message);
    }
  }

  // 2. Try local cache
  const localCached = localScheduleCache.get(anime.id);
  if (localCached && Date.now() < localCached.expiry) {
    return localCached.schedule;
  }

  console.log(`📡 Querying AniList GraphQL API for "${anime.title_english || anime.title}"...`);

  const query = `
    query ($idMal: Int, $search: String) {
      Media (idMal: $idMal, search: $search, type: ANIME) {
        id
        idMal
        status
        title {
          romaji
          english
        }
        nextAiringEpisode {
          airingAt
          timeUntilAiring
          episode
        }
        airingSchedule (page: 1, perPage: 50) {
          nodes {
            airingAt
            episode
          }
        }
      }
    }
  `;

  const variables = {};
  if (anime.mal_id) {
    variables.idMal = anime.mal_id;
  } else {
    variables.search = anime.title_english || anime.title;
  }

  try {
    const response = await axios.post(
      "https://graphql.anilist.co",
      { query, variables },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 8000,
      }
    );

    const media = response.data?.data?.Media;
    if (!media) {
      throw new Error("No media matched on AniList");
    }

    const scheduleData = {
      status: media.status,
      nextAiringEpisode: media.nextAiringEpisode,
      airingSchedule: media.airingSchedule?.nodes || [],
    };

    // Store in local cache
    localScheduleCache.set(anime.id, {
      schedule: scheduleData,
      expiry: Date.now() + CACHE_TTL_MS,
    });

    // Store in Redis
    if (redisClient.isOpen) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(scheduleData), {
          EX: 7200, // 2 hours
        });
      } catch (err) {
        console.warn("⚠️ Redis set failed for AniList cache:", err.message);
      }
    }

    return scheduleData;
  } catch (err) {
    console.warn(
      `⚠️ AniList query failed for "${anime.title_english || anime.title}":`,
      err.message
    );
    // If query failed by MAL ID, try a title-based search fallback once
    if (anime.mal_id && !variables.search) {
      const fallbackVars = { search: anime.title_english || anime.title };
      try {
        const response = await axios.post(
          "https://graphql.anilist.co",
          { query, variables: fallbackVars },
          { timeout: 5000 }
        );
        const media = response.data?.data?.Media;
        if (media) {
          const scheduleData = {
            status: media.status,
            nextAiringEpisode: media.nextAiringEpisode,
            airingSchedule: media.airingSchedule?.nodes || [],
          };
          localScheduleCache.set(anime.id, { schedule: scheduleData, expiry: Date.now() + CACHE_TTL_MS });
          return scheduleData;
        }
      } catch (e) {
        console.warn(`⚠️ AniList title fallback query also failed:`, e.message);
      }
    }
    return null;
  }
}

/**
 * Smartly check if a specific episode has been released on AniList and is ready to scrape (15 mins cooldown)
 */
export async function isEpisodeReleased(anime, episodeNumber) {
  // If completed or not ongoing, default to true (all episodes released)
  if (anime.status !== "ongoing") {
    return { released: true };
  }

  const schedule = await fetchScheduleFromAniList(anime);
  if (!schedule) {
    // Graceful fallback: If we can't fetch schedule, let it scrape
    return { released: true, reason: "Schedule check failed, falling back to permissive scraping." };
  }

  // 1. Look for the target episode in the schedule array
  const targetNode = schedule.airingSchedule.find((n) => n.episode === episodeNumber);
  const cooldownPeriodMs = 15 * 60 * 1000; // Try scraping 15 minutes after airing

  if (targetNode) {
    const airingTimeMs = targetNode.airingAt * 1000;
    const now = Date.now();
    const readyTimeMs = airingTimeMs + cooldownPeriodMs;

    if (now < readyTimeMs) {
      const remainingMs = readyTimeMs - now;
      const minutesRemaining = Math.ceil(remainingMs / 60000);
      return {
        released: false,
        airingAt: airingTimeMs,
        readyAt: readyTimeMs,
        reason: `Episode ${episodeNumber} is scheduled to air at ${new Date(airingTimeMs).toLocaleTimeString()} (scraping delayed until 15 minutes after release, ready in ${minutesRemaining} minutes).`,
      };
    }
    return { released: true };
  }

  // 2. Fallback to checking nextAiringEpisode field
  const next = schedule.nextAiringEpisode;
  if (next) {
    if (episodeNumber >= next.episode) {
      // The episode has NOT aired yet because it matches or exceeds the NEXT airing episode number
      const nextAiringTimeMs = next.airingAt * 1000;
      const readyTimeMs = nextAiringTimeMs + cooldownPeriodMs;
      const remainingMs = readyTimeMs - Date.now();
      const minutesRemaining = Math.ceil(remainingMs / 60000);

      return {
        released: false,
        airingAt: nextAiringTimeMs,
        readyAt: readyTimeMs,
        reason: `Episode ${episodeNumber} has not aired yet. Next airing is EP ${next.episode} at ${new Date(nextAiringTimeMs).toLocaleTimeString()} (ready in ${minutesRemaining} minutes).`,
      };
    }
  }

  // If no future airing matching is found, assume it has released
  return { released: true };
}
