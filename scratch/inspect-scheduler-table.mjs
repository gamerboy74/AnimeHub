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
  console.error("Missing Supabase configuration in .env!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Checking for tables matching 'episode_scraping_sched%'...");
  
  // Query Supabase postgres RPC or database columns
  // Note: we can inspect it by querying columns using RPC or just try a direct select on common table names
  const possibleNames = [
    'episode_scraping_schedule',
    'episode_scraping_scheduler',
    'episode_scraping_scheduler_logs',
    'episode_scraping_scheduler_runs'
  ];

  for (const name of possibleNames) {
    try {
      const { data, error, count } = await supabase
        .from(name)
        .select('*', { count: 'exact' })
        .limit(1);
      
      if (!error) {
        console.log(`\n🎉 Found table: "${name}"!`);
        console.log(`Rows count: ${count}`);
        if (data && data.length > 0) {
          console.log("Sample row keys (columns):", Object.keys(data[0]));
          console.log("Sample data:", data[0]);
        } else {
          console.log("Table is empty. Let's try to query table info or insert a dummy row.");
        }
        return;
      } else {
        if (error.code !== 'PGRST116' && error.code !== '42P01') {
          console.log(`Table "${name}" returned error code ${error.code}: ${error.message}`);
        }
      }
    } catch (e) {
      // ignore
    }
  }
  
  // If not found, let's query SQL via RPC if any general query RPC exists, or let's try a sql statement
  console.log("Could not find table by guessing. Let's search general table lists if possible.");
}

main();
