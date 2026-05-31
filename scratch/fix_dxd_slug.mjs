/**
 * Scratch script: clears the wrong nine_anime_slug for "High School DxD HERO"
 * Run once to reset so the scraper will re-resolve correctly on next run.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(process.cwd(), ".env") });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const ANIME_ID = "efb33884-8da2-47af-a816-515f056bcb44";

// Clear the wrong slug so the scraper re-resolves on next run
const { data, error } = await supabase
  .from("anime")
  .update({ nine_anime_slug: null, updated_at: new Date().toISOString() })
  .eq("id", ANIME_ID)
  .select("id, title, nine_anime_slug");

if (error) {
  console.error("❌ Failed to reset slug:", error.message);
} else {
  console.log("✅ Reset nine_anime_slug to NULL for:", data);
}
