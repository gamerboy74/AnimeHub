import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
dotenv.config({ path: join(__dirname, "..", ".env") });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function inspectTable() {
  console.log("🔍 Fetching a sample of episodes from the database...");
  const { data: episodes, error: epError } = await supabase
    .from("episodes")
    .select("*")
    .not("video_url", "is", null)
    .limit(3);

  if (epError) {
    console.error("❌ Error fetching episodes:", epError);
  } else {
    console.log("📋 Sample episodes from the database:");
    console.log(JSON.stringify(episodes, null, 2));
  }

  console.log("\n📊 Inspecting schema columns via information_schema...");
  // Since we cannot run raw sql via standard select, let's see if we can query an RPC or just list keys of a fetched row
  if (episodes && episodes.length > 0) {
    console.log("Detected Columns on 'episodes' table:");
    console.log(Object.keys(episodes[0]).map(key => `- ${key} (${typeof episodes[0][key]})`).join("\n"));
  }
}

inspectTable().catch(console.error);
