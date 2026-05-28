import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testUpdate() {
  const requestId = '13fb7739-72bb-4ad6-8601-2f57c10194c6'; // Baki Hanma ID from DB
  console.log(`Attempting to update status to "approved" for request: ${requestId} using Service Role Key...`);
  
  try {
    const { data, error } = await supabase
      .from('anime_requests')
      .update({
        status: 'approved',
        updated_at: new Date().toISOString()
      })
      .eq('id', requestId)
      .select();

    if (error) {
      console.error("❌ Failed to update request status:", error);
    } else {
      console.log("✅ Successfully updated request status!");
      console.log("Updated data:", data);
    }
  } catch (err) {
    console.error("Exception occurred:", err);
  }
}

testUpdate();
