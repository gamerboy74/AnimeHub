import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
  console.log("Querying anime_requests...");
  try {
    const { data, error } = await supabase
      .from('anime_requests')
      .select('*')
      .limit(5);

    if (error) {
      console.error("❌ Error querying anime_requests:", error);
    } else {
      console.log("✅ Success querying anime_requests!");
      console.log("Data sample:", data);
    }
  } catch (err) {
    console.error("Exception occurred:", err);
  }
}

inspect();
