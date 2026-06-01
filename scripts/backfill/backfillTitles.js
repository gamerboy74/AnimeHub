#!/usr/bin/env node
/**
 * Backfill Script: Populate title_english, mal_id, and title_synonyms
 * for existing anime records using the Jikan (MyAnimeList) API.
 *
 * Usage: node scripts/backfillTitles.js
 *
 * Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simple .env parser (no dotenv dependency needed)
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
const JIKAN_BASE = "https://api.jikan.moe/v4";

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

// Rate-limited fetch for Jikan (3 req/sec limit)
let lastJikanCall = 0;
async function jikanFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, 350 - (now - lastJikanCall)); // ~3 req/sec
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastJikanCall = Date.now();

  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (resp.status === 429) {
    console.log("   ⏳ Rate limited, waiting 2s...");
    await new Promise((r) => setTimeout(r, 2000));
    return jikanFetch(url); // Retry
  }
  if (!resp.ok) throw new Error(`Jikan ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

// Title similarity for picking the best Jikan match
function similarity(a, b) {
  if (!a || !b) return 0;
  const norm = (s) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const na = norm(a),
    nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(" ").filter((w) => w.length > 1));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 1));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(wa.size, wb.size);
}

async function main() {
  console.log("🔍 Fetching anime records missing title_english...\n");

  // Fetch all anime needing backfill
  const listResp = await fetch(
    `${SUPABASE_URL}/rest/v1/anime?select=id,title,title_japanese,title_romaji&title_english=is.null&order=title.asc&limit=200`,
    { headers: supaHeaders }
  );
  const animeList = await listResp.json();

  if (!Array.isArray(animeList) || animeList.length === 0) {
    console.log("✅ Nothing to backfill — all anime already have title_english.");
    return;
  }

  console.log(`📋 Found ${animeList.length} anime to backfill.\n`);

  let updated = 0,
    skipped = 0,
    failed = 0;

  for (let i = 0; i < animeList.length; i++) {
    const anime = animeList[i];
    const num = `[${i + 1}/${animeList.length}]`;

    try {
      // Search Jikan using the stored title
      const searchTitle = anime.title_romaji || anime.title;
      console.log(`${num} 🔍 "${searchTitle}"`);

      const searchData = await jikanFetch(
        `${JIKAN_BASE}/anime?q=${encodeURIComponent(searchTitle)}&limit=5`
      );
      const results = searchData?.data || [];

      if (results.length === 0) {
        console.log(`${num}    ⚠️ No Jikan results, skipping.`);
        skipped++;
        continue;
      }

      // Find the best match by title similarity
      let bestMatch = null;
      let bestScore = 0;

      for (const r of results) {
        // Compare against multiple title fields
        const scores = [
          similarity(searchTitle, r.title),
          similarity(searchTitle, r.title_english),
          similarity(anime.title_japanese, r.title_japanese),
          similarity(anime.title, r.title),
          similarity(anime.title, r.title_english),
        ];
        const maxScore = Math.max(...scores);
        if (maxScore > bestScore) {
          bestScore = maxScore;
          bestMatch = r;
        }
      }

      if (!bestMatch || bestScore < 0.4) {
        console.log(
          `${num}    ⚠️ No confident match (best: ${bestScore.toFixed(2)}), skipping.`
        );
        skipped++;
        continue;
      }

      // Build update payload
      const updateData = {};
      if (bestMatch.title_english) updateData.title_english = bestMatch.title_english;
      if (bestMatch.mal_id) updateData.mal_id = bestMatch.mal_id;
      if (bestMatch.title) updateData.title_romaji = bestMatch.title; // Jikan default = romaji
      if (bestMatch.title_synonyms && bestMatch.title_synonyms.length > 0) {
        // Filter to Latin-script synonyms only
        updateData.title_synonyms = bestMatch.title_synonyms.filter((s) =>
          /^[a-zA-Z0-9\s\-':!,.&()]+$/.test(s)
        );
      }

      // Also update the primary title to English if available (matching new importer behavior)
      if (bestMatch.title_english && !anime.title.match(/^[a-zA-Z]/)) {
        // Current title starts with non-Latin char — replace with English
        updateData.title = bestMatch.title_english;
      } else if (bestMatch.title_english && anime.title !== bestMatch.title_english) {
        // Keep current title but ensure English is stored
        // Don't overwrite title if it's already a good English/romaji title
      }

      updateData.updated_at = new Date().toISOString();

      if (Object.keys(updateData).length <= 1) {
        // Only updated_at, nothing useful
        console.log(`${num}    ⚠️ No new data from Jikan match, skipping.`);
        skipped++;
        continue;
      }

      // Update Supabase
      const updateResp = await fetch(
        `${SUPABASE_URL}/rest/v1/anime?id=eq.${anime.id}`,
        {
          method: "PATCH",
          headers: supaHeaders,
          body: JSON.stringify(updateData),
        }
      );

      if (updateResp.ok) {
        const fields = Object.keys(updateData).filter((k) => k !== "updated_at");
        console.log(
          `${num}    ✅ Updated: ${fields.join(", ")} (match: ${bestScore.toFixed(2)}, MAL: ${bestMatch.mal_id})`
        );
        if (updateData.title_english) {
          console.log(`${num}       EN: "${updateData.title_english}"`);
        }
        updated++;
      } else {
        const errBody = await updateResp.text();
        console.log(`${num}    ❌ Update failed: ${updateResp.status} ${errBody}`);
        failed++;
      }
    } catch (err) {
      console.log(`${num}    ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ Backfill complete!`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Failed:  ${failed}`);
  console.log(`   Total:   ${animeList.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
