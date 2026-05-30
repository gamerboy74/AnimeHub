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

async function main() {
  try {
    const { data, error } = await supabase
      .from('pg_constraint')
      .select('*')
      .limit(1);

    if (error) {
      console.log("Could not query pg_constraint:", error.message);
    } else {
      console.log("pg_constraint success:", data);
    }
  } catch (e) {
    console.log("Exception:", e.message);
  }
}

main();
