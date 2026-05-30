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

async function main() {
  console.log("Testing insert into 'episode_scraping_schedules' with anime_id = null...");
  try {
    const { data, error } = await supabase
      .from('episode_scraping_schedules')
      .insert({
        schedule_type: 'test_global_schedule',
        anime_id: null,
        interval_minutes: 360,
        is_active: true,
        last_run_at: new Date().toISOString(),
        next_run_at: new Date(Date.now() + 360 * 60 * 1000).toISOString()
      })
      .select();

    if (error) {
      console.error("❌ Insert failed:", error.message);
    } else {
      console.log("✅ Insert succeeded!", data);
      
      // Clean up the test row
      console.log("Cleaning up test row...");
      const { error: deleteErr } = await supabase
        .from('episode_scraping_schedules')
        .delete()
        .eq('id', data[0].id);
      
      if (deleteErr) console.error("Failed to delete test row:", deleteErr.message);
      else console.log("✅ Cleanup complete.");
    }
  } catch (err) {
    console.error("Exception:", err);
  }
}

main();
