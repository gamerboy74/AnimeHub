import { ReAnimeScraperService } from '../server/scrapers/reanime.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  console.log('Testing Re:ANIME scraper for The Apothecary Diaries...');
  const result = await ReAnimeScraperService.scrapeAnimeEpisode('The Apothecary Diaries', 1);
  console.log('Result:', JSON.stringify(result, null, 2));
}

run().catch(console.error);
