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
  const variations = [
    'episode_scraping_schedules',
    'episode_scraping_schedule_runs',
    'episode_scraping_schedule_log',
    'episode_scraping_schedule_logs',
    'episode_scraping_scheduler_settings',
    'episode_scraping_scheduler_log',
    'episode_scraping_scheduler_status',
    'episode_scraping_sched_runs',
    'episode_scraping_sched_log',
    'episode_scraping_sched_logs'
  ];

  console.log("Checking variations...");
  for (const name of variations) {
    try {
      const { error } = await supabase.from(name).select('*').limit(1);
      if (!error) {
        console.log(`\n🎉 Found table: "${name}"`);
        const { data } = await supabase.from(name).select('*').limit(1);
        console.log("Columns:", Object.keys(data[0] || {}));
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

  console.log("None of the guessed tables matched. Attempting system RPC discovery...");
  
  // Let's test if there is an RPC for executing SQL
  const rpcs = ['run_sql', 'exec_sql', 'execute_sql', 'query_sql', 'sql'];
  for (const rpc of rpcs) {
    try {
      const { data, error } = await supabase.rpc(rpc, { 
        query: "select tablename from pg_tables where schemaname = 'public';",
        sql: "select tablename from pg_tables where schemaname = 'public';"
      });
      if (!error) {
        console.log(`\n🎉 Found SQL RPC: "${rpc}"!`);
        console.log("Tables list:", data);
        return;
      } else {
        console.log(`RPC "${rpc}" failed: ${error.message}`);
      }
    } catch (e) {
      // ignore
    }
  }
}

main();
