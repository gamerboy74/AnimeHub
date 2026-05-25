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

console.log("Connecting to Supabase at:", supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

async function testQuery(tableName) {
  console.log(`\n--- Testing query on table: "${tableName}" ---`);
  try {
    const { data, error, count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact' })
      .limit(3);
    
    if (error) {
      console.error(`❌ Error querying "${tableName}":`, error.message);
      return { success: false, error };
    } else {
      console.log(`✅ Success! Queried "${tableName}". Rows found:`, count);
      console.log('Sample Data:', data);
      return { success: true, data };
    }
  } catch (err) {
    console.error(`💥 Exception querying "${tableName}":`, err);
    return { success: false, err };
  }
}

async function main() {
  // Test basic table to verify connection
  await testQuery('users');
  
  // Test user_progress
  await testQuery('user_progress');

  // Test user_watch_progress
  await testQuery('user_watch_progress');

  // Test user_watch_progress_detailed
  await testQuery('user_watch_progress_detailed');

  // Test user_progress_detailed
  await testQuery('user_progress_detailed');
}

main();
