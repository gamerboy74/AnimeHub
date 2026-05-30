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
  console.log("Querying all rows from 'episode_scraping_schedules'...");
  try {
    const { data, error, count } = await supabase
      .from('episode_scraping_schedules')
      .select('*', { count: 'exact' });

    if (error) {
      console.error("❌ Query failed:", error.message);
    } else {
      console.log(`✅ Success! Found ${count} rows.`);
      if (data && data.length > 0) {
        console.log("Rows data:");
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log("Table is empty.");
      }
    }
  } catch (err) {
    console.error("Exception:", err);
  }
}

main();
