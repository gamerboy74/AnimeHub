#!/usr/bin/env node
/**
 * Fix episode durations in the database.
 * Converts durations that look like "minutes" (small integers, e.g. 24)
 * into seconds by multiplying by 60. Threshold defaults to 1000.
 *
 * Usage:
 *   VITE_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/fix_episode_durations.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE configuration. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('Scanning episodes for likely-minute values (<=1000)...');

  const threshold = 1000; // durations <= this are treated as minutes
  let page = 0;
  const pageSize = 500;
  let updated = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from('episodes')
      .select('id,duration', { count: 'estimated' })
      .gte('duration', 1)
      .lte('duration', threshold)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Query error:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const id = row.id;
      const dur = Number(row.duration) || 0;
      if (dur > 0 && dur <= threshold) {
        const newDur = dur * 60;
        const { error: uErr } = await supabase
          .from('episodes')
          .update({ duration: newDur })
          .eq('id', id);
        if (uErr) {
          console.error(`Failed to update ${id}:`, uErr.message);
        } else {
          updated++;
          console.log(`Updated ${id}: ${dur} -> ${newDur}`);
        }
      }
    }

    page++;
  }

  console.log(`Done. Updated ${updated} episode(s).`);
}

run().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
