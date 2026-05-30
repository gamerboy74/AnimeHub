import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const candidates = [
  'sub', 'dub', 'both', 'sub_and_dub',
  'daily', 'weekly', 'hourly',
  'ongoing', 'completed', 'upcoming',
  'manual', 'automatic', 'auto',
  'episode', 'anime',
  'nineanime', 'reanime', 'sanjianime', 'animesuge',
  'global', 'custom', 'system', 'main', 'default',
  'cron', 'interval',
  'episode_check', 'new_anime_sync', 'metadata_sync', 'jikan_sync',
  'scrape', 'sync', 'update', 'all',
  'tv', 'movie', 'ova', 'ona', 'special',
  'ongoing_only', 'completed_only'
];

async function main() {
  console.log("Brute-forcing check constraint values for 'schedule_type'...");
  
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
        // Clean up immediately
        await supabase
          .from('episode_scraping_schedules')
          .delete()
          .eq('id', data[0].id);
        console.log(`Cleaned up "${candidate}".`);
      } else {
        if (!error.message.includes("check constraint")) {
          console.log(`Candidate "${candidate}" failed with distinct error: ${error.message}`);
        }
      }
    } catch (e) {
      console.log(`Candidate "${candidate}" threw exception:`, e.message);
    }
  }
  console.log("\nFinished testing all candidates.");
}

main();
