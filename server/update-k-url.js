import { supabase } from "./index.js";

async function update() {
  // Fetch current record
  const { data: anime, error: getErr } = await supabase
    .from("anime")
    .select("scraper_urls")
    .eq("id", "8fd316a4-56a6-4ae9-88b7-51780ad90d71")
    .single();
    
  if (getErr) {
    throw new Error(`Failed to fetch anime: ${getErr.message}`);
  }
  
  const currentUrls = anime?.scraper_urls || {};
  const updatedUrls = {
    ...currentUrls,
    reanime_watch: "https://reanime.to/anime/k-k-vx34cg"
  };
  
  const { error: updateErr } = await supabase
    .from("anime")
    .update({ scraper_urls: updatedUrls })
    .eq("id", "8fd316a4-56a6-4ae9-88b7-51780ad90d71");
    
  if (updateErr) {
    throw new Error(`Failed to update scraper URL: ${updateErr.message}`);
  }
  
  console.log("✅ Successfully mapped Re:ANIME watch URL for 'K' to: https://reanime.to/anime/k-k-vx34cg");
}

update().then(() => process.exit(0)).catch(console.error);
