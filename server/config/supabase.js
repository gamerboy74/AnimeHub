import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in production to bypass RLS.');
  } else {
    console.warn('⚠️ WARNING: SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to VITE_SUPABASE_ANON_KEY. Row Level Security will apply.');
  }
}

export const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  serviceKey || process.env.VITE_SUPABASE_ANON_KEY
);
