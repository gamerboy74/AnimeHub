#!/usr/bin/env node
/**
 * Inspect episode durations distribution and sample rows.
 * Usage: VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/inspect_episode_durations.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase env vars. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('Fetching episodes...');
  const pageSize = 2000;
  let page = 0;
  const durations = new Map();
  const samples = new Map();
  let total = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('episodes')
      .select('id,anime_id,episode_number,title,duration')
      .range(from, to);
    if (error) {
      console.error('Query error:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const r of data) {
      total++;
      const d = Number(r.duration) || 0;
      durations.set(d, (durations.get(d) || 0) + 1);
      if (!samples.has(d)) samples.set(d, []);
      if (samples.get(d).length < 3) samples.get(d).push(r);
    }

    page++;
  }

  console.log(`Total episodes scanned: ${total}`);

  const distinct = Array.from(durations.entries()).sort((a,b)=>b[1]-a[1]);

  console.log('\nTop 50 duration values by count:');
  for (let i=0;i<Math.min(50, distinct.length);i++){
    const [dur,count] = distinct[i];
    console.log(`${dur.toString().padStart(6)} sec : ${count}`);
  }

  console.log('\nSample rows for small durations (<=1000):');
  const small = Array.from(durations.keys()).filter(k=>k<=1000).sort((a,b)=>a-b);
  if (small.length===0) console.log('  (none)');
  for (const d of small) {
    const s = samples.get(d) || [];
    console.log(`\nDuration ${d} sec (count ${durations.get(d)}):`);
    for (const row of s) {
      console.log(` - id=${row.id} anime=${row.anime_id} ep=${row.episode_number} title=${row.title?.slice(0,60)}`);
    }
  }

  console.log('\nSample rows for large durations (>3600):');
  const large = Array.from(durations.keys()).filter(k=>k>3600).sort((a,b)=>b-a).slice(0,10);
  if (large.length===0) console.log('  (none)');
  for (const d of large) {
    const s = samples.get(d) || [];
    console.log(`\nDuration ${d} sec (count ${durations.get(d)}):`);
    for (const row of s) {
      console.log(` - id=${row.id} anime=${row.anime_id} ep=${row.episode_number} title=${row.title?.slice(0,60)}`);
    }
  }

  // Print some suspicious ranges
  const zeros = durations.get(0) || 0;
  const nulls = durations.has(null) ? durations.get(null) : 0;
  console.log(`\nZeros: ${zeros}, Nulls: ${nulls}`);
}

run().catch(err=>{console.error('Failed:',err);process.exit(1)});
