import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", "..", ".env") });

import { supabase } from '../../server/config/supabase.js';

const isBadUrl = (url) => !url || url.trim() === '' || url === 'null';
const isBadServers = (servers) => !servers || !Array.isArray(servers) || servers.length === 0;

async function run() {
  console.log("Fetching episodes...");
  const { data: episodes, error } = await supabase
    .from('episodes')
    .select(`
      id,
      episode_number,
      title,
      video_url,
      video_servers,
      air_date,
      anime_id,
      anime:anime_id (
        id,
        title,
        title_english,
        poster_url,
        status,
        scraper_urls
      )
    `)
    .or('video_url.is.null,video_servers.is.null,video_servers.eq.[]')
    .order('episode_number', { ascending: true })
    .limit(100);

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log(`Fetched ${episodes.length} episodes.`);
  
  let matchCount = 0;
  let failCount = 0;
  let throwCount = 0;

  for (const ep of episodes) {
    try {
      const scraperUrlsCount = Object.keys(ep.anime?.scraper_urls || {}).length;
      const serverUrlsCount = (ep.video_servers || []).length;
      const match = scraperUrlsCount < 2 || serverUrlsCount < 2;
      
      if (match) {
        matchCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      throwCount++;
      console.error(`Error on ep ${ep.id}:`, e.message, "anime data:", ep.anime);
    }
  }

  console.log(`Summary: matches=${matchCount}, fails=${failCount}, errors=${throwCount}`);
}

run();
