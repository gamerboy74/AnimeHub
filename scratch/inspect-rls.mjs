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

async function inspectPolicies() {
  console.log("Querying pg_policies for anime_requests...");
  try {
    const { data, error } = await supabase.rpc('inspect_rls_policies', { table_name_param: 'anime_requests' });

    if (error) {
      console.log("inspect_rls_policies RPC not found. Falling back to direct SQL execution if possible, or querying custom PG view...");
      // Let's try running a direct query on pg_policies using an RPC if one exists, or query it
      const { data: policies, error: polError } = await supabase
        .from('pg_policies')
        .select('*')
        .eq('tablename', 'anime_requests');
      
      if (polError) {
        console.error("❌ Failed to query pg_policies directly (PostgREST typically restricts system catalogs):", polError.message);
      } else {
        console.log("Policies:", policies);
      }
    } else {
      console.log("RLS Policies for anime_requests:", data);
    }
  } catch (err) {
    console.error("Exception occurred:", err);
  }
}

inspectPolicies();
