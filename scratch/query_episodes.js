import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to parse .env file
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Error: .env file not found at project root:', envPath);
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/(^["']|["']$)/g, ''); // strip quotes
      env[key] = val;
    }
  });
  return env;
}

const env = loadEnv();
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Supabase credentials not found in .env');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Parse arguments
const args = process.argv.slice(2);
let animeId = null;
let limit = 15;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' || args[i] === '-l') {
    limit = parseInt(args[i + 1], 10) || 15;
    i++;
  } else if (!args[i].startsWith('-')) {
    animeId = args[i];
  }
}

async function queryEpisodes() {
  console.log('📡 Querying episodes from database...');
  console.log(`🔗 Supabase URL: ${supabaseUrl}`);

  try {
    let query = supabase
      .from('episodes')
      .select(`
        id,
        episode_number,
        title,
        video_url,
        is_premium,
        video_servers,
        created_at,
        anime:anime_id (
          title
        )
      `)
      .order('created_at', { ascending: false });

    if (animeId) {
      console.log(`🔍 Filtering by Anime ID: ${animeId}`);
      query = query.eq('anime_id', animeId);
    } else {
      console.log(`📋 Showing most recent ${limit} episodes across all anime...`);
    }

    const { data: episodes, error } = await query.limit(limit);

    if (error) {
      throw error;
    }

    if (!episodes || episodes.length === 0) {
      console.log('⚠️ No episodes found matching the query.');
      return;
    }

    console.log(`\n✅ Successfully fetched ${episodes.length} episodes:`);
    console.log('━'.repeat(140));
    console.log(
      'EP #'.padEnd(6) + 
      'TITLE'.padEnd(30) + 
      'ANIME'.padEnd(35) + 
      'PREMIUM'.padEnd(10) + 
      'SERVERS'.padEnd(14) +
      'CREATED AT'.padEnd(12) +
      'VIDEO URL'
    );
    console.log('━'.repeat(140));

    episodes.forEach(ep => {
      const epNum = ep.episode_number?.toString() || 'N/A';
      const title = (ep.title || `Episode ${epNum}`).substring(0, 28);
      const animeTitle = (ep.anime?.title || 'Unknown').substring(0, 33);
      const isPremium = ep.is_premium ? '⭐ Yes' : 'Free';
      const serversCount = Array.isArray(ep.video_servers) ? `🔗 ${ep.video_servers.length} mirrors` : 'None';
      const date = ep.created_at ? new Date(ep.created_at).toLocaleDateString() : 'N/A';
      const videoUrl = ep.video_url || 'N/A';

      console.log(
        epNum.padEnd(6) + 
        title.padEnd(30) + 
        animeTitle.padEnd(35) + 
        isPremium.padEnd(10) + 
        serversCount.padEnd(14) +
        date.padEnd(12) + 
        videoUrl
      );
    });
    console.log('━'.repeat(140));
    console.log(`\n💡 Run this script with an Anime ID to query specific episodes:`);
    console.log(`   node scratch/query_episodes.js <anime_id>`);
    console.log(`   node scratch/query_episodes.js --limit 50`);
  } catch (error) {
    console.error('❌ Database Query Error:', error.message);
  }
}

queryEpisodes();
