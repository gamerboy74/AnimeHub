import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", "..", ".env") });

import { supabase } from '../../server/config/supabase.js';

async function run() {
  const { data, error } = await supabase
    .from("anime")
    .select("*")
    .ilike("title", "%Seven Deadly Sins%Cursed by Light%")
    .maybeSingle();

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Anime Record:", data);
  }
}

run();
