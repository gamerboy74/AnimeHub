import express from "express";
import { supabase } from "../config/supabase.js";
import { cacheMiddleware } from "../services/cache.js";

const router = express.Router();

// Featured anime (highest rated)
router.get("/api/anime/featured", cacheMiddleware(120_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "5", 10);
    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .gte("rating", 8.0)
      .order("rating", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Featured anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Featured anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trending anime (recently added with good rating)
router.get("/api/anime/trending", cacheMiddleware(120_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "10", 10);
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .gte("created_at", thirtyDaysAgo)
      .gte("rating", 7.0)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Trending anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // Fallback if not enough data
    if (!data || data.length < limit) {
      const { data: fallbackData } = await supabase
        .from("anime")
        .select("*")
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(limit);

      return res.json({ success: true, data: fallbackData || [] });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Trending anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Popular anime (highest rated)
router.get("/api/anime/popular", cacheMiddleware(120_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "12", 10);
    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .not("rating", "is", null)
      .order("rating", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Popular anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Popular anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recent anime (newest first)
router.get("/api/anime/recent", cacheMiddleware(60_000), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "6", 10);
    const { data, error } = await supabase
      .from("anime")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Recent anime error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Recent anime error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get episodes for an anime
router.get(
  "/api/anime/:animeId/episodes",
  cacheMiddleware(5_000),
  async (req, res) => {
    try {
      const { animeId } = req.params;
      console.log("🔍 API: Getting episodes for anime ID:", animeId);

      const { data: episodes, error } = await supabase
        .from("episodes")
        .select("episode_number, title, video_url, created_at")
        .eq("anime_id", animeId)
        .order("episode_number");

      if (error) {
        console.error("❌ Database error:", error);
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }

      console.log("✅ Found episodes:", episodes?.length || 0);
      res.json({
        success: true,
        episodes: episodes || [],
      });
    } catch (error) {
      console.error("❌ Error getting episodes:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Helpers for related seasons prefix generation (matching getRelatedSeasons on client/server)
function generateFranchisePrefixes(title) {
  const prefixes = [title];

  // Split on common subtitle separators: ":", " - ", " – ", " — "
  const separatorSplit = title.split(/\s*[:\–\—]\s*|\s+-\s+/);
  if (separatorSplit.length > 1) {
    for (let i = separatorSplit.length - 1; i >= 1; i--) {
      const prefix = separatorSplit.slice(0, i).join(': ').trim();
      if (prefix && !prefixes.includes(prefix)) {
        prefixes.push(prefix);
      }
    }
  }

  // Strip last word progressively (minimum 2 words)
  const words = title.split(/\s+/);
  for (let len = words.length - 1; len >= 2; len--) {
    const prefix = words.slice(0, len).join(' ').trim();
    if (prefix && !prefixes.includes(prefix)) {
      prefixes.push(prefix);
    }
  }

  return prefixes;
}

// Get anime details with complete playable episodes and server sources
router.get(
  "/api/anime/:animeId",
  cacheMiddleware(60_000), // Cache for 1 minute
  async (req, res) => {
    try {
      const { animeId } = req.params;
      console.log("🔍 API: Fetching full anime details for ID:", animeId);

      const { data: anime, error } = await supabase
        .from("anime")
        .select(`
          *,
          episodes (
            id,
            episode_number,
            title,
            description,
            thumbnail_url,
            duration,
            video_url,
            video_servers,
            is_premium
          )
        `)
        .eq("id", animeId)
        .single();

      if (error || !anime) {
        console.error("❌ Anime fetch error:", error);
        return res.status(404).json({ success: false, error: "Anime not found" });
      }

      // Filter and sort playable episodes (those that have a playable video URL or sources)
      const playableEpisodes = (anime.episodes || [])
        .filter((ep) => ep?.video_url)
        .sort((a, b) => a.episode_number - b.episode_number);

      res.json({
        success: true,
        data: {
          ...anime,
          episodes: playableEpisodes,
        },
      });
    } catch (error) {
      console.error("❌ Error fetching anime details:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get related seasons with highly optimized sequential search to avoid database table scans
router.get(
  "/api/anime/:animeId/seasons",
  cacheMiddleware(7200_000), // Cache for 2 hours (relations rarely change)
  async (req, res) => {
    try {
      const { animeId } = req.params;
      const { title, titleEnglish } = req.query;

      if (!title) {
        return res.status(400).json({ success: false, error: "Missing title parameter" });
      }

      // Simple inline season info extraction helper (corresponds to client extractSeasonInfo)
      const extractSeasonInfo = (t) => {
        if (!t) return { baseTitle: "" };
        const baseTitle = t
          .replace(/\s+(Season|S)\s*\d+/gi, "")
          .replace(/\s+\d{4}/g, "")
          .replace(/\s+(Movie|OVA|ONA|Special)/gi, "")
          .trim();
        return { baseTitle };
      };

      const infoEng = titleEnglish ? extractSeasonInfo(titleEnglish) : null;
      const infoRaw = extractSeasonInfo(title);
      const baseTitle = infoEng?.baseTitle || infoRaw.baseTitle;

      if (!baseTitle || baseTitle.length < 3) {
        return res.json({ success: true, data: [] });
      }

      const searchCandidates = generateFranchisePrefixes(baseTitle);
      const validCandidates = searchCandidates.filter((c) => c.length >= 3);

      console.log(`🔍 [Seasons API] Franchise search candidates for "${baseTitle}":`, validCandidates);

      let finalData = [];
      let firstCandidateResult = null;

      // Sequential search: run longest candidates first, return early if we find a good group (2+ seasons)
      // This completely saves DB overhead compared to firing N parallel table scans!
      for (let i = 0; i < validCandidates.length; i++) {
        const candidate = validCandidates[i];
        const escapedBase = candidate.replace(/[%_]/g, "\\$&");

        const { data, error } = await supabase
          .from("anime")
          .select("id, title, title_english, poster_url, total_episodes, type")
          .or(`title.ilike.%${escapedBase}%,title_english.ilike.%${escapedBase}%`)
          .order("title", { ascending: true });

        if (error) {
          console.error(`❌ [Seasons API] Query error for candidate "${candidate}":`, error);
          continue;
        }

        if (data && data.length >= 2) {
          console.log(`✅ [Seasons API] Found franchise group of ${data.length} entries with candidate "${candidate}"`);
          finalData = data;
          break;
        }

        if (i === 0 && data && data.length > 0) {
          firstCandidateResult = data;
        }
      }

      // Fallback to first candidate result if no multi-season group was found
      if (finalData.length === 0 && firstCandidateResult) {
        finalData = firstCandidateResult;
      }

      res.json({ success: true, data: finalData });
    } catch (error) {
      console.error("❌ [Seasons API] Error fetching related seasons:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

export default router;
