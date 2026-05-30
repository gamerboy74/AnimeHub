#!/usr/bin/env node
/**
 * Backfill Script: Populate characters, descriptions, and voice actor profiles
 * for existing anime records using the AniList GraphQL API.
 *
 * Usage: node scripts/backfillCharacters.js
 *
 * Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simple .env parser (matching backfillTitles.js)
function loadEnv() {
  try {
    const envPath = join(__dirname, "..", ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) {
    console.error("Could not read .env:", e.message);
  }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const supaHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

// AniList GraphQL Character Query
const graphqlQuery = `
  query ($search: String) {
    Media(search: $search, type: ANIME) {
      id
      characters(sort: [ROLE, RELEVANCE], perPage: 25) {
        edges {
          id
          role
          voiceActors(language: JAPANESE) {
            id
            name { full native }
          }
          voiceActorRoles {
            voiceActor {
              id
              name { full native }
              language
            }
          }
          node {
            id
            name { full native alternative }
            image { large medium }
            description
          }
        }
      }
    }
  }
`;

// Helper: Normalize name for fuzzy duplicate matching
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[.,\-'"""'']/g, "") // strip punctuation
    .split(/[\s,]+/)             // split into words
    .filter((w) => w.length > 1)   // drop single letters
    .sort()                      // sort alphabetically
    .join(" ");
}

// Rate-limited post for AniList GraphQL
let lastAniListCall = 0;
async function anilistFetch(body, animeTitle, attempt = 1) {
  const now = Date.now();
  const wait = Math.max(0, 3000 - (now - lastAniListCall)); // 3 seconds between calls to avoid rate limits
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAniListCall = Date.now();

  try {
    const resp = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get("Retry-After") || "30");
      console.log(`   ⏳ Rate limited! Waiting ${retryAfter}s...`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return anilistFetch(body, animeTitle, attempt + 1);
    }

    if (!resp.ok) throw new Error(`AniList HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    if (attempt >= 3) throw err;
    console.warn(`   ⚠️ Fetch error on "${animeTitle}". Retrying in 10s (attempt ${attempt}/3)...`, err.message);
    await new Promise((r) => setTimeout(r, 10000));
    return anilistFetch(body, animeTitle, attempt + 1);
  }
}

async function main() {
  console.log("🔍 Querying anime list from Supabase...\n");

  // Fetch all anime
  const listResp = await fetch(
    `${SUPABASE_URL}/rest/v1/anime?select=id,title,title_romaji,title_english&order=title.asc`,
    { headers: supaHeaders }
  );

  if (!listResp.ok) {
    console.error("❌ Failed to fetch anime list:", listResp.status, await listResp.text());
    process.exit(1);
  }

  const animeList = await listResp.json();

  if (!Array.isArray(animeList) || animeList.length === 0) {
    console.log("✅ No anime found in database.");
    return;
  }

  console.log(`📋 Found ${animeList.length} anime. Checking character statuses...\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < animeList.length; i++) {
    const anime = animeList[i];
    const num = `[${i + 1}/${animeList.length}]`;
    const searchTitle = anime.title_english || anime.title_romaji || anime.title;

    try {
      // 1. Fetch existing characters for this anime
      const charResp = await fetch(
        `${SUPABASE_URL}/rest/v1/anime_characters?select=id,name,role,voice_actor,description&anime_id=eq.${anime.id}&limit=15`,
        { headers: supaHeaders }
      );

      const existingChars = charResp.ok ? await charResp.json() : [];

      // If we already have characters with descriptions & voice actors, skip
      if (existingChars && existingChars.length > 0) {
        const hasVoiceActors = existingChars.some((c) => c.voice_actor);
        const hasDescriptions = existingChars.some((c) => c.description);
        if (hasVoiceActors && hasDescriptions) {
          console.log(`${num} ⏭️ "${anime.title}" already has complete characters. Skipping.`);
          totalSkipped++;
          continue;
        }
      }

      console.log(`${num} 🔍 Backfilling characters for "${anime.title}"...`);

      // 2. Fetch characters from AniList
      const reqBody = JSON.stringify({
        query: graphqlQuery,
        variables: { search: searchTitle },
      });

      const gqlResult = await anilistFetch(reqBody, anime.title);
      const media = gqlResult?.data?.Media;

      if (!media?.characters?.edges || media.characters.edges.length === 0) {
        console.log(`   ⚠️ No characters found on AniList for "${anime.title}".`);
        totalSkipped++;
        continue;
      }

      // Filter characters: MAIN first, fall back to SUPPORTING (limit to top 12)
      let characterEdges = media.characters.edges.filter((char) => char.role === "MAIN");
      if (characterEdges.length === 0) {
        characterEdges = media.characters.edges
          .filter((char) => char.role === "SUPPORTING")
          .slice(0, 12);
      } else {
        // Add a few supporting if we only have a couple of main
        const supporting = media.characters.edges
          .filter((char) => char.role === "SUPPORTING")
          .slice(0, 12 - characterEdges.length);
        characterEdges = [...characterEdges, ...supporting];
      }

      // 3. Build lookup table of existing characters to avoid duplicates
      const existingByNorm = new Map();
      for (const ec of existingChars || []) {
        existingByNorm.set(normalizeName(ec.name), { id: ec.id, name: ec.name });
      }

      let successCount = 0;
      let errorCount = 0;

      for (const character of characterEdges) {
        try {
          const japaneseVA = character.voiceActors?.[0];
          const englishVARole = character.voiceActorRoles?.find(
            (r) => r.voiceActor?.language === "ENGLISH"
          );
          const englishVA = englishVARole?.voiceActor;

          const altNames = Array.isArray(character.node.name?.alternative)
            ? character.node.name.alternative.filter(Boolean).join(", ")
            : character.node.name?.alternative || null;

          const characterData = {
            anime_id: anime.id,
            name: character.node.name?.full || character.node.name?.native,
            name_japanese: character.node.name?.native || null,
            name_romaji: altNames,
            role: character.role?.toLowerCase() || "supporting",
            image_url: character.node.image?.large || character.node.image?.medium || null,
            description: character.node.description || null,
            voice_actor: englishVA?.name?.full || japaneseVA?.name?.full || null,
            voice_actor_japanese: japaneseVA?.name?.native || japaneseVA?.name?.full || null,
          };

          const normalizedNew = normalizeName(characterData.name);
          const existingMatch = existingByNorm.get(normalizedNew);

          if (existingMatch) {
            // Update existing record
            const updateHeaders = { ...supaHeaders, Prefer: "return=minimal" };
            const patchResp = await fetch(
              `${SUPABASE_URL}/rest/v1/anime_characters?id=eq.${existingMatch.id}`,
              {
                method: "PATCH",
                headers: updateHeaders,
                body: JSON.stringify({
                  name: characterData.name,
                  name_japanese: characterData.name_japanese,
                  name_romaji: characterData.name_romaji,
                  image_url: characterData.image_url,
                  description: characterData.description,
                  voice_actor: characterData.voice_actor,
                  voice_actor_japanese: characterData.voice_actor_japanese,
                }),
              }
            );

            if (patchResp.ok) {
              successCount++;
            } else {
              errorCount++;
            }
          } else {
            // Insert new record
            const postResp = await fetch(
              `${SUPABASE_URL}/rest/v1/anime_characters`,
              {
                method: "POST",
                headers: supaHeaders,
                body: JSON.stringify(characterData),
              }
            );

            if (postResp.ok) {
              successCount++;
              existingByNorm.set(normalizedNew, { id: "", name: characterData.name });
            } else {
              errorCount++;
            }
          }
        } catch (charErr) {
          console.error(`      ❌ Error processing character details:`, charErr.message);
          errorCount++;
        }
      }

      console.log(`   ✨ Updated/inserted ${successCount} characters for "${anime.title}". (${errorCount} errors)`);
      totalUpdated++;
    } catch (err) {
      console.log(`   ❌ Failed for "${anime.title}":`, err.message);
      totalFailed++;
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ Character backfill complete!`);
  console.log(`   Processed/Updated: ${totalUpdated}`);
  console.log(`   Skipped:           ${totalSkipped}`);
  console.log(`   Failed:            ${totalFailed}`);
  console.log(`   Total Anime:       ${animeList.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
