import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const candidates = [
  'episode_scraper', 'episode_scraping', 'new_anime', 'metadata',
  'jikan', 'mal', 'anilist', 'kitsu',
  'ongoing_anime', 'all_anime', 'seasonal', 'airing',
  'nine_anime', 'anime_suge', 're_anime', 'sanji_anime',
  'sub_scrape', 'dub_scrape', 'both_scrape',
  'scheduled', 'triggered', 'event',
  'cron_job', 'sync_job',
  'episode_check', 'new_anime_sync',
  'scrape_episodes', 'sync_anime',
  'episode', 'sync', 'jikan_sync'
];

async function main() {
  console.log("Testing more check constraint values for 'schedule_type'...");
  for (const candidate of candidates) {
    try {
      const { data, error } = await supabase
        .from('episode_scraping_schedules')
        .insert({
          schedule_type: candidate,
          anime_id: null,
          interval_minutes: 60,
          is_active: true
        })
        .select();

      if (!error) {
        console.log(`\n🎉 SUCCESS! Allowed value: "${candidate}"`);
        await supabase.from('episode_scraping_schedules').delete().eq('id', data[0].id);
      } else {
        if (!error.message.includes("violates check constraint")) {
          console.log(`Candidate "${candidate}" error:`, error.message);
        }
      }
    } catch (e) {
      console.log(`Exception for "${candidate}":`, e.message);
    }
  }
  console.log("Done testing.");
}

main();
