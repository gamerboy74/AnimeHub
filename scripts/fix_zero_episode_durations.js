#!/usr/bin/env node
/**
 * Fix episodes with duration == 0 by using anime.duration or default values.
 * Priority:
 *  - If anime.duration is set and >0: use anime.duration * 60 if anime.duration looks like minutes (<10000), otherwise use as-is.
 *  - Else if anime.type === 'movie' use 5400 (90min)
 *  - Else use 1440 (24min)
 *
 * Usage: VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fix_zero_episode_durations.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase env vars'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function normalizedAnimeDuration(d) {
  if (!d) return null;
  const n = Number(d);
  if (isNaN(n) || n <= 0) return null;
  // if looks like minutes (small), convert to seconds
  if (n < 10000) return n * 60;
  return n;
}

async function run() {
  console.log('Finding episodes with duration == 0');
  // Fetch all episodes in pages and detect those where numeric duration === 0
  const episodes = [];
  const pageSize = 500;
  let page = 0;
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error: qErr } = await supabase
      .from('episodes')
      .select('id,anime_id,episode_number,title,duration')
      .range(from, to);
    if (qErr) { console.error('Query error:', qErr.message); process.exit(1); }
    if (!data || data.length === 0) break;
    episodes.push(...data);
    page++;
  }
  const zeroEps = episodes.filter(r => Number(r.duration) === 0);
  if (zeroEps.length === 0) {
    console.log('No zero-duration episodes found');
    return;
  }

  console.log(`Found ${zeroEps.length} episodes with duration 0`);
  let updated = 0;
  for (const ep of zeroEps) {
    // fetch anime
    const { data: anime, error: aErr } = await supabase
      .from('anime')
      .select('id,type,duration')
      .eq('id', ep.anime_id)
      .maybeSingle();
    if (aErr) {
      console.error('Failed to fetch anime', aErr.message);
      continue;
    }
    let newDur = null;
    if (anime && anime.duration) {
      newDur = normalizedAnimeDuration(anime.duration);
    }
    if (!newDur) {
      if (anime && anime.type === 'movie') newDur = 5400;
      else newDur = 1440;
    }

    const { error: uErr } = await supabase
      .from('episodes')
      .update({ duration: newDur })
      .eq('id', ep.id);
    if (uErr) {
      console.error(`Failed to update episode ${ep.id}:`, uErr.message);
    } else {
      updated++;
      console.log(`Updated ${ep.id}: set duration=${newDur}`);
    }
  }
  console.log(`Done. Updated ${updated} episodes`);
}

run().catch(err=>{console.error(err);process.exit(1)});
